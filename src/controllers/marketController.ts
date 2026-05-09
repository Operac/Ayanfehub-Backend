import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

export const searchMarkets = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        ...(category ? { category: { name: { equals: category, mode: 'insensitive' } } } : {})
      },
      include: {
        priceEntries: { where: { isCurrent: true }, take: 1 },
        vendor: { select: { id: true, businessName: true } },
        category: { select: { name: true } }
      },
      orderBy: { name: 'asc' },
      take: 50
    });

    const markets = q
      ? await prisma.market.findMany({
          where: { name: { contains: q, mode: 'insensitive' } },
          include: { runDays: true },
          take: 10
        })
      : [];

    res.json({ products, markets });
  } catch (error) {
    logger.error('searchMarkets failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getMarkets = async (req: Request, res: Response) => {
  try {
    const markets = await prisma.market.findMany({
      orderBy: { name: 'asc' },
      include: { runDays: true }
    });
    res.json(markets);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getMarketItems = async (req: Request, res: Response) => {
  try {
    const uuidSchema = z.string().uuid();
    try {
      uuidSchema.parse(req.params.id);
    } catch {
      return res.status(400).json({ message: 'Invalid Market ID' });
    }

    const id = req.params['id'] as string;

    const market = await prisma.market.findUnique({
      where: { id },
      include: { runDays: true }
    });

    if (!market) {
      return res.status(404).json({ message: 'Market not found' });
    }

    const products = await prisma.product.findMany({
      where: { marketId: id as string, isActive: true },
      include: {
        priceEntries: { where: { isCurrent: true }, take: 1 },
        vendor: { select: { id: true, businessName: true, stallReference: true } },
        category: { select: { id: true, name: true, slug: true } }
      },
      orderBy: { name: 'asc' }
    });

    res.json({ market, items: products });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};
