import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import { OrderStatus } from '@prisma/client';
import { io } from '../server';
import logger from '../utils/logger';

const ORDER_STATUSES = ['PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'SOURCING', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUND_INITIATED'] as const;

/** Valid forward / admin transitions — prevents arbitrary status jumps */
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING_PAYMENT:    ['PAYMENT_CONFIRMED', 'CANCELLED'],
  PAYMENT_CONFIRMED:  ['SOURCING', 'CANCELLED', 'REFUND_INITIATED'],
  SOURCING:           ['AT_HUB', 'CANCELLED'],
  AT_HUB:             ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY:   ['DELIVERED'],
  DELIVERED:          ['REFUND_INITIATED'],
  REFUND_INITIATED:   ['CANCELLED'],
  CANCELLED:          [],
};

const verifySchema = z.object({
  orderId: z.string().uuid(),
  code: z.string().length(6)
});

const updateStatusSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(ORDER_STATUSES as unknown as [string, ...string[]])
});

function emitOrderUpdate(orderId: string, status: string) {
  io.to(`order:${orderId}`).emit('order:status', { orderId, status });
  logger.info('Emitted order status update', { orderId, status });
}

/** Decrement promo usedCount when an order with a promo code is cancelled */
async function releasePromoCode(promoCode: string | null, tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  if (!promoCode) return;
  await tx.promotion.updateMany({
    where: { code: promoCode, usedCount: { gt: 0 } },
    data: { usedCount: { decrement: 1 } }
  });
}

export const getMyOrders = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: { product: { select: { name: true, unit: true } } }
        }
      }
    });
    res.json(orders);
  } catch (error) {
    logger.error('getMyOrders failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getOrderById = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const id = req.params['id'] as string;

    const order = await prisma.order.findFirst({
      where: { id, userId },
      include: {
        items: {
          include: { product: { select: { name: true, unit: true } } }
        },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        deliveryAddress: true
      }
    });

    if (!order) return res.status(404).json({ message: 'Order not found' });

    res.json(order);
  } catch (error) {
    logger.error('getOrderById failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const { orderId, status } = updateStatusSchema.parse(req.body);

    const existing = await prisma.order.findUnique({ where: { id: orderId } });
    if (!existing) return res.status(404).json({ message: 'Order not found' });

    const allowed = VALID_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: `Cannot transition from ${existing.status} to ${status}`,
        allowedTransitions: allowed
      });
    }

    const order = await prisma.$transaction(async (tx) => {
      if (status === 'CANCELLED') {
        // Release reserved stock
        const items = await tx.orderItem.findMany({ where: { orderId } });
        for (const item of items) {
          await tx.product.updateMany({
            where: { id: item.productId, stockQuantity: { not: null } },
            data: { reservedQuantity: { decrement: Number(item.quantity) } }
          });
        }
        // Release promo code usage
        await releasePromoCode(existing.promoCode, tx);
      }
      return tx.order.update({ where: { id: orderId }, data: { status: status as OrderStatus } });
    });

    emitOrderUpdate(orderId, status);
    res.json({ message: 'Order status updated', order });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('updateOrderStatus failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const verifyDelivery = async (req: Request, res: Response) => {
  try {
    const { orderId, code } = verifySchema.parse(req.body);
    const userId = (req as any).user.id;

    const order = await prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'OUT_FOR_DELIVERY') {
      return res.status(400).json({ message: 'Order is not out for delivery' });
    }

    // Verify the 6-digit code matches what admin generated
    if (!order.verificationCode) {
      return res.status(400).json({ message: 'No verification code has been generated for this order yet' });
    }
    if (order.verificationCode !== code) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DELIVERED }
    });

    emitOrderUpdate(orderId, 'DELIVERED');
    res.json({ message: 'Delivery confirmed', order: updated });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('verifyDelivery failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const cancelMyPendingOrder = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    const existingOrder = await prisma.order.findUnique({ where: { id } });
    if (!existingOrder) return res.status(404).json({ message: 'Order not found' });

    if (existingOrder.userId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ message: 'Unauthorized to cancel this order' });
    }

    if (existingOrder.status !== 'PENDING_PAYMENT') {
      return res.status(400).json({ message: 'Only pending payment orders can be cancelled by the customer' });
    }

    const order = await prisma.$transaction(async (tx) => {
      const items = await tx.orderItem.findMany({ where: { orderId: id } });
      for (const item of items) {
        await tx.product.updateMany({
          where: { id: item.productId, stockQuantity: { not: null } },
          data: { reservedQuantity: { decrement: Number(item.quantity) } }
        });
      }
      // Release promo code usage
      await releasePromoCode(existingOrder.promoCode, tx);

      return tx.order.update({ where: { id }, data: { status: 'CANCELLED' } });
    });

    emitOrderUpdate(id, 'CANCELLED');
    return res.json({ message: 'Order cancelled and stock released', order });
  } catch (error) {
    logger.error('cancelMyPendingOrder failed', { error });
    return res.status(500).json({ message: 'Server error' });
  }
};
