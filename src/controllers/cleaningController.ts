import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import { NotificationType } from '@prisma/client';
import { io } from '../server';
import logger from '../utils/logger';
import {
  sendQuoteEmail,
  sendInspectionScheduledEmail,
  sendCompletionEmail,
  sendDepositConfirmedEmail,
} from '../services/emailService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(req: Request): string {
  return (req as any).user?.id as string;
}

async function generateRequestNumber(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `CLN-${dateStr}-`;
  // Count + random suffix avoids collisions under concurrent submissions
  const count = await prisma.cleaningRequest.count({
    where: { requestNumber: { startsWith: prefix } },
  });
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}${String(count + 1).padStart(4, '0')}-${suffix}`;
}

/** Push a Notification record and emit it via Socket.io */
async function pushNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  data: Record<string, string> = {}
) {
  try {
    const notif = await prisma.notification.create({
      data: { userId, type, title, body, data: JSON.stringify(data), isRead: false },
    });
    io.to(`user:${userId}`).emit('notification', {
      id: notif.id, type: notif.type, title: notif.title,
      body: notif.body, data, isRead: false, createdAt: notif.createdAt,
    });
    return notif;
  } catch (err) {
    logger.error('pushNotification failed', { err, userId });
  }
}

// ── Validation schemas ─────────────────────────────────────────────────────────

// Helper: multipart/form-data sends everything as strings — coerce safely
const coerceInt = z.preprocess(
  v => (v === '' || v == null ? undefined : Number(v)),
  z.number().int().positive().optional()
);
const coerceBool = z.preprocess(
  v => v === 'true' || v === true,
  z.boolean()
);
// multer gives a string when only 1 value, array when multiple — normalise to array
const coerceStringArray = z.preprocess(
  v => (!v ? [] : Array.isArray(v) ? v : [v]),
  z.array(z.string())
);

const submitSchema = z.object({
  category:       z.enum(['HOME', 'OFFICE', 'CONSTRUCTION']),
  serviceTypes:   coerceStringArray.pipe(z.array(z.string().min(1)).min(1)),

  // Property details
  propertyType:   z.string().optional(),
  squareFootage:  coerceInt,
  roomCount:      coerceInt,
  isRecurring:    coerceBool.default(false),
  recurringFreq:  z.enum(['daily', 'weekly']).optional(),

  // Contact person (OFFICE / CONSTRUCTION)
  contactPersonName:  z.string().optional(),
  contactPersonPhone: z.string().optional(),
  contactPersonEmail: z.string().email().optional().or(z.literal('')),
  contactPersonRole:  z.string().optional(),

  // Office-specific
  floorCount:     coerceInt,
  officeLayout:   z.string().optional(),
  specialZones:   coerceStringArray.optional(),
  cleanersNeeded: coerceInt,
  janitorsNeeded: coerceInt,

  // Construction-specific
  constructionType:     z.string().optional(),
  constructionStage:    z.string().optional(),
  siteAccessHours:      z.string().optional(),
  heavyEquipmentOnSite: coerceBool.default(false),
  plotSize:             z.string().optional(),

  // Location & timing
  location:       z.string().min(3),
  preferredDate:  z.string().datetime(),
  preferredTime:  z.string().regex(/^\d{2}:\d{2}$/).optional(),
  specialRequest: z.string().max(1000).optional(),
});

const quoteSchema = z.object({
  quoteAmountNgn:   z.number().positive(),
  depositAmountNgn: z.number().positive(),
  quoteNotes:       z.string().max(1000).optional(),
});

const inspectionSchema = z.object({
  inspectionScheduledAt: z.string().datetime(),
  inspectionNote:        z.string().max(1000).optional(),
});

const inspectionCompleteSchema = z.object({
  crewSizeRecommended: z.number().int().positive().optional(),
  inspectionNote:      z.string().max(1000).optional(),
});

const assignSchema = z.object({
  assignedCleanerName:  z.string().min(1),
  assignedCleanerPhone: z.string().min(7),
});

const statusSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  handoverNote: z.string().optional(),
});

// ── Customer endpoints ─────────────────────────────────────────────────────────

/** POST /api/cleaning — submit a new cleaning request */
export const submitCleaningRequest = async (req: Request, res: Response) => {
  try {
    const userId = uid(req);
    const body   = submitSchema.parse(req.body);

    // Photo URLs from multer-cloudinary
    const photoUrls: string[] = (req.files as Express.Multer.File[] | undefined ?? [])
      .map(f => (f as any).path as string);

    const requestNumber = await generateRequestNumber();

    const record = await prisma.cleaningRequest.create({
      data: {
        requestNumber,
        userId,
        category:      body.category,
        serviceTypes:  body.serviceTypes,
        propertyType:  body.propertyType,
        squareFootage: body.squareFootage,
        roomCount:     body.roomCount,
        isRecurring:   body.isRecurring,
        recurringFreq: body.recurringFreq,

        // Contact person
        contactPersonName:  body.contactPersonName,
        contactPersonPhone: body.contactPersonPhone,
        contactPersonEmail: body.contactPersonEmail,
        contactPersonRole:  body.contactPersonRole,

        // Office fields
        floorCount:     body.floorCount,
        officeLayout:   body.officeLayout,
        specialZones:   body.specialZones ?? [],
        cleanersNeeded: body.cleanersNeeded,
        janitorsNeeded: body.janitorsNeeded,

        // Construction fields
        constructionType:     body.constructionType,
        constructionStage:    body.constructionStage,
        siteAccessHours:      body.siteAccessHours,
        heavyEquipmentOnSite: body.heavyEquipmentOnSite,
        plotSize:             body.plotSize,

        // Assessment type: CONSTRUCTION always IN_PERSON, HOME always REMOTE, OFFICE depends on size
        assessmentType: body.category === 'CONSTRUCTION' ? 'IN_PERSON'
          : body.category === 'HOME' ? 'REMOTE'
          : (body.squareFootage && body.squareFootage > 500) ? 'IN_PERSON' : 'REMOTE',

        location:      body.location,
        preferredDate: new Date(body.preferredDate),
        preferredTime: body.preferredTime,
        photoUrls,
        specialRequest: body.specialRequest,
        status:        'PENDING_QUOTE',
      },
    });

    await pushNotification(
      userId,
      NotificationType.CLEANING_SUBMITTED,
      'Cleaning request received',
      `We received your ${body.category.toLowerCase()} cleaning request (${requestNumber}). We'll send you a quote within 24 hours.`,
      { cleaningRequestId: record.id }
    );

    logger.info('Cleaning request submitted', { requestNumber, userId, category: body.category });

    return res.status(201).json({
      message: 'Request submitted successfully. You will receive a quote within 24 hours.',
      request: record,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('submitCleaningRequest failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** GET /api/cleaning/my — current user's requests */
export const getMyCleaningRequests = async (req: Request, res: Response) => {
  try {
    const userId = uid(req);
    const requests = await prisma.cleaningRequest.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(requests);
  } catch (error: any) {
    logger.error('getMyCleaningRequests failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** GET /api/cleaning/:id */
export const getCleaningRequestById = async (req: Request, res: Response) => {
  try {
    const userId = uid(req);
    const userRole = (req as any).user?.role as string;
    const id = req.params.id as string;

    const record = await prisma.cleaningRequest.findUnique({
      where: { id },
      include: { user: { select: { fullName: true, phone: true, email: true } } },
    });

    if (!record) return res.status(404).json({ message: 'Request not found' });
    if (record.userId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.json(record);
  } catch (error: any) {
    logger.error('getCleaningRequestById failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** POST /api/cleaning/:id/pay-deposit — initiate Flutterwave deposit */
export const initiateDepositPayment = async (req: Request, res: Response) => {
  try {
    const userId = uid(req);
    const id = req.params.id as string;

    const record = await prisma.cleaningRequest.findUnique({ where: { id } });
    if (!record) return res.status(404).json({ message: 'Request not found' });
    if (record.userId !== userId) return res.status(403).json({ message: 'Forbidden' });
    if (record.status !== 'QUOTED') return res.status(400).json({ message: 'No approved quote yet' });
    if (!record.depositAmountNgn) return res.status(400).json({ message: 'Deposit amount not set' });
    if (record.depositPaidAt) return res.status(400).json({ message: 'Deposit already paid' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Always generate a new unique tx_ref per attempt — Flutterwave rejects duplicate references
    const attempt = (record.depositAttempts ?? 0) + 1;
    const txRef = `CLN-${record.id.slice(0, 8).toUpperCase()}-${attempt}`;

    await prisma.cleaningRequest.update({
      where: { id },
      data: { paymentReference: txRef, depositAttempts: attempt }
    });

    const amount = Number(record.depositAmountNgn);

    return res.json({
      success: true,
      paymentReference: txRef,
      amount,
      flutterwavePayload: {
        tx_ref:          txRef,
        amount,
        currency:        'NGN',
        payment_options: 'card,ussd,banktransfer',
        customer: {
          email:       user.email ?? `user-${userId}@ayanfe.local`,
          phonenumber: user.phone,
          name:        user.fullName ?? 'Customer',
        },
        customizations: {
          title:       'Ayanfe Hub — Cleaning Deposit',
          description: `Deposit for ${record.category.toLowerCase()} cleaning (${record.requestNumber})`,
        },
        meta: { cleaningRequestId: id },
      },
    });
  } catch (error: any) {
    logger.error('initiateDepositPayment failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** DELETE /api/cleaning/:id — cancel a request */
export const cancelCleaningRequest = async (req: Request, res: Response) => {
  try {
    const userId = uid(req);
    const id = req.params.id as string;

    const record = await prisma.cleaningRequest.findUnique({ where: { id } });
    if (!record) return res.status(404).json({ message: 'Request not found' });
    if (record.userId !== userId) return res.status(403).json({ message: 'Forbidden' });
    if (!['PENDING_QUOTE', 'INSPECTION_SCHEDULED', 'QUOTED'].includes(record.status)) {
      return res.status(400).json({ message: 'Cannot cancel a request that is already in progress or completed' });
    }

    const updated = await prisma.cleaningRequest.update({
      where: { id },
      data:  { status: 'CANCELLED' },
    });

    return res.json({ message: 'Request cancelled', request: updated });
  } catch (error: any) {
    logger.error('cancelCleaningRequest failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── Admin endpoints ────────────────────────────────────────────────────────────

/** GET /api/admin/cleaning */
export const adminListCleaningRequests = async (req: Request, res: Response) => {
  try {
    const querySchema = z.object({
      status:   z.enum(['PENDING_QUOTE','INSPECTION_SCHEDULED','QUOTED','DEPOSIT_PAID','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED']).optional(),
      category: z.enum(['HOME','OFFICE','CONSTRUCTION']).optional(),
      page:     z.string().optional(),
      limit:    z.string().optional(),
    });
    const { status, category, page = '1', limit = '20' } = querySchema.parse(req.query);

    const where: any = {};
    if (status)   where.status   = status;
    if (category) where.category = category;

    const take   = Math.min(parseInt(limit, 10) || 20, 50);
    const skip   = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;
    const [total, requests] = await Promise.all([
      prisma.cleaningRequest.count({ where }),
      prisma.cleaningRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          user: { select: { fullName: true, phone: true, email: true } },
        },
      }),
    ]);

    return res.json({ data: requests, total, page: parseInt(page, 10), limit: take });
  } catch (error: any) {
    logger.error('adminListCleaningRequests failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** POST /api/admin/cleaning/:id/schedule-inspection — schedule in-person visit */
export const adminScheduleInspection = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { inspectionScheduledAt, inspectionNote } = inspectionSchema.parse(req.body);

    const record = await prisma.cleaningRequest.findUnique({
      where:   { id },
      include: { user: { select: { fullName: true, email: true } } },
    });
    if (!record) return res.status(404).json({ message: 'Request not found' });
    if (!['PENDING_QUOTE', 'INSPECTION_SCHEDULED'].includes(record.status)) {
      return res.status(400).json({ message: 'Can only schedule (or reschedule) inspection for PENDING_QUOTE or INSPECTION_SCHEDULED requests' });
    }
    if (!['OFFICE', 'CONSTRUCTION'].includes(record.category)) {
      return res.status(400).json({ message: 'Inspection only available for OFFICE and CONSTRUCTION categories' });
    }

    const inspDate = new Date(inspectionScheduledAt);

    const updated = await prisma.cleaningRequest.update({
      where: { id },
      data: {
        inspectionScheduledAt: inspDate,
        inspectionNote,
        assessmentType: 'IN_PERSON',
        status:         'INSPECTION_SCHEDULED',
      },
    });

    const dateStr = inspDate.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = inspDate.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });

    await pushNotification(
      record.userId,
      NotificationType.CLEANING_INSPECTION_SCHEDULED,
      '📋 Inspection Scheduled',
      `We'll visit your ${record.category.toLowerCase()} space on ${dateStr} at ${timeStr} to assess the scope of work. We'll provide a detailed quote within 24 hours after the inspection.`,
      { cleaningRequestId: id }
    );

    if (record.user?.email) {
      await sendInspectionScheduledEmail({
        to:                 record.user.email,
        customerName:       record.user.fullName ?? null,
        requestNumber:      record.requestNumber,
        category:           record.category,
        inspectionDate:     inspDate,
        inspectionNote:     inspectionNote ?? null,
        contactPersonName:  record.contactPersonName ?? null,
        contactPersonPhone: record.contactPersonPhone ?? null,
      });
    }

    io.to(`user:${record.userId}`).emit('cleaning:status', { cleaningRequestId: id, status: 'INSPECTION_SCHEDULED' });

    return res.json({ message: 'Inspection scheduled', request: updated });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('adminScheduleInspection failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** PATCH /api/admin/cleaning/:id/complete-inspection — record inspection findings */
export const adminCompleteInspection = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { crewSizeRecommended, inspectionNote } = inspectionCompleteSchema.parse(req.body);

    // Before photos from multer
    const beforePhotoUrls: string[] = (req.files as Express.Multer.File[] | undefined ?? [])
      .map(f => (f as any).path as string);

    const record = await prisma.cleaningRequest.findUnique({ where: { id } });
    if (!record) return res.status(404).json({ message: 'Request not found' });
    if (record.status !== 'INSPECTION_SCHEDULED') {
      return res.status(400).json({ message: 'Inspection must be scheduled first' });
    }

    const updated = await prisma.cleaningRequest.update({
      where: { id },
      data: {
        crewSizeRecommended,
        inspectionNote,
        inspectionCompletedAt: new Date(),
        beforePhotoUrls: beforePhotoUrls.length > 0 ? beforePhotoUrls : undefined,
        // Stay in INSPECTION_SCHEDULED until admin manually sends quote
        // (inspection is done but quote not yet sent)
      },
    });

    return res.json({ message: 'Inspection findings recorded. You can now send a quote.', request: updated });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('adminCompleteInspection failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** POST /api/admin/cleaning/:id/quote — send quote to customer */
export const adminSendQuote = async (req: Request, res: Response) => {
  try {
    const adminId = uid(req);
    const id = req.params.id as string;
    const { quoteAmountNgn, depositAmountNgn, quoteNotes } = quoteSchema.parse(req.body);

    const record = await prisma.cleaningRequest.findUnique({
      where:   { id },
      include: { user: { select: { fullName: true, email: true } } },
    });
    if (!record) return res.status(404).json({ message: 'Request not found' });
    if (record.status === 'CANCELLED') return res.status(400).json({ message: 'Request is cancelled' });
    if (!['PENDING_QUOTE', 'INSPECTION_SCHEDULED'].includes(record.status)) {
      return res.status(400).json({ message: 'Request is not in a quotable state' });
    }

    const updated = await prisma.cleaningRequest.update({
      where: { id },
      data: {
        quoteAmountNgn,
        depositAmountNgn,
        quoteNotes,
        quotedAt: new Date(),
        quotedBy: adminId,
        status:   'QUOTED',
      },
    });

    await pushNotification(
      record.userId,
      NotificationType.CLEANING_QUOTED,
      '🧹 Your cleaning quote is ready!',
      `Your ${record.category.toLowerCase()} cleaning quote is ₦${quoteAmountNgn.toLocaleString()}. Deposit required: ₦${depositAmountNgn.toLocaleString()}. Tap to view and pay.`,
      { cleaningRequestId: id }
    );

    if (record.user?.email) {
      await sendQuoteEmail({
        to:              record.user.email,
        customerName:    record.user.fullName ?? null,
        requestNumber:   record.requestNumber,
        category:        record.category,
        quoteAmountNgn,
        depositAmountNgn,
        quoteNotes:      quoteNotes ?? null,
      });
    }

    return res.json({ message: 'Quote sent to customer', request: updated });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('adminSendQuote failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** PATCH /api/admin/cleaning/:id/assign */
export const adminAssignCleaner = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { assignedCleanerName, assignedCleanerPhone } = assignSchema.parse(req.body);

    const record = await prisma.cleaningRequest.findUnique({ where: { id } });
    if (!record) return res.status(404).json({ message: 'Request not found' });
    if (record.status !== 'DEPOSIT_PAID') {
      return res.status(400).json({ message: 'Deposit must be paid before assigning a cleaner' });
    }

    const updated = await prisma.cleaningRequest.update({
      where: { id },
      data: {
        assignedCleanerName,
        assignedCleanerPhone,
        assignedAt: new Date(),
        status:     'ASSIGNED',
      },
    });

    await pushNotification(
      record.userId,
      NotificationType.CLEANING_ASSIGNED,
      '✅ Cleaner assigned!',
      `${assignedCleanerName} has been assigned to your cleaning on ${new Date(record.preferredDate).toLocaleDateString('en-NG', { dateStyle: 'medium' })}. They will contact you at ${assignedCleanerPhone}.`,
      { cleaningRequestId: id }
    );

    io.to(`user:${record.userId}`).emit('cleaning:status', { cleaningRequestId: id, status: 'ASSIGNED' });

    return res.json({ message: 'Cleaner assigned', request: updated });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('adminAssignCleaner failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** PATCH /api/admin/cleaning/:id/status */
export const adminUpdateCleaningStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status, handoverNote } = statusSchema.parse(req.body);

    const record = await prisma.cleaningRequest.findUnique({
      where:   { id },
      include: { user: { select: { email: true, fullName: true } } },
    });
    if (!record) return res.status(404).json({ message: 'Request not found' });

    // After photos from multer (optional for COMPLETED)
    const afterPhotoUrls: string[] = (req.files as Express.Multer.File[] | undefined ?? [])
      .map(f => (f as any).path as string);

    const updated = await prisma.cleaningRequest.update({
      where: { id },
      data: {
        status,
        completedAt:    status === 'COMPLETED' ? new Date() : undefined,
        handoverNote:   status === 'COMPLETED' ? handoverNote : undefined,
        afterPhotoUrls: status === 'COMPLETED' && afterPhotoUrls.length > 0 ? afterPhotoUrls : undefined,
      },
    });

    type NotifEntry = { title: string; body: string; ntype: NotificationType };
    const notifMessages: Partial<Record<string, NotifEntry>> = {
      IN_PROGRESS: {
        ntype: NotificationType.CLEANING_IN_PROGRESS,
        title: '🧹 Cleaning in progress',
        body:  `Your cleaner has started working on your property for request ${record.requestNumber}.`,
      },
      COMPLETED: {
        ntype: NotificationType.CLEANING_COMPLETED,
        title: '🎉 Cleaning completed!',
        body:  `Your cleaning is done! We hope everything looks great. Please rate your experience.`,
      },
      CANCELLED: {
        ntype: NotificationType.CLEANING_CANCELLED,
        title: 'Cleaning request cancelled',
        body:  `Your request ${record.requestNumber} has been cancelled. Contact support for assistance.`,
      },
    };

    const notifData = notifMessages[status];
    if (notifData) {
      await pushNotification(record.userId, notifData.ntype, notifData.title, notifData.body, { cleaningRequestId: id });
    }

    // Send completion email
    if (status === 'COMPLETED' && record.user?.email) {
      await sendCompletionEmail({
        to:           record.user.email,
        customerName: record.user.fullName ?? null,
        requestNumber: record.requestNumber,
        handoverNote: handoverNote ?? null,
      });
    }

    io.to(`user:${record.userId}`).emit('cleaning:status', { cleaningRequestId: id, status });

    return res.json({ message: `Status updated to ${status}`, request: updated });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('adminUpdateCleaningStatus failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

// ── HOME Pricing Config ───────────────────────────────────────────────────────

const HOME_PRICING_KEY = 'cleaning_home_pricing';

const homePricingSchema = z.object({
  propertyTypes: z.array(z.object({
    key:   z.string(),  // e.g. "self-contained"
    label: z.string(),  // e.g. "Self-Contained / Studio"
    baseClean:   z.number().positive(),
    deepClean:   z.number().positive(),
    moveInOut:   z.number().positive(),
  })),
  addOns: z.array(z.object({
    key:   z.string(),
    label: z.string(),
    price: z.number().positive(),
  })),
});

/** GET /api/admin/cleaning/pricing — fetch HOME pricing config */
export const getHomePricing = async (_req: Request, res: Response) => {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: HOME_PRICING_KEY } });
    if (!setting) {
      // Return sensible defaults if not yet configured
      return res.json(defaultHomePricing());
    }
    return res.json(JSON.parse(setting.value));
  } catch (error: any) {
    logger.error('getHomePricing failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** PUT /api/admin/cleaning/pricing — update HOME pricing config */
export const updateHomePricing = async (req: Request, res: Response) => {
  try {
    const pricing = homePricingSchema.parse(req.body);
    await prisma.appSetting.upsert({
      where:  { key: HOME_PRICING_KEY },
      update: { value: JSON.stringify(pricing) },
      create: { key: HOME_PRICING_KEY, value: JSON.stringify(pricing) },
    });
    return res.json({ message: 'HOME pricing updated', pricing });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('updateHomePricing failed', { error: error.message });
    return res.status(500).json({ message: 'Server error' });
  }
};

/** GET /api/cleaning/pricing — public endpoint for frontend to show pricing hints */
export const getPublicHomePricing = async (_req: Request, res: Response) => {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: HOME_PRICING_KEY } });
    return res.json(setting ? JSON.parse(setting.value) : defaultHomePricing());
  } catch (error: any) {
    return res.status(500).json({ message: 'Server error' });
  }
};

function defaultHomePricing() {
  return {
    propertyTypes: [
      { key: 'self-contained', label: 'Self-Contained / Studio',   baseClean: 15000, deepClean: 25000, moveInOut: 30000 },
      { key: '1-bed',          label: '1-Bedroom Flat',             baseClean: 20000, deepClean: 35000, moveInOut: 40000 },
      { key: '2-bed',          label: '2-Bedroom Flat',             baseClean: 28000, deepClean: 45000, moveInOut: 52000 },
      { key: '3-bed',          label: '3-Bedroom Flat',             baseClean: 38000, deepClean: 58000, moveInOut: 65000 },
      { key: 'duplex',         label: 'Duplex / Townhouse',         baseClean: 55000, deepClean: 85000, moveInOut: 95000 },
      { key: 'shortlet',       label: 'Shortlet / Serviced Apt',    baseClean: 18000, deepClean: 30000, moveInOut: 35000 },
    ],
    addOns: [
      { key: 'laundry',       label: 'Laundry & Ironing',           price: 8000  },
      { key: 'carpet',        label: 'Carpet / Rug Cleaning',       price: 12000 },
      { key: 'windows',       label: 'Window Washing (interior)',    price: 5000  },
      { key: 'kitchen-deep',  label: 'Deep Kitchen Degreasing',     price: 7000  },
      { key: 'post-party',    label: 'Post-Party Clean-up',         price: 10000 },
    ],
  };
}

// ── Webhook handler (called from checkoutController for CLN- prefix) ───────────

export async function handleCleaningDepositWebhook(
  txRef: string,
  paymentStatus: string
): Promise<void> {
  try {
    // paymentReference is no longer @unique (can change per retry), so use findFirst
    const record = await prisma.cleaningRequest.findFirst({
      where:   { paymentReference: txRef },
      include: { user: { select: { email: true, fullName: true } } },
    });

    if (!record) {
      logger.warn('Cleaning webhook: request not found', { txRef });
      return;
    }

    if (record.depositPaidAt) {
      logger.info('Cleaning webhook: already processed', { txRef });
      return;
    }

    if (paymentStatus === 'successful') {
      await prisma.cleaningRequest.update({
        where: { id: record.id },
        data:  { depositPaidAt: new Date(), status: 'DEPOSIT_PAID' },
      });

      await pushNotification(
        record.userId,
        NotificationType.CLEANING_DEPOSIT_CONFIRMED,
        '💳 Deposit received!',
        `Your deposit of ₦${Number(record.depositAmountNgn).toLocaleString()} has been confirmed for ${record.requestNumber}. We're assigning a cleaner to you now.`,
        { cleaningRequestId: record.id }
      );

      if (record.user?.email) {
        await sendDepositConfirmedEmail({
          to:              record.user.email,
          customerName:    record.user.fullName ?? null,
          requestNumber:   record.requestNumber,
          depositAmountNgn: Number(record.depositAmountNgn),
        });
      }

      io.to(`user:${record.userId}`).emit('cleaning:status', {
        cleaningRequestId: record.id,
        status: 'DEPOSIT_PAID',
      });

      logger.info('Cleaning deposit confirmed', { txRef, requestId: record.id });
    } else {
      logger.info('Cleaning deposit failed/cancelled', { txRef });
    }
  } catch (err: any) {
    logger.error('handleCleaningDepositWebhook failed', { err: err.message });
  }
}
