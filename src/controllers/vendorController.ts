import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  unit: z.string().optional(),
  isActive: z.boolean().optional(),
  stockQuantity: z.number().int().nonnegative().nullable().optional(),
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

    const page  = Math.max(1, parseInt(String(req.query.page  ?? 1)));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? 20))));
    const skip  = (page - 1) * limit;

    const [total, orderItems] = await Promise.all([
      prisma.orderItem.count({ where: { vendorId: vendor.id } }),
      prisma.orderItem.findMany({
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
        skip,
        take: limit
      })
    ]);

    // Map Prisma field names → frontend-expected aliases
    const mapped = orderItems.map(item => ({
      id:            item.id,
      quantity:      item.quantity,
      unitPriceNgn:  item.priceNgnAtOrder,   // alias
      totalPriceNgn: item.subtotalNgn,        // alias
      sourcingStatus: item.sourcingStatus,
      product:       item.product,
      order:         item.order,
    }));

    res.json({ data: mapped, total, page, limit, pages: Math.ceil(total / limit) });
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

// ─── PRODUCT PRICE UPDATE ─────────────────────────────────────────────────────

/**
 * Vendor updates the price of their own product (creates new PriceEntry)
 */
export const updateProductPrice = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const productId = String(req.params['productId']);
    const { priceNgn } = z.object({ priceNgn: z.number().positive() }).parse(req.body);

    const vendor = await getVendorForUser(userId);
    if (!vendor) return res.status(404).json({ message: 'No vendor profile linked' });

    const product = await prisma.product.findFirst({ where: { id: productId, vendorId: vendor.id } });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Wrap both steps in a transaction to prevent a partial-update state
    // where no current price exists if the process crashes between the two writes.
    const newEntry = await prisma.$transaction(async (tx) => {
      await tx.priceEntry.updateMany({
        where: { productId, isCurrent: true },
        data: { isCurrent: false }
      });
      return tx.priceEntry.create({
        data: {
          productId,
          vendorId: vendor.id,
          priceNgn,
          isCurrent: true,
          recordedBy: userId
        }
      });
    });

    res.json({ message: 'Price updated', priceEntry: newEntry });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('updateProductPrice failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── PRODUCT UPLOAD (APPROVAL WORKFLOW) ───────────────────────────────────────

/**
 * Vendor uploads a product for admin approval
 * Product starts in PENDING_APPROVAL status and won't be visible to customers
 */
export const uploadProduct = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const schema = z.object({
      name: z.string().min(2),
      description: z.string().optional(),
      unit: z.string().min(1),
      categoryId: z.string().uuid().optional(),
      priceNgn: z.number().positive(),
      stockQuantity: z.number().int().positive().optional(),
      imageUrls: z.array(z.string()).optional()
    });

    const data = schema.parse(req.body);

    const vendor = await getVendorForUser(userId);
    if (!vendor) return res.status(404).json({ message: 'No vendor profile linked to this account' });

    // Create product with PENDING_APPROVAL status
    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        marketId: vendor.marketId,
        name: data.name,
        description: data.description,
        unit: data.unit,
        categoryId: data.categoryId,
        imageUrls: data.imageUrls || [],
        stockQuantity: data.stockQuantity,
        approvalStatus: 'PENDING_APPROVAL', // Start in pending status
        isActive: true
      },
      include: {
        vendor: { select: { businessName: true } },
        category: { select: { name: true } }
      }
    });

    // Create current price entry
    await prisma.priceEntry.create({
      data: {
        productId: product.id,
        vendorId: vendor.id,
        priceNgn: data.priceNgn,
        isCurrent: true,
        recordedBy: userId
      }
    });

    res.json({
      message: 'Product submitted for approval. It will be reviewed by our admin team within 24 hours.',
      product: {
        ...product,
        currentPrice: data.priceNgn
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('uploadProduct failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Vendor resubmits a rejected product for re-approval.
 * Resets approvalStatus → PENDING_APPROVAL and clears rejectionReason.
 */
export const resubmitProduct = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const productId = String(req.params['productId']);

    const vendor = await getVendorForUser(userId);
    if (!vendor) return res.status(404).json({ message: 'No vendor profile linked' });

    const product = await prisma.product.findFirst({ where: { id: productId, vendorId: vendor.id } });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (product.approvalStatus !== 'REJECTED') {
      return res.status(400).json({ message: 'Only rejected products can be resubmitted' });
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: { approvalStatus: 'PENDING_APPROVAL', rejectionReason: null }
    });

    res.json({ message: 'Product resubmitted for approval', product: updated });
  } catch (error) {
    logger.error('resubmitProduct failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const applyToBeVendor = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const schema = z.object({
      businessName: z.string().min(2),
      marketId: z.string().uuid(),
      contactName: z.string().min(2),
      phone: z.string().min(10),
      stallReference: z.string().optional()
    });

    const data = schema.parse(req.body);

    // Check if user already has a vendor profile
    const existing = await prisma.vendor.findFirst({ where: { userId } });
    if (existing) {
      if (existing.verificationStatus === 'VERIFIED') {
        return res.status(400).json({ message: 'You are already a registered and verified vendor.' });
      }
      if (existing.verificationStatus === 'PENDING') {
        return res.status(400).json({ message: 'You already have a pending vendor application.' });
      }
      return res.status(400).json({ message: `Your vendor account status is currently: ${existing.verificationStatus}` });
    }

    // Verify market exists
    const market = await prisma.market.findUnique({ where: { id: data.marketId } });
    if (!market) {
      return res.status(404).json({ message: 'Selected market not found' });
    }

    const vendor = await prisma.vendor.create({
      data: {
        userId,
        marketId: data.marketId,
        businessName: data.businessName,
        contactName: data.contactName,
        phone: data.phone,
        stallReference: data.stallReference || null,
        verificationStatus: 'PENDING',
        createdByAdmin: false
      },
      include: { market: { select: { name: true } } }
    });

    res.status(201).json({
      message: 'Vendor application submitted successfully. An administrator will review your request.',
      vendor
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('applyToBeVendor failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};
