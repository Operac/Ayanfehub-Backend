import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';

const createReviewSchema = z.object({
  vendorId: z.string().uuid().optional(),
  artisanId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional()
}).refine(data => data.vendorId || data.artisanId, {
  message: 'Either vendorId or artisanId is required'
});

export const createReview = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { vendorId, artisanId, orderId, rating, comment } = createReviewSchema.parse(req.body);

    if (orderId) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) {
        return res.status(403).json({ message: 'Unauthorized to review this order' });
      }
    }

    const review = await prisma.review.create({
      data: {
        userId,
        vendorId: vendorId || null,
        artisanId: artisanId || null,
        orderId: orderId || null,
        rating,
        comment: comment || null
      },
      include: { user: { select: { id: true, fullName: true, avatarUrl: true } } }
    });

    // Recalculate average rating
    if (vendorId) {
      const avgRating = await prisma.review.aggregate({
        where: { vendorId },
        _avg: { rating: true }
      });
      await prisma.vendor.update({
        where: { id: vendorId },
        data: { ratingAverage: avgRating._avg.rating }
      });
    } else if (artisanId) {
      const avgRating = await prisma.review.aggregate({
        where: { artisanId },
        _avg: { rating: true }
      });
      await prisma.artisan.update({
        where: { id: artisanId },
        data: { ratingAverage: avgRating._avg.rating }
      });
    }

    res.status(201).json(review);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getReviewsByVendor = async (req: Request, res: Response) => {
  try {
    const { vendorId } = z.object({ vendorId: z.string().uuid() }).parse(req.query);

    const reviews = await prisma.review.findMany({
      where: { vendorId },
      include: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const stats = await prisma.review.aggregate({
      where: { vendorId },
      _avg: { rating: true },
      _count: { id: true }
    });

    res.json({
      reviews,
      stats: {
        averageRating: stats._avg.rating || 0,
        totalReviews: stats._count.id
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getReviewsByArtisan = async (req: Request, res: Response) => {
  try {
    const { artisanId } = z.object({ artisanId: z.string().uuid() }).parse(req.query);

    const reviews = await prisma.review.findMany({
      where: { artisanId },
      include: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const stats = await prisma.review.aggregate({
      where: { artisanId },
      _avg: { rating: true },
      _count: { id: true }
    });

    res.json({
      reviews,
      stats: {
        averageRating: stats._avg.rating || 0,
        totalReviews: stats._count.id
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};
