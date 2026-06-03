import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

const idSchema = z.object({ id: z.string().uuid() });

const bookSchema = z.object({
  artisanId: z.string().uuid(),
  serviceName: z.string().min(1),
  price: z.number().positive(),
  date: z.string(),
  address: z.string().min(5),
  notes: z.string().optional()
});

const requestSchema = z.object({
  artisanId: z.string().uuid().optional(),
  category: z.string(),
  description: z.string().min(10),
  location: z.string().min(5),
  date: z.string(),
  budget: z.string().optional()
});

const profileUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  category: z.string().optional(),
  bio: z.string().optional(),
  phone: z.string().optional(),
  portfolioImages: z.array(z.string()).optional(),
  isAvailable: z.boolean().optional()
});

export const searchArtisans = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const minRating = parseFloat(String(req.query.minRating || '0'));

    const artisans = await prisma.artisan.findMany({
      where: {
        isAvailable: true,
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
        ...(category ? { category: { contains: category, mode: 'insensitive' } } : {}),
        ...(minRating > 0 ? { ratingAverage: { gte: minRating } } : {})
      },
      include: { services: { take: 3 } },
      orderBy: { ratingAverage: 'desc' },
      take: 30
    });

    res.json(artisans);
  } catch (error) {
    logger.error('searchArtisans failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getArtisans = async (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    const artisans = await prisma.artisan.findMany({
      where: {
        isAvailable: true,
        ...(category ? { category: String(category) } : {})
      },
      include: { services: true },
      orderBy: { name: 'asc' }
    });
    res.json(artisans);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getArtisanById = async (req: Request, res: Response) => {
  try {
    const { id } = idSchema.parse(req.params);

    const artisan = await prisma.artisan.findUnique({
      where: { id },
      include: { services: true }
    });

    if (!artisan) {
      return res.status(404).json({ message: 'Artisan not found' });
    }

    res.json({ artisan, services: artisan.services });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const bookArtisan = async (req: Request, res: Response) => {
  try {
    const { artisanId, serviceName, price, date, address, notes } = bookSchema.parse(req.body);
    const userId = (req as any).user.id;

    const orderNumber = `AYF-ART-${Date.now()}`;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId,
        status: 'PAYMENT_CONFIRMED',
        subtotalNgn: price,
        deliveryFeeNgn: 0,
        serviceFeeNgn: 0,
        totalNgn: price,
        specialInstructions: JSON.stringify({ type: 'artisan', artisanId, serviceName, date, address, notes })
      }
    });

    res.status(201).json({ message: 'Booking confirmed', order });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const requestCustomService = async (req: Request, res: Response) => {
  try {
    const { artisanId, category, description, location, date, budget } = requestSchema.parse(req.body);
    const userId = (req as any).user.id;

    const orderNumber = `AYF-REQ-${Date.now()}`;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId,
        status: 'PENDING_PAYMENT',
        subtotalNgn: 0,
        deliveryFeeNgn: 0,
        serviceFeeNgn: 0,
        totalNgn: 0,
        specialInstructions: JSON.stringify({ type: 'artisan_request', artisanId, category, description, location, date, budget })
      }
    });

    res.status(201).json({ message: 'Request submitted. Waiting for quotation.', order });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getArtisanProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    // Find artisan by userId
    const artisan = await prisma.artisan.findFirst({
      where: { userId },
      include: { services: true, reviews: true }
    });

    if (!artisan) {
      return res.status(404).json({ message: 'Artisan profile not found' });
    }

    res.json(artisan);
  } catch (error) {
    logger.error('getArtisanProfile failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateArtisanProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const updateData = profileUpdateSchema.parse(req.body);

    // Find artisan by userId
    const artisan = await prisma.artisan.findFirst({
      where: { userId }
    });

    if (!artisan) {
      return res.status(404).json({ message: 'Artisan profile not found' });
    }

    // Update artisan profile
    const updatedArtisan = await prisma.artisan.update({
      where: { id: artisan.id },
      data: updateData
    });

    res.json(updatedArtisan);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    logger.error('updateArtisanProfile failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getArtisanBookings = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    
    // Find artisan by userId
    const artisan = await prisma.artisan.findFirst({
      where: { userId }
    });

    if (!artisan) {
      return res.status(404).json({ message: 'Artisan profile not found' });
    }

    // Get bookings (orders) for this artisan
    const bookings = await prisma.order.findMany({
      where: {
        specialInstructions: {
          contains: `"artisanId":"${artisan.id}"`
        }
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true
          }
        },
        reviews: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(bookings);
  } catch (error) {
    logger.error('getArtisanBookings failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const uploadPortfolioImage = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const file = (req as any).file as { path: string } | undefined;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    const artisan = await prisma.artisan.findFirst({ where: { userId } });
    if (!artisan) return res.status(404).json({ message: 'No artisan profile linked to this account' });

    const updatedImages = [...(artisan.portfolioImages ?? []), file.path];
    const updated = await prisma.artisan.update({
      where: { id: artisan.id },
      data: { portfolioImages: updatedImages }
    });

    res.json({ imageUrl: file.path, portfolioImages: updated.portfolioImages });
  } catch (error) {
    logger.error('uploadPortfolioImage failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const deletePortfolioImage = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { imageUrl } = z.object({ imageUrl: z.string().url() }).parse(req.body);

    const artisan = await prisma.artisan.findFirst({ where: { userId } });
    if (!artisan) return res.status(404).json({ message: 'No artisan profile linked to this account' });

    const updatedImages = (artisan.portfolioImages ?? []).filter((img: string) => img !== imageUrl);
    const updated = await prisma.artisan.update({
      where: { id: artisan.id },
      data: { portfolioImages: updatedImages }
    });

    res.json({ portfolioImages: updated.portfolioImages });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('deletePortfolioImage failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};
