import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

export const createSupportMessage = async (req: Request, res: Response) => {
  try {
    // userId is optional (user doesn't have to be logged in to send a support request, but we link it if they are)
    const userId = (req as any).user?.id || null;

    const schema = z.object({
      fullName: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional(),
      subject: z.string().min(3),
      message: z.string().min(10)
    });

    const data = schema.parse(req.body);

    const supportMsg = await prisma.supportMessage.create({
      data: {
        userId,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone || null,
        subject: data.subject,
        message: data.message,
        status: 'OPEN'
      }
    });

    res.status(201).json({
      message: 'Support message submitted successfully. Our help center agent will contact you soon.',
      supportMsg
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('createSupportMessage failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getSupportMessages = async (req: Request, res: Response) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const where = status ? { status } : {};

    const messages = await prisma.supportMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { fullName: true, role: true } }
      }
    });

    res.json(messages);
  } catch (error) {
    logger.error('getSupportMessages failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const resolveSupportMessage = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const exists = await prisma.supportMessage.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ message: 'Support message not found' });

    const updated = await prisma.supportMessage.update({
      where: { id },
      data: { status: 'RESOLVED' }
    });

    res.json({
      message: 'Support message resolved',
      supportMsg: updated
    });
  } catch (error) {
    logger.error('resolveSupportMessage failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};
