import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/db';
import logger from '../utils/logger';
import * as gbNotify from '../services/groupBuyNotificationService';

const createEventSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  totalSlots: z.number().int().positive(),
  pricePerSlotNgn: z.number().positive(),
  maxSlotsPerCustomer: z.number().int().min(1).default(3),
  paymentDeadlineHours: z.number().int().min(1).default(24),
  reservationDeadline: z.string().datetime(),
});

const editEventSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  totalSlots: z.number().int().positive().optional(),
  maxSlotsPerCustomer: z.number().int().min(1).optional(),
  paymentDeadlineHours: z.number().int().min(1).optional(),
  reservationDeadline: z.string().datetime().optional(),
});

export const createGroupBuyEvent = async (req: Request, res: Response) => {
  try {
    const data = createEventSchema.parse(req.body);
    const adminId = (req as any).user.id;

    const event = await prisma.groupBuyEvent.create({
      data: {
        title: data.title,
        description: data.description,
        imageUrl: data.imageUrl,
        totalSlots: data.totalSlots,
        slotsRemaining: data.totalSlots,
        pricePerSlotNgn: data.pricePerSlotNgn,
        maxSlotsPerCustomer: data.maxSlotsPerCustomer,
        paymentDeadlineHours: data.paymentDeadlineHours,
        reservationDeadline: new Date(data.reservationDeadline),
        status: 'OPEN',
        createdBy: adminId,
      },
    });

    // Notify all customers of the new event (fire-and-forget)
    gbNotify.notifyNewGroupBuy(event.id, event.title, event.totalSlots).catch(err =>
      logger.error('notifyNewGroupBuy failed', { err })
    );

    res.status(201).json({ event });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('createGroupBuyEvent failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const editGroupBuyEvent = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = editEventSchema.parse(req.body);

    const event = await prisma.groupBuyEvent.findUnique({ where: { id, deletedAt: null } });
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.status !== 'OPEN') {
      return res.status(400).json({ message: 'Event can only be edited while status is OPEN' });
    }

    // Price and slots cannot change once the event has any reservations
    if (data.totalSlots !== undefined) {
      const slotCount = await prisma.groupBuySlot.count({ where: { eventId: id } });
      if (slotCount > 0) {
        return res.status(400).json({ message: 'Cannot change total slots after reservations have been made' });
      }
    }

    const updated = await prisma.groupBuyEvent.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
        ...(data.totalSlots && { totalSlots: data.totalSlots, slotsRemaining: data.totalSlots }),
        ...(data.maxSlotsPerCustomer && { maxSlotsPerCustomer: data.maxSlotsPerCustomer }),
        ...(data.paymentDeadlineHours && { paymentDeadlineHours: data.paymentDeadlineHours }),
        ...(data.reservationDeadline && { reservationDeadline: new Date(data.reservationDeadline) }),
      },
    });

    res.json({ event: updated });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('editGroupBuyEvent failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const cancelGroupBuyEvent = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);

    const event = await prisma.groupBuyEvent.findUnique({ where: { id, deletedAt: null } });
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.status === 'CANCELLED' || event.status === 'FULFILLED') {
      return res.status(400).json({ message: `Event is already ${event.status.toLowerCase()}` });
    }

    // If paying or confirmed, mark paid slots as refunded
    await prisma.$transaction(async (tx) => {
      if (event.status === 'PAYING' || event.status === 'CONFIRMED') {
        await tx.groupBuySlot.updateMany({
          where: { eventId: id, status: 'PAID' },
          data: { status: 'REFUNDED' },
        });
      }
      // Release all reserved slots
      await tx.groupBuySlot.updateMany({
        where: { eventId: id, status: 'RESERVED' },
        data: { status: 'RELEASED' },
      });
      await tx.groupBuyEvent.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
    });

    gbNotify.notifyEventCancelled(id, event.title, reason).catch(err =>
      logger.error('notifyEventCancelled failed', { err })
    );

    res.json({ message: 'Event cancelled', eventId: id });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('cancelGroupBuyEvent failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const fulfillGroupBuyEvent = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const event = await prisma.groupBuyEvent.findUnique({ where: { id, deletedAt: null } });
    if (!event) return res.status(404).json({ message: 'Event not found' });
    if (event.status !== 'CONFIRMED') {
      return res.status(400).json({ message: 'Event must be CONFIRMED before it can be fulfilled' });
    }

    await prisma.groupBuyEvent.update({ where: { id }, data: { status: 'FULFILLED' } });

    gbNotify.notifyEventFulfilled(id, event.title).catch(err =>
      logger.error('notifyEventFulfilled failed', { err })
    );

    res.json({ message: 'Event marked as fulfilled', eventId: id });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('fulfillGroupBuyEvent failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const adminListGroupBuyEvents = async (_req: Request, res: Response) => {
  try {
    const events = await prisma.groupBuyEvent.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { slots: true } },
        slots: {
          where: { status: { in: ['RESERVED', 'PAID'] } },
          select: { slotsCount: true, status: true },
        },
      },
    });

    const result = events.map(e => {
      const totalSlotsReserved = e.slots.reduce((s, sl) => s + sl.slotsCount, 0);
      const totalPaid = e.slots.filter(s => s.status === 'PAID').reduce((s, sl) => s + sl.slotsCount, 0);
      const amountCollectedNgn = totalPaid * Number(e.pricePerSlotNgn);
      return {
        id: e.id,
        title: e.title,
        status: e.status,
        totalSlots: e.totalSlots,
        slotsRemaining: e.slotsRemaining,
        slotsReserved: totalSlotsReserved,
        slotsPaid: totalPaid,
        participantCount: e._count.slots,
        pricePerSlotNgn: Number(e.pricePerSlotNgn),
        amountCollectedNgn,
        reservationDeadline: e.reservationDeadline,
        createdAt: e.createdAt,
      };
    });

    res.json(result);
  } catch (error) {
    logger.error('adminListGroupBuyEvents failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const adminGetParticipants = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const event = await prisma.groupBuyEvent.findUnique({ where: { id, deletedAt: null } });
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const slots = await prisma.groupBuySlot.findMany({
      where: { eventId: id },
      include: { customer: { select: { id: true, fullName: true, phone: true, email: true } } },
      orderBy: { reservedAt: 'asc' },
    });

    const participants = slots.map(s => ({
      slotId: s.id,
      customer: s.customer,
      slotsCount: s.slotsCount,
      status: s.status,
      amountNgn: s.slotsCount * Number(event.pricePerSlotNgn),
      paymentReference: s.paymentReference,
      paidAt: s.paidAt,
      reservedAt: s.reservedAt,
      paymentDeadline: s.paymentDeadline,
    }));

    res.json({ event: { id: event.id, title: event.title, status: event.status }, participants });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('adminGetParticipants failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const adminReleaseSlot = async (req: Request, res: Response) => {
  try {
    const { id, slotId } = z.object({ id: z.string().uuid(), slotId: z.string().uuid() }).parse(req.params);

    const slot = await prisma.groupBuySlot.findUnique({ where: { id: slotId } });
    if (!slot || slot.eventId !== id) return res.status(404).json({ message: 'Slot not found' });
    if (slot.status === 'RELEASED' || slot.status === 'REFUNDED') {
      return res.status(400).json({ message: `Slot is already ${slot.status.toLowerCase()}` });
    }

    const event = await prisma.groupBuyEvent.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ message: 'Event not found' });

    await prisma.$transaction(async (tx) => {
      const newStatus = slot.status === 'PAID' ? 'REFUNDED' : 'RELEASED';
      await tx.groupBuySlot.update({ where: { id: slotId }, data: { status: newStatus } });
      // Restore slots_remaining and revert to OPEN if we were in PAYING
      await tx.groupBuyEvent.update({
        where: { id },
        data: {
          slotsRemaining: { increment: slot.slotsCount },
          ...(event.status === 'PAYING' && { status: 'OPEN' }),
        },
      });
    });

    gbNotify.notifySlotReleased(slot.customerId, id, event.title).catch(() => {});

    // Offer to next waitlisted person
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

    res.json({ message: 'Slot released', slotId });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('adminReleaseSlot failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};
