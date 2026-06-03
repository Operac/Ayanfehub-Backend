import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

const createDisputeSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(3),
  description: z.string().min(5)
});

const updateDisputeSchema = z.object({
  status: z.enum(['OPEN', 'UNDER_INVESTIGATION', 'RESOLVED', 'REJECTED']),
  resolution: z.string().optional()
});

// POST /api/disputes
export const createDispute = async (req: Request, res: Response) => {
  try {
    const { orderId, reason, description } = createDisputeSchema.parse(req.body);
    const userId = (req as any).user?.id;
    const userRole = (req as any).user?.role;

    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Only the customer who placed the order (or an Admin) can raise a dispute
    if (order.userId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ message: 'Unauthorized to raise dispute for this order' });
    }

    const dispute = await prisma.dispute.create({
      data: {
        orderId,
        userId,
        reason,
        description,
        status: 'OPEN'
      },
      include: {
        order: true,
        user: { select: { id: true, fullName: true, email: true, phone: true } }
      }
    });

    return res.status(201).json({ message: 'Dispute raised successfully', dispute });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    logger.error('Error raising dispute', { error: error.message });
    return res.status(500).json({ message: 'Server error raising dispute' });
  }
};

// GET /api/disputes
export const getDisputes = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const userRole = (req as any).user?.role;

    let disputes;

    if (userRole === 'ADMIN') {
      disputes = await prisma.dispute.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          order: true,
          user: { select: { id: true, fullName: true, email: true, phone: true } }
        }
      });
    } else {
      disputes = await prisma.dispute.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          order: true
        }
      });
    }

    return res.json(disputes);
  } catch (error: any) {
    logger.error('Error fetching disputes', { error: error.message });
    return res.status(500).json({ message: 'Server error fetching disputes' });
  }
};

// PATCH /api/disputes/:id
export const updateDisputeStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status, resolution } = updateDisputeSchema.parse(req.body);
    const adminId = (req as any).user?.id;

    const dispute = await prisma.dispute.findUnique({ where: { id } });
    if (!dispute) {
      return res.status(404).json({ message: 'Dispute not found' });
    }

    const updated = await prisma.dispute.update({
      where: { id },
      data: {
        status,
        resolution: resolution || null,
        resolvedAt: ['RESOLVED', 'REJECTED'].includes(status) ? new Date() : null,
        resolvedBy: ['RESOLVED', 'REJECTED'].includes(status) ? adminId : null
      },
      include: {
        order: true,
        user: { select: { id: true, fullName: true, email: true, phone: true } }
      }
    });

    return res.json({ message: 'Dispute updated successfully', dispute: updated });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    logger.error('Error updating dispute', { error: error.message });
    return res.status(500).json({ message: 'Server error updating dispute' });
  }
};
