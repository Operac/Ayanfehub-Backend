import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/db';
import logger from '../utils/logger';
import * as gbNotify from '../services/groupBuyNotificationService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function userId(req: Request): string {
  return (req as any).user.id as string;
}

/** Shape a single event, using pre-fetched slot/waitlist maps to avoid N+1 */
function formatEventSync(
  event: any,
  slotMap: Map<string, any>,
  waitlistMap: Map<string, any>
) {
  const mySlot = slotMap.get(event.id) ?? null;
  const waitlistEntry = waitlistMap.get(event.id) ?? null;
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    imageUrl: event.imageUrl,
    totalSlots: event.totalSlots,
    slotsRemaining: event.slotsRemaining,
    slotsFilled: event.totalSlots - event.slotsRemaining,
    pricePerSlotNgn: Number(event.pricePerSlotNgn),
    maxSlotsPerCustomer: event.maxSlotsPerCustomer,
    paymentDeadlineHours: event.paymentDeadlineHours,
    reservationDeadline: event.reservationDeadline,
    status: event.status,
    mySlot: mySlot
      ? {
          id: mySlot.id,
          slotsCount: mySlot.slotsCount,
          status: mySlot.status,
          paymentDeadline: mySlot.paymentDeadline,
          paidAt: mySlot.paidAt,
          totalAmountNgn: mySlot.slotsCount * Number(event.pricePerSlotNgn),
        }
      : null,
    myWaitlistEntry: waitlistEntry
      ? { id: waitlistEntry.id, slotsWanted: waitlistEntry.slotsWanted, status: waitlistEntry.status }
      : null,
  };
}

/** Async version for single-event detail page (keeps the per-event DB query path) */
async function formatEvent(event: any, requestingUserId?: string) {
  const [mySlot, waitlistEntry] = await Promise.all([
    requestingUserId
      ? prisma.groupBuySlot.findUnique({
          where: { eventId_customerId: { eventId: event.id, customerId: requestingUserId } },
        })
      : Promise.resolve(null),
    requestingUserId
      ? prisma.groupBuyWaitlist.findUnique({
          where: { eventId_customerId: { eventId: event.id, customerId: requestingUserId } },
        })
      : Promise.resolve(null),
  ]);
  const slotMap = new Map(mySlot ? [[event.id, mySlot]] : []);
  const waitlistMap = new Map(waitlistEntry ? [[event.id, waitlistEntry]] : []);
  return formatEventSync(event, slotMap, waitlistMap);
}

// ── Customer endpoints ────────────────────────────────────────────────────────

export const listGroupBuyEvents = async (req: Request, res: Response) => {
  try {
    const uid = userId(req);
    const events = await prisma.groupBuyEvent.findMany({
      where: { deletedAt: null, status: { in: ['OPEN', 'FULL', 'PAYING', 'CONFIRMED'] } },
      orderBy: { createdAt: 'desc' },
    });

    if (events.length === 0) return res.json([]);

    // Batch-load this user's slots and waitlist entries in 2 queries (not 2N)
    const eventIds = events.map(e => e.id);
    const [mySlots, myWaitlist] = await Promise.all([
      prisma.groupBuySlot.findMany({
        where: { eventId: { in: eventIds }, customerId: uid },
      }),
      prisma.groupBuyWaitlist.findMany({
        where: { eventId: { in: eventIds }, customerId: uid },
      }),
    ]);
    const slotMap    = new Map(mySlots.map(s => [s.eventId, s]));
    const waitlistMap = new Map(myWaitlist.map(w => [w.eventId, w]));

    const formatted = events.map(e => formatEventSync(e, slotMap, waitlistMap));
    res.json(formatted);
  } catch (error) {
    logger.error('listGroupBuyEvents failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getGroupBuyEvent = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const uid = userId(req);

    const event = await prisma.groupBuyEvent.findUnique({ where: { id, deletedAt: null } });
    if (!event) return res.status(404).json({ message: 'Event not found' });

    // Slot grid: show total/filled counts anonymously (no customer identity revealed)
    const slots = await prisma.groupBuySlot.findMany({
      where: { eventId: id, status: { in: ['RESERVED', 'PAID'] } },
      select: { slotsCount: true, status: true },
    });
    const filledSlots = slots.reduce((sum, s) => sum + s.slotsCount, 0);

    const formatted = await formatEvent(event, uid);
    res.json({ ...formatted, filledSlots });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('getGroupBuyEvent failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const reserveSlots = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { slotsCount } = z.object({ slotsCount: z.number().int().min(1) }).parse(req.body);
    const uid = userId(req);

    const result = await prisma.$transaction(async (tx) => {
      // Lock the event row for update to prevent double-claiming
      const event = await tx.$queryRaw<any[]>`
        SELECT * FROM group_buy_events WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE
      `;
      const ev = event[0];
      if (!ev) throw Object.assign(new Error('Event not found'), { status: 404 });
      if (ev.status !== 'OPEN') throw Object.assign(new Error('Event is not open for reservations'), { status: 400 });
      if (slotsCount > ev.max_slots_per_customer) {
        throw Object.assign(new Error(`Maximum ${ev.max_slots_per_customer} slots per customer`), { status: 400 });
      }
      if (slotsCount > ev.slots_remaining) {
        throw Object.assign(new Error(`Only ${ev.slots_remaining} slot(s) remaining`), { status: 400 });
      }

      // One reservation per customer per event
      const existing = await tx.groupBuySlot.findUnique({
        where: { eventId_customerId: { eventId: id, customerId: uid } },
      });
      if (existing) throw Object.assign(new Error('You already have a reservation for this event'), { status: 409 });

      const slot = await tx.groupBuySlot.create({
        data: { eventId: id, customerId: uid, slotsCount, status: 'RESERVED' },
      });

      const newRemaining = ev.slots_remaining - slotsCount;

      let paymentDeadline: Date | null = null;
      let newStatus = 'OPEN';

      if (newRemaining === 0) {
        // Event just filled — transition FULL then PAYING, set payment deadlines on all slots
        newStatus = 'PAYING';
        paymentDeadline = new Date(Date.now() + ev.payment_deadline_hours * 60 * 60 * 1000);
        await tx.groupBuySlot.updateMany({
          where: { eventId: id, status: 'RESERVED' },
          data: { paymentDeadline },
        });
      }

      await tx.groupBuyEvent.update({
        where: { id },
        data: {
          slotsRemaining: newRemaining,
          status: newStatus as any,
        },
      });

      return { slot, newRemaining, newStatus, paymentDeadline, ev };
    });

    const { slot, newRemaining, newStatus, paymentDeadline, ev } = result;

    // Post-transaction notifications (fire-and-forget)
    gbNotify.notifyReservationConfirmed(uid, id, ev.title, slotsCount).catch(() => {});

    if (newRemaining === 0) {
      gbNotify.notifyEventFull(id, ev.title, ev.payment_deadline_hours).catch(() => {});
    } else if (newRemaining <= 2) {
      gbNotify.notifyAlmostFull(id, ev.title, newRemaining).catch(() => {});
    }

    res.status(201).json({
      slot: {
        id: slot.id,
        slotsCount: slot.slotsCount,
        status: slot.status,
        paymentDeadline,
        totalAmountNgn: slotsCount * Number(ev.price_per_slot_ngn),
      },
      event: { slotsRemaining: newRemaining, status: newStatus },
    });
  } catch (error: any) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('reserveSlots failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const cancelReservation = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const uid = userId(req);

    const event = await prisma.groupBuyEvent.findUnique({ where: { id, deletedAt: null } });
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.status !== 'OPEN') {
      return res.status(400).json({ message: 'Reservations can only be cancelled while the event is OPEN' });
    }

    const slot = await prisma.groupBuySlot.findUnique({
      where: { eventId_customerId: { eventId: id, customerId: uid } },
    });
    if (!slot || slot.status !== 'RESERVED') {
      return res.status(404).json({ message: 'No active reservation found' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.groupBuySlot.update({ where: { id: slot.id }, data: { status: 'RELEASED' } });
      await tx.groupBuyEvent.update({
        where: { id },
        data: { slotsRemaining: { increment: slot.slotsCount } },
      });
    });

    // Offer to next waitlisted person if any
    const nextWaiting = await prisma.groupBuyWaitlist.findFirst({
      where: { eventId: id, status: 'WAITING' },
      orderBy: { joinedAt: 'asc' },
    });
    if (nextWaiting) {
      await prisma.groupBuyWaitlist.update({
        where: { id: nextWaiting.id },
        data: { status: 'OFFERED', notifiedAt: new Date() },
      });
      gbNotify.notifyWaitlistOffer(nextWaiting.customerId, id, event.title).catch(() => {});
    }

    res.json({ message: 'Reservation cancelled' });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('cancelReservation failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const initiateGroupBuyPayment = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const uid = userId(req);

    const event = await prisma.groupBuyEvent.findUnique({ where: { id, deletedAt: null } });
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (!['PAYING', 'FULL'].includes(event.status)) {
      return res.status(400).json({ message: 'Payment is not open for this event yet' });
    }

    const slot = await prisma.groupBuySlot.findUnique({
      where: { eventId_customerId: { eventId: id, customerId: uid } },
    });
    if (!slot) return res.status(404).json({ message: 'No reservation found for this event' });
    if (slot.status === 'PAID') return res.status(400).json({ message: 'Your slot is already paid' });
    if (slot.status !== 'RESERVED') return res.status(400).json({ message: 'Slot is not in a payable state' });

    // Reject if deadline has already passed
    if (slot.paymentDeadline && slot.paymentDeadline < new Date()) {
      return res.status(400).json({ message: 'Payment deadline has passed for this slot' });
    }

    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const amount = slot.slotsCount * Number(event.pricePerSlotNgn);
    // Idempotency: reuse existing reference if slot already has one
    const txRef = slot.paymentReference ?? `GBY-${slot.id.slice(0, 8).toUpperCase()}-${Date.now()}`;

    if (!slot.paymentReference) {
      await prisma.groupBuySlot.update({ where: { id: slot.id }, data: { paymentReference: txRef } });
    }

    res.json({
      success: true,
      paymentReference: txRef,
      amount,
      flutterwavePayload: {
        tx_ref: txRef,
        amount,
        currency: 'NGN',
        payment_options: 'card,ussd,banktransfer',
        customer: {
          email: user.email ?? `user-${uid}@ayanfe.local`,
          phonenumber: user.phone,
          name: user.fullName ?? 'Customer',
        },
        customizations: {
          title: 'Ayanfe Hub — Group Buy',
          description: `Payment for ${slot.slotsCount} slot(s) — ${event.title}`,
        },
        meta: { groupBuySlotId: slot.id, groupBuyEventId: id },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('initiateGroupBuyPayment failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const joinWaitlist = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { slotsWanted } = z.object({ slotsWanted: z.number().int().min(1) }).parse(req.body);
    const uid = userId(req);

    const event = await prisma.groupBuyEvent.findUnique({ where: { id, deletedAt: null } });
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (!['FULL', 'PAYING'].includes(event.status)) {
      return res.status(400).json({ message: 'Waitlist is only available when the event is full' });
    }

    // Cannot join waitlist if already reserved
    const existingSlot = await prisma.groupBuySlot.findUnique({
      where: { eventId_customerId: { eventId: id, customerId: uid } },
    });
    if (existingSlot && existingSlot.status === 'RESERVED') {
      return res.status(409).json({ message: 'You already have a reservation' });
    }

    const existing = await prisma.groupBuyWaitlist.findUnique({
      where: { eventId_customerId: { eventId: id, customerId: uid } },
    });
    if (existing && existing.status === 'WAITING') {
      return res.status(409).json({ message: 'You are already on the waitlist' });
    }

    const entry = await prisma.groupBuyWaitlist.upsert({
      where: { eventId_customerId: { eventId: id, customerId: uid } },
      update: { slotsWanted, status: 'WAITING', notifiedAt: null },
      create: { eventId: id, customerId: uid, slotsWanted, status: 'WAITING' },
    });

    res.status(201).json({ entry });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('joinWaitlist failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const leaveWaitlist = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const uid = userId(req);

    const entry = await prisma.groupBuyWaitlist.findUnique({
      where: { eventId_customerId: { eventId: id, customerId: uid } },
    });
    if (!entry) return res.status(404).json({ message: 'Not on the waitlist for this event' });

    await prisma.groupBuyWaitlist.delete({
      where: { eventId_customerId: { eventId: id, customerId: uid } },
    });

    res.json({ message: 'Removed from waitlist' });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('leaveWaitlist failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getMyGroupBuys = async (req: Request, res: Response) => {
  try {
    const uid = userId(req);

    const slots = await prisma.groupBuySlot.findMany({
      where: { customerId: uid },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            status: true,
            pricePerSlotNgn: true,
            reservationDeadline: true,
          },
        },
      },
      orderBy: { reservedAt: 'desc' },
    });

    const result = slots.map(s => ({
      slotId: s.id,
      slotsCount: s.slotsCount,
      slotStatus: s.status,
      paymentDeadline: s.paymentDeadline,
      paidAt: s.paidAt,
      totalAmountNgn: s.slotsCount * Number(s.event.pricePerSlotNgn),
      event: s.event,
    }));

    res.json(result);
  } catch (error) {
    logger.error('getMyGroupBuys failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};
