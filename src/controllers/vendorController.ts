import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  unit: z.string().optional(),
  isActive: z.boolean().optional()
});

async function getVendorForUser(userId: string) {
  return prisma.vendor.findFirst({ where: { userId } });
}

export const getMyVendorProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const vendor = await prisma.vendor.findFirst({
      where: { userId },
      include: {
        market: { select: { id: true, name: true } },
        _count: { select: { products: true, orderItems: true } }
      }
    });
    if (!vendor) return res.status(404).json({ message: 'No vendor profile linked to this account' });
    res.json(vendor);
  } catch (error) {
    logger.error('getMyVendorProfile failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getMyProducts = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const vendor = await getVendorForUser(userId);
    if (!vendor) return res.status(404).json({ message: 'No vendor profile linked to this account' });

    const products = await prisma.product.findMany({
      where: { vendorId: vendor.id },
      include: {
        priceEntries: { where: { isCurrent: true }, take: 1 },
        category: { select: { name: true } },
        _count: { select: { orderItems: true } }
      },
      orderBy: { name: 'asc' }
    });
    res.json(products);
  } catch (error) {
    logger.error('getMyProducts failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateMyProduct = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const productId = String(req.params['productId']);
    const data = updateProductSchema.parse(req.body);

    const vendor = await getVendorForUser(userId);
    if (!vendor) return res.status(404).json({ message: 'No vendor profile linked' });

    const product = await prisma.product.findFirst({ where: { id: productId, vendorId: vendor.id } });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const updated = await prisma.product.update({ where: { id: productId }, data });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('updateMyProduct failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getMyVendorOrders = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const vendor = await getVendorForUser(userId);
    if (!vendor) return res.status(404).json({ message: 'No vendor profile linked' });

    const orderItems = await prisma.orderItem.findMany({
      where: { vendorId: vendor.id },
      include: {
        order: {
          select: {
            id: true, orderNumber: true, status: true, createdAt: true, totalNgn: true,
            user: { select: { fullName: true, phone: true } }
          }
        },
        product: { select: { name: true, unit: true } }
      },
      orderBy: { order: { createdAt: 'desc' } },
      take: 50
    });

    res.json(orderItems);
  } catch (error) {
    logger.error('getMyVendorOrders failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const uploadProductImage = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const productId = String(req.params['productId']);
    const file = (req as any).file as { path: string } | undefined;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    const vendor = await getVendorForUser(userId);
    if (!vendor) return res.status(404).json({ message: 'No vendor profile linked' });

    const product = await prisma.product.findFirst({ where: { id: productId, vendorId: vendor.id } });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const updatedImages = [...(product.imageUrls ?? []), file.path];
    const updated = await prisma.product.update({
      where: { id: productId },
      data: { imageUrls: updatedImages }
    });

    res.json({ imageUrl: file.path, imageUrls: updated.imageUrls, product: updated });
  } catch (error) {
    logger.error('uploadProductImage failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getVendorStats = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const vendor = await getVendorForUser(userId);
    if (!vendor) return res.status(404).json({ message: 'No vendor profile linked' });

    const [productCount, orderItemCount, reviews, revenueAgg] = await Promise.all([
      prisma.product.count({ where: { vendorId: vendor.id, isActive: true } }),
      prisma.orderItem.count({ where: { vendorId: vendor.id } }),
      prisma.review.findMany({
        where: { vendorId: vendor.id },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { fullName: true } } }
      }),
      prisma.orderItem.aggregate({
        where: { vendorId: vendor.id },
        _sum: { subtotalNgn: true }
      })
    ]);

    res.json({
      vendor,
      stats: {
        activeProducts: productCount,
        totalOrderItems: orderItemCount,
        totalRevenue: revenueAgg._sum?.subtotalNgn ?? 0,
        ratingAverage: vendor.ratingAverage,
        totalOrdersFulfilled: vendor.totalOrdersFulfilled
      },
      recentReviews: reviews
    });
  } catch (error) {
    logger.error('getVendorStats failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};
