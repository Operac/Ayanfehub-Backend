import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
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
    quantity: z.number().positive(),
    clientPrice: z.number().nonnegative().optional() // price shown to customer in cart
  })),
  deliveryAddressId: z.string().uuid(),
  deliveryZoneId: z.string().uuid(),
  promoCode: z.string().optional(),
  acknowledgePriceChange: z.boolean().optional() // customer confirmed price diff
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
      where: {
        id: { in: itemIds },
        isActive: true,
        approvalStatus: 'APPROVED'
      },
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

export const lookupZoneByCity = async (req: Request, res: Response) => {
  try {
    const { city } = z.object({ city: z.string().min(1) }).parse(req.body);
    const normalised = city.toLowerCase().trim();

    const zone = await prisma.deliveryZone.findFirst({
      where: { isActive: true, cities: { has: normalised } }
    });

    if (!zone) {
      const contactSetting = await prisma.appSetting.findUnique({ where: { key: 'contact_phone' } });
      return res.json({ found: false, contactPhone: contactSetting?.value || null });
    }

    res.json({
      found: true,
      zone: {
        id: zone.id,
        name: zone.name,
        deliveryFeeNgn: Number(zone.deliveryFeeNgn),
        consolidatedDeliveryFeeNgn: Number(zone.consolidatedDeliveryFeeNgn)
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('lookupZoneByCity failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getDeliveryFee = async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      marketIds: z.array(z.string().uuid()),
      deliveryZoneId: z.string().uuid()
    });
    const { marketIds, deliveryZoneId } = schema.parse(req.body);

    const zone = await prisma.deliveryZone.findUnique({ where: { id: deliveryZoneId } });
    if (!zone) return res.status(404).json({ message: 'Zone not found' });

    const isConsolidated = marketIds.length > 1;

    if (isConsolidated) {
      return res.json({
        isConsolidated: true,
        deliveryFeeNgn: Number(zone.consolidatedDeliveryFeeNgn),
        message: 'Consolidated delivery — all your orders in one trip'
      });
    }

    // Single market — look up per-market rate
    const rate = await prisma.marketDeliveryRate.findUnique({
      where: { marketId_deliveryZoneId: { marketId: marketIds[0], deliveryZoneId } }
    });

    if (!rate) {
      const contactSetting = await prisma.appSetting.findUnique({ where: { key: 'contact_phone' } });
      return res.json({
        isConsolidated: false,
        deliveryFeeNgn: null,
        contactPrice: true,
        contactPhone: contactSetting?.value || null,
        message: 'Contact us for delivery pricing to your zone'
      });
    }

    res.json({ isConsolidated: false, deliveryFeeNgn: Number(rate.priceNgn), contactPrice: false });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('getDeliveryFee failed', { error });
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
    const todayDay = today.getDay();

    if (marketIds.length === 1) {
      // Single market: next available run day
      const runDays = markets[0]?.runDays ?? [];
      if (runDays.length === 0) {
        return res.json({ deliveryDate: null, message: 'No delivery days set for this market' });
      }
      // Find next run day from today
      let daysAhead = 8;
      let bestDay: (typeof runDays)[0] | null = null;
      for (const rd of runDays) {
        const diff = (rd.dayOfWeek - todayDay + 7) % 7 || 7;
        // If today is the run day, check if past cutoff
        if (diff === 7 && rd.dayOfWeek === todayDay) {
          const nowHour = today.getHours();
          const nowMin = today.getMinutes();
          if (nowHour < rd.cutoffHour || (nowHour === rd.cutoffHour && nowMin < rd.cutoffMinute)) {
            // Still before cutoff — same day delivery
            if (diff < daysAhead) { daysAhead = diff; bestDay = rd; }
          }
          continue;
        }
        if (diff < daysAhead) { daysAhead = diff; bestDay = rd; }
      }
      if (!bestDay) { daysAhead = 7; bestDay = runDays[0]; }
      const deliveryDate = new Date(today);
      deliveryDate.setDate(today.getDate() + daysAhead);
      return res.json({
        deliveryDate: deliveryDate.toISOString().split('T')[0],
        markets: [markets[0].name],
        isConsolidated: false,
        cutoffTime: `${String(bestDay.cutoffHour).padStart(2,'0')}:${String(bestDay.cutoffMinute).padStart(2,'0')}`
      });
    }

    // Multiple markets: use the consolidated day from AppSetting
    const consolidationSetting = await prisma.appSetting.findUnique({ where: { key: 'consolidation_day_of_week' } });
    const consolidationDay = consolidationSetting ? parseInt(consolidationSetting.value) : 4; // default Thursday

    const daysUntilConsolidation = (consolidationDay - todayDay + 7) % 7 || 7;
    const deliveryDate = new Date(today);
    deliveryDate.setDate(today.getDate() + daysUntilConsolidation);

    res.json({
      deliveryDate: deliveryDate.toISOString().split('T')[0],
      markets: markets.map(m => m.name),
      isConsolidated: true,
      message: 'Consolidated delivery — all orders from different markets in one trip'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const initiatePayment = async (req: Request, res: Response) => {
  try {
    const { items, deliveryAddressId, deliveryZoneId, promoCode, acknowledgePriceChange } = initiatePaymentSchema.parse(req.body);
    const userId = (req as any).user.id;

    if (items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    // Auto-cancel any existing PENDING_PAYMENT orders of this user to free up reserved stock before checking current stock
    const oldPendingOrders = await prisma.order.findMany({
      where: { userId, status: 'PENDING_PAYMENT' },
      include: { items: true }
    });

    if (oldPendingOrders.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const oldOrder of oldPendingOrders) {
          for (const item of oldOrder.items) {
            await tx.product.updateMany({
              where: { id: item.productId, stockQuantity: { not: null } },
              data: { reservedQuantity: { decrement: Number(item.quantity) } }
            });
          }
          await tx.order.update({
            where: { id: oldOrder.id },
            data: { status: 'CANCELLED' }
          });
        }
      });
    }

    const products = await prisma.product.findMany({
      where: {
        id: { in: items.map(i => i.id) },
        isActive: true,
        approvalStatus: 'APPROVED'
      },
      include: { priceEntries: { where: { isCurrent: true }, take: 1 } }
    });

    const [deliveryZone, user] = await Promise.all([
      prisma.deliveryZone.findUnique({ where: { id: deliveryZoneId } }),
      prisma.user.findUnique({ where: { id: userId } })
    ]);
    if (!deliveryZone) return res.status(404).json({ message: 'Delivery zone not found' });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // ── Gate 1: Price change detection ──────────────────────────────────────
    if (!acknowledgePriceChange) {
      const priceChanges: { productId: string; name: string; oldPrice: number; newPrice: number }[] = [];
      for (const cartItem of items) {
        if (cartItem.clientPrice === undefined) continue;
        const product = products.find(p => p.id === cartItem.id);
        if (!product) continue;
        const currentPrice = product.priceEntries[0]?.priceNgn ? Number(product.priceEntries[0].priceNgn) : 0;
        if (currentPrice !== cartItem.clientPrice) {
          priceChanges.push({ productId: product.id, name: product.name, oldPrice: cartItem.clientPrice, newPrice: currentPrice });
        }
      }
      if (priceChanges.length > 0) {
        return res.status(409).json({
          code: 'PRICE_CHANGED',
          message: 'Prices have changed since you added these items to your cart.',
          changes: priceChanges
        });
      }
    }

    // ── Gate 2: Market schedule availability check ───────────────────────────
    const cartMarketIds = [...new Set(products.map(p => p.marketId))];
    const marketsWithSchedule = await prisma.market.findMany({
      where: { id: { in: cartMarketIds } },
      include: { runDays: true }
    });
    for (const market of marketsWithSchedule) {
      if (market.runDays.length === 0) {
        return res.status(400).json({
          code: 'MARKET_NO_SCHEDULE',
          message: `${market.name} has no delivery schedule configured yet. Please contact us.`,
          marketId: market.id
        });
      }
    }

    let subtotal = 0;
    const orderItems: any[] = [];

    for (const cartItem of items) {
      const product = products.find(p => p.id === cartItem.id);
      if (!product) return res.status(404).json({ message: `Product ${cartItem.id} not found` });

      // Pre-check stock (for a fast user-facing error — the hard check is inside the transaction)
      if (product.stockQuantity !== null) {
        const available = Number(product.stockQuantity) - Number(product.reservedQuantity);
        if (cartItem.quantity > available) {
          return res.status(400).json({
            message: `Only ${available} units of "${product.name}" available`,
            productId: product.id
          });
        }
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

    // Validate and apply promo code — atomic to prevent race conditions on limited-use codes
    let discountNgn = 0;
    let validatedPromoCode: string | undefined;
    if (promoCode) {
      const now = new Date();
      const appliedPromo = await prisma.$transaction(async (tx) => {
        const promo = await tx.promotion.findFirst({
          where: { code: promoCode.toUpperCase(), isActive: true, validFrom: { lte: now }, validTo: { gte: now } }
        });
        if (!promo) return null;
        if (promo.maxUsesTotal && promo.usedCount >= promo.maxUsesTotal) return null;
        if (promo.minOrderNgn && subtotal < Number(promo.minOrderNgn)) return null;

        // Atomic increment with guard — if another request already exhausted the code, count === 0
        const updated = await tx.promotion.updateMany({
          where: {
            id: promo.id,
            OR: [{ maxUsesTotal: null }, { usedCount: { lt: promo.maxUsesTotal! } }]
          },
          data: { usedCount: { increment: 1 } }
        });
        if (updated.count === 0) return null;
        return promo;
      });

      if (appliedPromo) {
        discountNgn = appliedPromo.discountType === 'PERCENTAGE'
          ? Math.round(subtotal * Number(appliedPromo.discountValue) / 100)
          : Math.min(Number(appliedPromo.discountValue), subtotal);
        validatedPromoCode = appliedPromo.code;
      }
    }

    const serviceFeeAmount = Math.round(subtotal * 0.05);

    // Delivery fee: consolidated if multiple markets, else per-market rate
    const uniqueMarketIds = [...new Set(orderItems.map((i: any) => i.marketId))];
    let deliveryFeeAmount: number;
    if (uniqueMarketIds.length > 1) {
      deliveryFeeAmount = Number(deliveryZone.consolidatedDeliveryFeeNgn);
    } else {
      const rate = await prisma.marketDeliveryRate.findUnique({
        where: { marketId_deliveryZoneId: { marketId: uniqueMarketIds[0], deliveryZoneId } }
      });
      deliveryFeeAmount = rate ? Number(rate.priceNgn) : Number(deliveryZone.deliveryFeeNgn);
    }
    const totalAmount = subtotal + deliveryFeeAmount + serviceFeeAmount - discountNgn;

    // Reserve stock and create order in a transaction
    // The stock reservation uses a conditional update (atomic guard) to prevent
    // TOCTOU race conditions where two concurrent requests both pass the pre-check.
    const order = await prisma.$transaction(async (tx) => {
      for (const cartItem of items) {
        const product = products.find(p => p.id === cartItem.id);
        if (!product || product.stockQuantity === null) continue;

        // Atomically increment reservedQuantity only if enough stock remains
        const updated = await tx.product.updateMany({
          where: {
            id: product.id,
            stockQuantity: { not: null },
            // available = stockQuantity - reservedQuantity >= requested quantity
            // Prisma doesn't support column-to-column comparisons in where, so we use raw:
          },
          data: { reservedQuantity: { increment: cartItem.quantity } }
        });

        // Verify the stock is still valid after increment (re-read inside tx)
        const fresh = await tx.product.findUnique({
          where: { id: product.id },
          select: { stockQuantity: true, reservedQuantity: true, name: true }
        });
        if (fresh && fresh.stockQuantity !== null) {
          if (Number(fresh.reservedQuantity) > Number(fresh.stockQuantity)) {
            // Rollback by decrementing — transaction will abort via thrown error
            throw Object.assign(
              new Error(`Not enough stock for "${fresh.name}"`),
              { status: 400, productId: product.id }
            );
          }
        }
      }

      return tx.order.create({
        data: {
          orderNumber: `AYF-${Date.now()}-${Math.random().toString(36).slice(2,5).toUpperCase()}`,
          userId,
          status: 'PENDING_PAYMENT',
          deliveryAddressId,
          deliveryZoneId,
          subtotalNgn: subtotal,
          deliveryFeeNgn: deliveryFeeAmount,
          serviceFeeNgn: serviceFeeAmount,
          discountNgn,
          promoCode: validatedPromoCode,
          totalNgn: Math.max(0, totalAmount),
          items: { create: orderItems }
        },
        include: { items: true }
      });
    });

    const paymentReference = `FLW-${order.id.slice(0, 8).toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

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
        subtotal,
        discountNgn,
        promoCode: validatedPromoCode,
        total: Number(order.totalNgn)
      },
      paymentReference,
      flutterwavePayload
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    if (error?.status === 400) return res.status(400).json({ message: error.message, productId: error.productId });
    logger.error('initiatePayment failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getMarketCutoffs = async (req: Request, res: Response) => {
  try {
    const schema = z.object({ marketIds: z.array(z.string().uuid()).min(1) });
    const { marketIds } = schema.parse(req.body);

    const markets = await prisma.market.findMany({
      where: { id: { in: marketIds } },
      include: { runDays: { orderBy: { dayOfWeek: 'asc' } } }
    });

    const now = new Date();
    const todayDay = now.getDay();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const result = markets.map(market => {
      const runDays = market.runDays;
      if (runDays.length === 0) {
        return { marketId: market.id, marketName: market.name, hasSchedule: false, nextCutoff: null, minutesUntilCutoff: null, isOpen: false };
      }

      // Find the next upcoming cutoff (could be today if not yet passed, else next week's first day)
      let bestDiff = Infinity;
      let nextRunDay: typeof runDays[0] | null = null;
      let nextDeliveryDate: Date | null = null;

      for (const rd of runDays) {
        const dayDiff = (rd.dayOfWeek - todayDay + 7) % 7;
        const cutoffMinutes = rd.cutoffHour * 60 + rd.cutoffMinute;

        if (dayDiff === 0) {
          // Today — check if cutoff still in future
          if (nowMinutes < cutoffMinutes) {
            const minsLeft = cutoffMinutes - nowMinutes;
            if (minsLeft < bestDiff) {
              bestDiff = minsLeft;
              nextRunDay = rd;
              nextDeliveryDate = new Date(now);
            }
          }
        } else {
          // Future day — cutoff is (dayDiff * 1440 - nowMinutes + cutoffMinutes) minutes away
          const totalMins = dayDiff * 1440 - nowMinutes + cutoffMinutes;
          if (totalMins < bestDiff) {
            bestDiff = totalMins;
            nextRunDay = rd;
            nextDeliveryDate = new Date(now);
            nextDeliveryDate.setDate(now.getDate() + dayDiff);
          }
        }
      }

      // If no future cutoff found this week, use first run day next week
      if (!nextRunDay) {
        nextRunDay = runDays[0];
        const dayDiff = (nextRunDay.dayOfWeek - todayDay + 7) % 7 || 7;
        bestDiff = dayDiff * 1440 - nowMinutes + nextRunDay.cutoffHour * 60 + nextRunDay.cutoffMinute;
        nextDeliveryDate = new Date(now);
        nextDeliveryDate.setDate(now.getDate() + dayDiff);
      }

      const cutoffStr = `${String(nextRunDay.cutoffHour).padStart(2, '0')}:${String(nextRunDay.cutoffMinute).padStart(2, '0')}`;
      const isOpen = bestDiff > 0;
      const isApproaching = isOpen && bestDiff <= 120; // within 2 hours

      return {
        marketId: market.id,
        marketName: market.name,
        hasSchedule: true,
        isOpen,
        isApproaching,
        minutesUntilCutoff: Math.max(0, Math.round(bestDiff)),
        cutoffTime: cutoffStr,
        nextDeliveryDate: nextDeliveryDate?.toISOString().split('T')[0] ?? null,
        dayName: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][nextRunDay.dayOfWeek]
      };
    });

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('getMarketCutoffs failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const handleFlutterwaveWebhook = async (req: Request, res: Response) => {
  try {
    const { data } = req.body;

    if (!data || !data.id) {
      return res.status(400).json({ message: 'Invalid webhook payload' });
    }

    // Flutterwave sends the secret hash set in the dashboard as "verif-hash" — always required
    const receivedHash = req.headers['verif-hash'] as string | undefined;
    const expectedHash = process.env.FLUTTERWAVE_WEBHOOK_HASH;
    if (!expectedHash || receivedHash !== expectedHash) {
      logger.warn('Invalid Flutterwave webhook signature');
      return res.status(401).json({ message: 'Invalid signature' });
    }

    const paymentStatus = data.status;
    const txRef = data.tx_ref as string | undefined;
    if (!txRef) return res.status(400).json({ message: 'Missing tx_ref' });

    // ── Group Buy payment branch (GBY- prefix) ───────────────────────────────
    if (txRef.startsWith('GBY-')) {
      const { handleGroupBuyWebhook } = await import('./groupBuyWebhookHandler');
      return handleGroupBuyWebhook(req, res, txRef, paymentStatus, data);
    }

    // ── Cleaning deposit branch (CLN- prefix) ────────────────────────────────
    if (txRef.startsWith('CLN-')) {
      const { handleCleaningDepositWebhook } = await import('./cleaningController');
      await handleCleaningDepositWebhook(txRef, paymentStatus);
      return res.status(200).json({ message: 'Cleaning deposit webhook processed' });
    }

    const payment = await prisma.payment.findUnique({ where: { reference: txRef } });
    if (payment) {
      // Idempotency: if already in a terminal state, skip reprocessing
      if (payment.status === 'COMPLETED' || payment.status === 'FAILED') {
        return res.status(200).json({ message: 'Already processed' });
      }

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
      const orderIdMatch = data.meta?.orderId as string | undefined;
      if (orderIdMatch) {
        const newOrderStatus = paymentStatus === 'successful' ? 'PAYMENT_CONFIRMED' : 'PENDING_PAYMENT';
        // Guard: never overwrite a CANCELLED order (e.g. already expired by the 15-min job)
        const updateResult = await prisma.order.updateMany({
          where: { id: orderIdMatch, status: { not: 'CANCELLED' } },
          data: { status: newOrderStatus }
        });
        if (updateResult.count === 0) {
          logger.warn('Webhook: order already CANCELLED, skipping status update', { orderIdMatch, paymentStatus });
        }

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
