import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

const partnerTypeSchema = z.enum(['LOGISTICS', 'CORPORATE', 'COMMUNITY']);

export const applyPartner = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || null;
    const schema = z.object({
      partnerType: partnerTypeSchema,
      fullName: z.string().min(2),
      email: z.string().email(),
      phone: z.string().min(10),
      company: z.string().optional(),
      message: z.string().optional()
    });

    const data = schema.parse(req.body);

    const application = await prisma.partnerApplication.create({
      data: {
        userId,
        partnerType: data.partnerType,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        company: data.company || null,
        message: data.message || null,
        status: 'PENDING'
      }
    });

    res.status(201).json({
      message: 'Partnership application submitted successfully. We will get back to you soon.',
      application
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('applyPartner failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getPartnerApplications = async (req: Request, res: Response) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const where = status ? { status } : {};

    const applications = await prisma.partnerApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { fullName: true, role: true } }
      }
    });

    res.json(applications);
  } catch (error) {
    logger.error('getPartnerApplications failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const updatePartnerStatus = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { status } = z.object({
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED'])
    }).parse(req.body);

    const application = await prisma.partnerApplication.findUnique({ where: { id } });
    if (!application) return res.status(404).json({ message: 'Partner application not found' });

    const updated = await prisma.partnerApplication.update({
      where: { id },
      data: { status }
    });

    res.json({
      message: `Partner application status updated to ${status}`,
      application: updated
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('updatePartnerStatus failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};
