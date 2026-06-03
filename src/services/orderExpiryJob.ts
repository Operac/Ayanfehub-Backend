import prisma from '../config/db';
import logger from '../utils/logger';

const EXPIRY_MINUTES = 15;

export async function expireStaleOrders(): Promise<void> {
  const cutoff = new Date(Date.now() - EXPIRY_MINUTES * 60 * 1000);

  const stale = await prisma.order.findMany({
    where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } },
    include: { items: { select: { productId: true, quantity: true } } }
  });

  if (stale.length === 0) return;

  for (const order of stale) {
    await prisma.$transaction(async (tx) => {
      // Release reserved stock
      for (const item of order.items) {
        await tx.product.updateMany({
          where: { id: item.productId, stockQuantity: { not: null } },
          data: { reservedQuantity: { decrement: Number(item.quantity) } }
        });
      }

      // Release promo code usage
      if (order.promoCode) {
        await tx.promotion.updateMany({
          where: { code: order.promoCode, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } }
        });
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' }
      });
    });

    logger.info('Expired stale PENDING_PAYMENT order', { orderId: order.id, orderNumber: order.orderNumber });
  }
}

export function startOrderExpiryJob(): void {
  // Run every 5 minutes
  setInterval(() => {
    expireStaleOrders().catch(err => logger.error('Order expiry job error', { err }));
  }, 5 * 60 * 1000);

  // Also run immediately on startup
  expireStaleOrders().catch(err => logger.error('Order expiry job startup error', { err }));
  logger.info(`Order expiry job started (expires PENDING_PAYMENT after ${EXPIRY_MINUTES} minutes)`);
}
