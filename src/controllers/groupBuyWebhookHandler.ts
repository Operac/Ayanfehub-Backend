import { Request, Response } from 'express';
import prisma from '../config/db';
import { io } from '../server';
import logger from '../utils/logger';
import * as gbNotify from '../services/groupBuyNotificationService';

export async function handleGroupBuyWebhook(
  _req: Request,
  res: Response,
  txRef: string,
  paymentStatus: string,
  data: any
): Promise<Response> {
  try {
    const slot = await prisma.groupBuySlot.findUnique({ where: { paymentReference: txRef } });
    if (!slot) {
      logger.warn('Group buy webhook: slot not found for txRef', { txRef });
      return res.status(200).json({ message: 'Slot not found — ignoring' });
    }

    // Idempotency: already in terminal state
    if (slot.status === 'PAID' || slot.status === 'RELEASED' || slot.status === 'REFUNDED') {
      return res.status(200).json({ message: 'Already processed' });
    }

    const event = await prisma.groupBuyEvent.findUnique({ where: { id: slot.eventId } });
    if (!event) return res.status(200).json({ message: 'Event not found — ignoring' });

    // Reject payment if event was cancelled before webhook arrived
    if (event.status === 'CANCELLED') {
      logger.warn('Group buy webhook: event already cancelled — rejecting payment', { txRef, eventId: event.id });
      // Slot will be refunded via cancel flow — just acknowledge
      return res.status(200).json({ message: 'Event cancelled — payment will be refunded' });
    }

    if (paymentStatus === 'successful') {
      await prisma.groupBuySlot.update({
        where: { id: slot.id },
        data: { status: 'PAID', paidAt: new Date(), paymentReference: txRef },
      });

      // Notify the customer via socket
      io.to(`user:${slot.customerId}`).emit('groupBuy:paid', { eventId: event.id, slotId: slot.id });

      // Check if ALL slots for this event are now paid
      const unpaidCount = await prisma.groupBuySlot.count({
        where: { eventId: event.id, status: 'RESERVED' },
      });

      if (unpaidCount === 0) {
        await prisma.groupBuyEvent.update({ where: { id: event.id }, data: { status: 'CONFIRMED' } });
        gbNotify.notifyEventConfirmed(event.id, event.title).catch(err =>
          logger.error('notifyEventConfirmed failed', { err })
        );
        io.emit('groupBuy:confirmed', { eventId: event.id });
      }
    } else {
      // Failed/cancelled payment — leave slot as RESERVED so the expiry job can clean it up
      logger.info('Group buy payment failed/cancelled', { txRef, slotId: slot.id });
    }

    return res.status(200).json({ message: 'Group buy webhook processed' });
  } catch (err) {
    logger.error('handleGroupBuyWebhook error', { err, txRef });
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
}
