import prisma from '../config/db';
import { NotificationType } from '@prisma/client';
import { io } from '../server';
import logger from '../utils/logger';

interface NotifyPayload {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

async function createAndEmit(payload: NotifyPayload): Promise<void> {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: payload.data ? JSON.stringify(payload.data) : undefined,
      },
    });
    io.to(`user:${payload.userId}`).emit('notification', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: payload.data ?? null,
      createdAt: notification.createdAt,
    });
  } catch (err) {
    logger.error('Failed to create notification', { err, userId: payload.userId });
  }
}

async function notifyAll(
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  await Promise.all(userIds.map(userId => createAndEmit({ userId, type, title, body, data })));
}

async function allCustomerIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
    select: { id: true },
  });
  return users.map(u => u.id);
}

// ── Public notification triggers ─────────────────────────────────────────────

export async function notifyNewGroupBuy(eventId: string, title: string, totalSlots: number): Promise<void> {
  const ids = await allCustomerIds();
  await notifyAll(
    ids,
    'GROUP_BUY_NEW',
    `New Group Buy: ${title}`,
    `${totalSlots} slots available — join now before they're gone!`,
    { eventId }
  );
}

export async function notifyReservationConfirmed(userId: string, eventId: string, title: string, slotsCount: number): Promise<void> {
  await createAndEmit({
    userId,
    type: 'GROUP_BUY_RESERVATION_CONFIRMED',
    title: 'Reservation confirmed!',
    body: `You've reserved ${slotsCount} slot${slotsCount > 1 ? 's' : ''} for "${title}".`,
    data: { eventId },
  });
}

export async function notifyAlmostFull(eventId: string, title: string, slotsLeft: number): Promise<void> {
  // Notify customers who haven't reserved yet
  const reservedCustomerIds = (
    await prisma.groupBuySlot.findMany({ where: { eventId }, select: { customerId: true } })
  ).map(s => s.customerId);

  const ids = await allCustomerIds();
  const targets = ids.filter(id => !reservedCustomerIds.includes(id));
  await notifyAll(
    targets,
    'GROUP_BUY_ALMOST_FULL',
    `Almost full: ${title}`,
    `Only ${slotsLeft} slot${slotsLeft > 1 ? 's' : ''} left — reserve yours now!`,
    { eventId }
  );
}

export async function notifyEventFull(eventId: string, title: string, paymentDeadlineHours: number): Promise<void> {
  const slots = await prisma.groupBuySlot.findMany({
    where: { eventId, status: 'RESERVED' },
    select: { customerId: true },
  });
  await notifyAll(
    slots.map(s => s.customerId),
    'GROUP_BUY_FULL',
    `${title} is full — pay now!`,
    `All slots are claimed. You have ${paymentDeadlineHours} hours to complete payment or your slot will be released.`,
    { eventId }
  );
}

export async function notifyPaymentReminder(eventId: string, title: string, hoursLeft: number): Promise<void> {
  const slots = await prisma.groupBuySlot.findMany({
    where: { eventId, status: 'RESERVED' },
    select: { customerId: true },
  });
  await notifyAll(
    slots.map(s => s.customerId),
    'GROUP_BUY_PAYMENT_REMINDER',
    `Payment reminder: ${title}`,
    `${hoursLeft} hour${hoursLeft > 1 ? 's' : ''} left to pay for your slot or it will be released.`,
    { eventId }
  );
}

export async function notifySlotReleased(userId: string, eventId: string, title: string): Promise<void> {
  await createAndEmit({
    userId,
    type: 'GROUP_BUY_SLOT_RELEASED',
    title: 'Your slot was released',
    body: `Payment was not received in time for "${title}". Your slot has been released.`,
    data: { eventId },
  });
}

export async function notifyWaitlistOffer(userId: string, eventId: string, title: string): Promise<void> {
  await createAndEmit({
    userId,
    type: 'GROUP_BUY_WAITLIST_OFFER',
    title: 'A slot opened up!',
    body: `A slot is available for "${title}". You have 30 minutes to reserve it.`,
    data: { eventId },
  });
}

export async function notifyEventConfirmed(eventId: string, title: string): Promise<void> {
  const slots = await prisma.groupBuySlot.findMany({
    where: { eventId, status: 'PAID' },
    select: { customerId: true },
  });
  await notifyAll(
    slots.map(s => s.customerId),
    'GROUP_BUY_CONFIRMED',
    `Group buy confirmed: ${title}`,
    `All slots are paid. We're coordinating your order — we'll keep you updated!`,
    { eventId }
  );
}

export async function notifyEventCancelled(eventId: string, title: string, reason?: string): Promise<void> {
  const slots = await prisma.groupBuySlot.findMany({
    where: { eventId },
    select: { customerId: true },
  });
  const waitlist = await prisma.groupBuyWaitlist.findMany({
    where: { eventId },
    select: { customerId: true },
  });
  const allIds = [...new Set([...slots.map(s => s.customerId), ...waitlist.map(w => w.customerId)])];
  await notifyAll(
    allIds,
    'GROUP_BUY_CANCELLED',
    `Group buy cancelled: ${title}`,
    reason ?? 'This group buy has been cancelled. Any payments made will be refunded.',
    { eventId }
  );
}

export async function notifyEventFulfilled(eventId: string, title: string): Promise<void> {
  const slots = await prisma.groupBuySlot.findMany({
    where: { eventId, status: 'PAID' },
    select: { customerId: true },
  });
  await notifyAll(
    slots.map(s => s.customerId),
    'GROUP_BUY_FULFILLED',
    `Delivered: ${title}`,
    `Your group buy order has been fulfilled. Thank you for participating!`,
    { eventId }
  );
}

export async function notifyUnfilledCancelled(eventId: string, title: string): Promise<void> {
  const slots = await prisma.groupBuySlot.findMany({
    where: { eventId },
    select: { customerId: true },
  });
  await notifyAll(
    slots.map(s => s.customerId),
    'GROUP_BUY_CANCELLED',
    `Group buy didn't fill: ${title}`,
    `Not enough participants joined in time. This group buy has been cancelled.`,
    { eventId }
  );
}
