import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import { OrderStatus } from '@prisma/client';
import { io } from '../server';
import logger from '../utils/logger';

const ORDER_STATUSES = ['PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'SOURCING', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUND_INITIATED'] as const;

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

    const order = await prisma.order.update({
      where: { id: orderId },
      data: { status: status as OrderStatus }
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
    const { orderId } = verifySchema.parse(req.body);
    const userId = (req as any).user.id;

    const order = await prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) return res.status(404).json({ message: 'Order not found' });

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
