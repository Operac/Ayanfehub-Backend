import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

const idSchema = z.object({ id: z.string().uuid() });

const requestSchema = z.object({
  apartmentId: z.string().uuid(),
  checkInDate: z.string(),
  checkOutDate: z.string(),
  guests: z.number().int().positive()
});

export const searchShortlets = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    const minPrice = parseFloat(String(req.query.minPrice || '0')) || 0;
    const maxPrice = parseFloat(String(req.query.maxPrice || '0')) || undefined;
    const guests = parseInt(String(req.query.guests || '0')) || undefined;

    const apartments = await prisma.apartment.findMany({
      where: {
        isAvailable: true,
        ...(q ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { location: { contains: q, mode: 'insensitive' } }
          ]
        } : {}),
        ...(minPrice > 0 ? { ratePerNight: { gte: minPrice } } : {}),
        ...(maxPrice ? { ratePerNight: { lte: maxPrice } } : {})
      },
      orderBy: { ratePerNight: 'asc' },
      take: 30
    });

    res.json(apartments);
  } catch (error) {
    logger.error('searchShortlets failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getShortlets = async (req: Request, res: Response) => {
  try {
    const apartments = await prisma.apartment.findMany({
      where: { isAvailable: true },
      orderBy: { name: 'asc' }
    });
    res.json(apartments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getShortletById = async (req: Request, res: Response) => {
  try {
    const { id } = idSchema.parse(req.params);
    const apartment = await prisma.apartment.findUnique({ where: { id } });

    if (!apartment) {
      return res.status(404).json({ message: 'Apartment not found' });
    }

    res.json(apartment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const requestBooking = async (req: Request, res: Response) => {
  try {
    const { apartmentId, checkInDate, checkOutDate, guests } = requestSchema.parse(req.body);
    const userId = (req as any).user.id;

    const apartment = await prisma.apartment.findUnique({ where: { id: apartmentId } });
    if (!apartment) {
      return res.status(404).json({ message: 'Apartment not found' });
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    const nights = Math.max(Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)), 1);
    const total = Number(apartment.ratePerNight) * nights;

    const orderNumber = `AYF-SHT-${Date.now()}`;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId,
        status: 'PENDING_PAYMENT',
        subtotalNgn: total,
        deliveryFeeNgn: 0,
        serviceFeeNgn: 0,
        totalNgn: total,
        specialInstructions: JSON.stringify({ type: 'shortlet', apartmentId, checkInDate, checkOutDate, guests })
      }
    });

    res.status(201).json({
      message: 'Booking requested. Waiting for admin confirmation.',
      order
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};
