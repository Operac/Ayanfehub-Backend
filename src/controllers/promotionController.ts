import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

const applyCodeSchema = z.object({
  code: z.string().min(1),
  subtotalNgn: z.number().positive()
});

const createPromoSchema = z.object({
  code: z.string().min(3).max(20).toUpperCase(),
  description: z.string().optional(),
  discountType: z.enum(['FIXED', 'PERCENTAGE']),
  discountValue: z.number().positive(),
  minOrderNgn: z.number().optional(),
  maxUsesTotal: z.number().int().positive().optional(),
  validFrom: z.string().optional(),   // ISO date or datetime
  validUntil: z.string().optional(),  // frontend sends validUntil
});

export const applyPromoCode = async (req: Request, res: Response) => {
  try {
    const { code, subtotalNgn } = applyCodeSchema.parse(req.body);
    const now = new Date();

    const promo = await prisma.promotion.findFirst({
      where: {
        code: code.toUpperCase(),
        isActive: true,
        OR: [
          { validFrom: { lte: now } },
          { validFrom: { equals: undefined } },
        ],
        AND: {
          OR: [
            { validTo: { gte: now } },
            { validTo: { equals: undefined } },
          ],
        },
      }
    });

    if (!promo) {
      return res.status(404).json({ message: 'Invalid or expired promo code' });
    }

    if (promo.maxUsesTotal && promo.usedCount >= promo.maxUsesTotal) {
      return res.status(400).json({ message: 'Promo code has reached its usage limit' });
    }

    if (promo.minOrderNgn && subtotalNgn < Number(promo.minOrderNgn)) {
      return res.status(400).json({
        message: `Minimum order of ${Number(promo.minOrderNgn).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' })} required for this code`
      });
    }

    let discountNgn: number;
    if (promo.discountType === 'PERCENTAGE') {
      discountNgn = Math.round(subtotalNgn * (Number(promo.discountValue) / 100));
    } else {
      discountNgn = Math.min(Number(promo.discountValue), subtotalNgn);
    }

    return res.json({
      valid: true,
      code: promo.code,
      description: promo.description,
      discountType: promo.discountType,
      discountValue: Number(promo.discountValue),
      discountNgn,
      finalSubtotal: subtotalNgn - discountNgn,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('applyPromoCode failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

// Admin: create promo code
export const createPromoCode = async (req: Request, res: Response) => {
  try {
    const body = createPromoSchema.parse(req.body);
    const now = new Date();
    const promo = await prisma.promotion.create({
      data: {
        code: body.code,
        description: body.description,
        discountType: body.discountType,
        discountValue: body.discountValue,
        minOrderNgn: body.minOrderNgn,
        maxUsesTotal: body.maxUsesTotal,
        validFrom: body.validFrom ? new Date(body.validFrom) : now,
        validTo: body.validUntil ? new Date(body.validUntil) : new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
      }
    });
    res.status(201).json({ promo });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('createPromoCode failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

// Admin: list promo codes
export const listPromoCodes = async (_req: Request, res: Response) => {
  try {
    const promos = await prisma.promotion.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(promos);
  } catch (error) {
    logger.error('listPromoCodes failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

// Admin: toggle active
export const togglePromoCode = async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const promo = await prisma.promotion.findUnique({ where: { id } });
    if (!promo) return res.status(404).json({ message: 'Promo not found' });
    const updated = await prisma.promotion.update({ where: { id }, data: { isActive: !promo.isActive } });
    res.json({ promo: updated });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('togglePromoCode failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};
