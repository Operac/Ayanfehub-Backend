import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import Flutterwave from 'flutterwave-node-v3';
import { io } from '../server';
import logger from '../utils/logger';

const validatePriceSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    quantity: z.number().positive()
  }))
});

const deliverySchema = z.object({
  marketIds: z.array(z.string().uuid())
});

const initiatePaymentSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    quantity: z.number().positive()
  })),
  deliveryAddressId: z.string().uuid(),
  deliveryZoneId: z.string().uuid()
});

const flutterwave = new Flutterwave(process.env.FLUTTERWAVE_PUBLIC_KEY || '', process.env.FLUTTERWAVE_SECRET_KEY || '');

export const validatePrices = async (req: Request, res: Response) => {
  try {
    const { items } = validatePriceSchema.parse(req.body);
    const itemIds = items.map(i => i.id);

    if (itemIds.length === 0) {
      return res.json({ updatedItems: [], total: 0, priceChange: false });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: itemIds }, isActive: true },
      include: {
        priceEntries: { where: { isCurrent: true }, take: 1 }
      }
    });

    let total = 0;

    const updatedItems = items.map(cartItem => {
      const product = products.find(p => p.id === cartItem.id);
      if (!product) return null;

      const currentPrice = product.priceEntries[0]?.priceNgn
        ? Number(product.priceEntries[0].priceNgn)
        : 0;

      const subtotal = currentPrice * cartItem.quantity;
      total += subtotal;

      return {
        id: product.id,
        name: product.name,
        marketId: product.marketId,
        price: currentPrice,
        quantity: cartItem.quantity,
        subtotal
      };
    }).filter(i => i !== null);

    res.json({ updatedItems, total, priceChange: false });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const calculateDelivery = async (req: Request, res: Response) => {
  try {
    const { marketIds } = deliverySchema.parse(req.body);

    if (marketIds.length === 0) {
      return res.status(400).json({ message: 'No markets provided' });
    }

    const markets = await prisma.market.findMany({
      where: { id: { in: marketIds } },
      include: { runDays: { orderBy: { dayOfWeek: 'asc' } } }
    });

    const today = new Date();
    const daysUntilSat = (6 - today.getDay() + 7) % 7 || 7;
    const nextSat = new Date(today);
    nextSat.setDate(today.getDate() + daysUntilSat);

    res.json({
      deliveryDate: nextSat.toISOString().split('T')[0],
      markets: markets.map(m => m.name),
      message: 'Your items will be consolidated and delivered together to reduce delays.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const initiatePayment = async (req: Request, res: Response) => {
  try {
    const { items, deliveryAddressId, deliveryZoneId } = initiatePaymentSchema.parse(req.body);
    const userId = (req as any).user.id;

    if (items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: items.map(i => i.id) }, isActive: true },
      include: { priceEntries: { where: { isCurrent: true }, take: 1 } }
    });

    const deliveryZone = await prisma.deliveryZone.findUnique({ where: { id: deliveryZoneId } });
    if (!deliveryZone) {
      return res.status(404).json({ message: 'Delivery zone not found' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let subtotal = 0;
    const orderItems: any[] = [];

    for (const cartItem of items) {
      const product = products.find(p => p.id === cartItem.id);
      if (!product) {
        return res.status(404).json({ message: `Product ${cartItem.id} not found` });
      }

      const price = product.priceEntries[0]?.priceNgn ? Number(product.priceEntries[0].priceNgn) : 0;
      const itemSubtotal = price * cartItem.quantity;
      subtotal += itemSubtotal;

      orderItems.push({
        productId: product.id,
        vendorId: product.vendorId,
        marketId: product.marketId,
        quantity: cartItem.quantity,
        unit: product.unit,
        priceNgnAtOrder: price,
        subtotalNgn: itemSubtotal,
        sourcingStatus: 'PENDING'
      });
    }

    const serviceFeeAmount = Math.round(subtotal * 0.05); // 5% service fee
    const deliveryFeeAmount = Number(deliveryZone.deliveryFeeNgn);
    const totalAmount = subtotal + deliveryFeeAmount + serviceFeeAmount;

    const orderNumber = `AYF-${Date.now()}`;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId,
        status: 'PENDING_PAYMENT',
        deliveryAddressId,
        deliveryZoneId,
        subtotalNgn: subtotal,
        deliveryFeeNgn: deliveryFeeAmount,
        serviceFeeNgn: serviceFeeAmount,
        totalNgn: totalAmount,
        items: { create: orderItems }
      },
      include: { items: true }
    });

    const paymentReference = `FLW-${order.id.slice(0, 8).toUpperCase()}-${Date.now()}`;

    const flutterwavePayload = {
      tx_ref: paymentReference,
      amount: totalAmount,
      currency: 'NGN',
      payment_options: 'card,ussd,banktransfer,mobilemoneytanzania,mobilemoneyghana,mobilemoneyug',
      customer: {
        email: user.email || `user-${user.id}@ayanfe.local`,
        phonenumber: user.phone,
        name: user.fullName || 'Customer'
      },
      customizations: {
        title: 'Ayanfe Hub - Order Checkout',
        description: `Payment for order ${order.orderNumber}`,
        logo: 'https://ayanfe-logo-url.com/logo.png'
      },
      meta: {
        orderId: order.id,
        userId: user.id
      }
    };

    res.json({
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        total: totalAmount
      },
      paymentReference,
      flutterwavePayload
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const handleFlutterwaveWebhook = async (req: Request, res: Response) => {
  try {
    const { data } = req.body;

    if (!data || !data.id) {
      return res.status(400).json({ message: 'Invalid webhook payload' });
    }

    // Flutterwave sends the secret hash you set in the dashboard as "verif-hash"
    const receivedHash = req.headers['verif-hash'] as string | undefined;
    const expectedHash = process.env.FLUTTERWAVE_WEBHOOK_HASH;
    if (expectedHash && receivedHash !== expectedHash) {
      logger.warn('Invalid Flutterwave webhook signature');
      return res.status(401).json({ message: 'Invalid signature' });
    }

    const paymentStatus = data.status;
    const txRef = data.tx_ref;

    const payment = await prisma.payment.findUnique({ where: { reference: txRef } });
    if (payment) {
      const newStatus = paymentStatus === 'successful' ? 'COMPLETED' : paymentStatus === 'failed' ? 'FAILED' : 'CANCELLED';
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: newStatus, metadata: JSON.stringify(data) }
      });

      if (newStatus === 'COMPLETED') {
        await prisma.order.update({
          where: { id: payment.orderId },
          data: { status: 'PAYMENT_CONFIRMED' }
        });
        io.to(`order:${payment.orderId}`).emit('order:status', { orderId: payment.orderId, status: 'PAYMENT_CONFIRMED' });
      }
    } else {
      const orderIdMatch = data.meta?.orderId;
      if (orderIdMatch) {
        const newOrderStatus = paymentStatus === 'successful' ? 'PAYMENT_CONFIRMED' : 'PENDING_PAYMENT';
        await prisma.order.update({
          where: { id: orderIdMatch },
          data: { status: newOrderStatus }
        });

        await prisma.payment.create({
          data: {
            orderId: orderIdMatch,
            amount: data.amount_settled || data.amount,
            reference: txRef,
            status: paymentStatus === 'successful' ? 'COMPLETED' : 'FAILED',
            metadata: JSON.stringify(data)
          }
        });

        if (paymentStatus === 'successful') {
          io.to(`order:${orderIdMatch}`).emit('order:status', { orderId: orderIdMatch, status: 'PAYMENT_CONFIRMED' });
        }
      }
    }

    res.status(200).json({ message: 'Webhook processed' });
  } catch (error) {
    logger.error('Webhook error', { error });
    res.status(500).json({ message: 'Webhook processing failed' });
  }
};
