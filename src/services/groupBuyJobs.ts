import prisma from '../config/db';
import { io } from '../server';
import logger from '../utils/logger';
import * as gbNotify from './groupBuyNotificationService';

const WAITLIST_OFFER_MINUTES = 30;

// ── Job 1: Release unpaid slots when payment deadline passes ──────────────────
// Runs every 15 minutes
async function checkExpiredReservations(): Promise<void> {
  const now = new Date();

  const expiredSlots = await prisma.groupBuySlot.findMany({
    where: { status: 'RESERVED', paymentDeadline: { lt: now } },
    include: { event: { select: { id: true, title: true, status: true, slotsRemaining: true } } },
  });

  if (expiredSlots.length === 0) return;

  for (const slot of expiredSlots) {
    await prisma.$transaction(async (tx) => {
      await tx.groupBuySlot.update({ where: { id: slot.id }, data: { status: 'RELEASED' } });
      // Restore slot count and set event back to OPEN if it was PAYING
      await tx.groupBuyEvent.update({
        where: { id: slot.eventId },
        data: {
          slotsRemaining: { increment: slot.slotsCount },
          ...(slot.event.status === 'PAYING' && { status: 'OPEN' }),
        },
      });
    });

    gbNotify.notifySlotReleased(slot.customerId, slot.eventId, slot.event.title).catch(() => {});
    io.to(`user:${slot.customerId}`).emit('groupBuy:slotReleased', { eventId: slot.eventId });

    logger.info('Released expired group buy slot', { slotId: slot.id, eventId: slot.eventId });

    // Offer to next person on waitlist (FIFO)
    const nextWaiting = await prisma.groupBuyWaitlist.findFirst({
      where: { eventId: slot.eventId, status: 'WAITING' },
      orderBy: { joinedAt: 'asc' },
    });
    if (nextWaiting) {
      await prisma.groupBuyWaitlist.update({
        where: { id: nextWaiting.id },
        data: { status: 'OFFERED', notifiedAt: new Date() },
      });
      gbNotify.notifyWaitlistOffer(nextWaiting.customerId, slot.eventId, slot.event.title).catch(() => {});
      logger.info('Offered waitlist slot', { waitlistId: nextWaiting.id, eventId: slot.eventId });
    }
  }
}

// ── Job 2: Expire waitlist offers that weren't acted on within 30 minutes ─────
// Runs every 5 minutes
async function expireWaitlistOffers(): Promise<void> {
  const cutoff = new Date(Date.now() - WAITLIST_OFFER_MINUTES * 60 * 1000);

  const expiredOffers = await prisma.groupBuyWaitlist.findMany({
    where: { status: 'OFFERED', notifiedAt: { lt: cutoff } },
    include: { event: { select: { id: true, title: true } } },
  });

  if (expiredOffers.length === 0) return;

  for (const offer of expiredOffers) {
    await prisma.groupBuyWaitlist.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } });
    logger.info('Expired waitlist offer', { waitlistId: offer.id, eventId: offer.eventId });

    // Move to next person on waitlist for this event
    const nextWaiting = await prisma.groupBuyWaitlist.findFirst({
      where: { eventId: offer.eventId, status: 'WAITING' },
      orderBy: { joinedAt: 'asc' },
    });
    if (nextWaiting) {
      await prisma.groupBuyWaitlist.update({
        where: { id: nextWaiting.id },
        data: { status: 'OFFERED', notifiedAt: new Date() },
      });
      gbNotify.notifyWaitlistOffer(nextWaiting.customerId, offer.eventId, offer.event.title).catch(() => {});
    }
  }
}

// ── Job 3: Cancel events that hit their reservation deadline unfilled ──────────
// Runs every hour
async function cancelUnfilledEvents(): Promise<void> {
  const now = new Date();

  const staleEvents = await prisma.groupBuyEvent.findMany({
    where: { status: 'OPEN', reservationDeadline: { lt: now }, deletedAt: null },
  });

  for (const event of staleEvents) {
    await prisma.groupBuyEvent.update({ where: { id: event.id }, data: { status: 'CANCELLED' } });
    // Release all reserved slots
    await prisma.groupBuySlot.updateMany({
      where: { eventId: event.id, status: 'RESERVED' },
      data: { status: 'RELEASED' },
    });
    gbNotify.notifyUnfilledCancelled(event.id, event.title).catch(() => {});
    logger.info('Cancelled unfilled group buy event', { eventId: event.id, title: event.title });
  }
}

// ── Payment reminders ─────────────────────────────────────────────────────────
// Runs every 30 minutes alongside the expiry check
async function sendPaymentReminders(): Promise<void> {
  const now = new Date();
  const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const in2h  = new Date(now.getTime() + 2  * 60 * 60 * 1000);
  // 30-min window so we don't double-send (job runs every 15 min)
  const windowMs = 30 * 60 * 1000;

  const eventsPayingWithDeadline = await prisma.groupBuyEvent.findMany({
    where: { status: 'PAYING', deletedAt: null },
    include: { slots: { where: { status: 'RESERVED', paymentDeadline: { not: null } } } },
  });

  for (const event of eventsPayingWithDeadline) {
    for (const slot of event.slots) {
      if (!slot.paymentDeadline) continue;
      const deadline = new Date(slot.paymentDeadline);
      const msUntil = deadline.getTime() - now.getTime();
      // 12-hour window reminder
      if (msUntil > in12h.getTime() - now.getTime() - windowMs && msUntil <= in12h.getTime() - now.getTime()) {
        gbNotify.notifyPaymentReminder(event.id, event.title, 12).catch(() => {});
      }
      // 2-hour window reminder
      if (msUntil > in2h.getTime() - now.getTime() - windowMs && msUntil <= in2h.getTime() - now.getTime()) {
        gbNotify.notifyPaymentReminder(event.id, event.title, 2).catch(() => {});
      }
    }
  }
}

// ── Start all jobs ────────────────────────────────────────────────────────────

export function startGroupBuyJobs(): void {
  // Job 1 — every 15 minutes
  setInterval(() => {
    checkExpiredReservations().catch(err => logger.error('checkExpiredReservations error', { err }));
    sendPaymentReminders().catch(err => logger.error('sendPaymentReminders error', { err }));
  }, 15 * 60 * 1000);

  // Job 2 — every 5 minutes
  setInterval(() => {
    expireWaitlistOffers().catch(err => logger.error('expireWaitlistOffers error', { err }));
  }, 5 * 60 * 1000);

  // Job 3 — every hour
  setInterval(() => {
    cancelUnfilledEvents().catch(err => logger.error('cancelUnfilledEvents error', { err }));
  }, 60 * 60 * 1000);

  // Run each job once immediately on startup to catch anything missed during downtime
  checkExpiredReservations().catch(() => {});
  expireWaitlistOffers().catch(() => {});
  cancelUnfilledEvents().catch(() => {});

  logger.info('Group buy background jobs started');
}
