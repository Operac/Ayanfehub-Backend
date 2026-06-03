import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

const dateQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to:   z.string().datetime({ offset: true }).optional(),
});

function parseDateRange(query: Record<string, unknown>) {
  const parsed = dateQuerySchema.parse(query);
  const from = parsed.from ? new Date(parsed.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to   = parsed.to   ? new Date(parsed.to)   : new Date();
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new Error('Invalid date range');
  if (from > to) throw new Error('from must be before to');
  return { from, to };
}

export const getAdminReports = async (req: Request, res: Response) => {
  try {
    let from: Date, to: Date;
    try { ({ from, to } = parseDateRange(req.query)); }
    catch (e: any) { return res.status(400).json({ message: e.message }); }

    const [totalOrders, revenueAgg, topVendors, statusBreakdown, recentOrders] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: from, lte: to } } }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: from, lte: to },
          status: { in: ['PAYMENT_CONFIRMED', 'SOURCING', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'] }
        },
        _sum: { totalNgn: true }
      }),
      prisma.orderItem.groupBy({
        by: ['vendorId'],
        where: { order: { createdAt: { gte: from, lte: to } } },
        _sum: { subtotalNgn: true },
        _count: { id: true },
        orderBy: { _sum: { subtotalNgn: 'desc' } },
        take: 5
      }),
      prisma.order.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _count: true
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, orderNumber: true, status: true, totalNgn: true, createdAt: true,
          user: { select: { fullName: true, phone: true } },
          items: {
            select: {
              id: true, quantity: true, subtotalNgn: true,
              product: { select: { name: true } },
              vendor: { select: { businessName: true } }
            }
          }
        }
      })
    ]);

    // Batch-load vendor names for the groupBy result (avoids N+1)
    const vendorIds = topVendors.map(v => v.vendorId);
    const vendors = await prisma.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: { id: true, businessName: true }
    });
    const vendorMap = Object.fromEntries(vendors.map(v => [v.id, v.businessName]));

    res.json({
      period: { from, to },
      summary: { totalOrders, totalRevenue: revenueAgg._sum.totalNgn ?? 0 },
      statusBreakdown,
      topVendors: topVendors.map(v => ({
        vendorId: v.vendorId,
        businessName: vendorMap[v.vendorId] || 'Unknown',
        revenue: v._sum?.subtotalNgn ?? 0,
        orderCount: v._count.id
      })),
      recentOrders
    });
  } catch (error) {
    logger.error('getAdminReports failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getAdminVendors = async (req: Request, res: Response) => {
  try {
    const vendors = await prisma.vendor.findMany({
      include: {
        market: { select: { name: true } },
        _count: { select: { products: true, orderItems: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(vendors);
  } catch (error) {
    logger.error('getAdminVendors failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateVendorVerification = async (req: Request, res: Response) => {
  try {
    const { vendorId, status } = z.object({
      vendorId: z.string().uuid(),
      status: z.enum(['PENDING', 'VERIFIED', 'SUSPENDED'])
    }).parse(req.body);

    const vendor = await prisma.vendor.update({
      where: { id: vendorId },
      data: { verificationStatus: status as any }
    });
    res.json({ message: 'Vendor status updated', vendor });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('updateVendorVerification failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getDeliveryZones = async (req: Request, res: Response) => {
  try {
    const zones = await prisma.deliveryZone.findMany({ orderBy: { name: 'asc' } });
    res.json(zones);
  } catch (error) {
    logger.error('getDeliveryZones failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const getAllOrders = async (req: Request, res: Response) => {
  try {
    const page   = Math.max(1, parseInt(String(req.query.page  ?? 1)));
    const limit  = Math.min(50, parseInt(String(req.query.limit ?? 20)));
    const status = req.query.status ? String(req.query.status) : undefined;

    const where = status ? { status: status as any } : {};

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, orderNumber: true, status: true, totalNgn: true, createdAt: true,
          user: { select: { id: true, email: true, phone: true, fullName: true } },
          items: {
            select: {
              id: true, quantity: true, subtotalNgn: true, priceNgnAtOrder: true,
              product: { select: { name: true, unit: true } },
              vendor: { select: { businessName: true } }
            }
          }
        }
      }),
      prisma.order.count({ where })
    ]);

    res.json({ orders, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    logger.error('getAllOrders failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const generateVerificationCode = async (req: Request, res: Response) => {
  try {
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(req.body);

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status !== 'OUT_FOR_DELIVERY') {
      return res.status(400).json({ message: 'Order must be OUT_FOR_DELIVERY to generate a code' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Persist the code so verifyDelivery can compare it
    await prisma.order.update({ where: { id: orderId }, data: { verificationCode: code } });

    res.json({ message: 'Code generated', code });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('generateVerificationCode failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const toggleArtisanAvailability = async (req: Request, res: Response) => {
  try {
    const { artisanId, isAvailable } = z.object({
      artisanId: z.string().uuid(),
      isAvailable: z.boolean()
    }).parse(req.body);

    await prisma.artisan.update({ where: { id: artisanId }, data: { isAvailable } });
    res.json({ message: `Artisan availability set to ${isAvailable}` });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('toggleArtisanAvailability failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const exportReportsCSV = async (req: Request, res: Response) => {
  try {
    let from: Date, to: Date;
    try { ({ from, to } = parseDateRange(req.query)); }
    catch (e: any) { return res.status(400).json({ message: e.message }); }
    // Cap export window to 90 days to prevent unbounded memory usage
    const MAX_DAYS = 90 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > MAX_DAYS) {
      return res.status(400).json({ message: 'Export range cannot exceed 90 days' });
    }

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
      take: 5000, // prevent unbounded exports
      select: {
        orderNumber: true, status: true, totalNgn: true, subtotalNgn: true,
        deliveryFeeNgn: true, serviceFeeNgn: true, discountNgn: true, promoCode: true,
        createdAt: true,
        user: { select: { fullName: true, phone: true, email: true } },
        items: { select: { quantity: true, subtotalNgn: true, product: { select: { name: true } } } }
      }
    });

    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const header = ['Order Number', 'Date', 'Customer', 'Phone', 'Email', 'Status',
                    'Subtotal (NGN)', 'Delivery Fee', 'Service Fee', 'Discount', 'Promo Code', 'Total (NGN)', 'Items'].join(',');

    const rows = orders.map(o => {
      const itemSummary = o.items.map(i => `${i.product?.name ?? 'Item'} x${Number(i.quantity)}`).join('; ');
      return [
        escape(o.orderNumber),
        escape(new Date(o.createdAt).toISOString().split('T')[0]),
        escape(o.user?.fullName),
        escape(o.user?.phone),
        escape(o.user?.email),
        escape(o.status),
        escape(Number(o.subtotalNgn)),
        escape(Number(o.deliveryFeeNgn)),
        escape(Number(o.serviceFeeNgn)),
        escape(Number(o.discountNgn)),
        escape(o.promoCode),
        escape(Number(o.totalNgn)),
        escape(itemSummary),
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const filename = `ayanfe-orders-${from.toISOString().split('T')[0]}-to-${to.toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    logger.error('exportReportsCSV failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── APP SETTINGS ────────────────────────────────────────────────────────────

export const getAppSettings = async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.appSetting.findMany();
    const settings: Record<string, string> = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (error) {
    logger.error('getAppSettings failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

/** Keys that admins are allowed to set via the general settings panel */
const ALLOWED_SETTING_KEYS = new Set([
  'contact_phone',
  'contact_email',
  'consolidation_day_of_week',
  'service_fee_rate',
  'whatsapp_support_number',
  'announcement_banner',
  'maintenance_mode',
]);

export const updateAppSettings = async (req: Request, res: Response) => {
  try {
    const schema = z.record(z.string(), z.string());
    const updates = schema.parse(req.body);

    const badKeys = Object.keys(updates).filter(k => !ALLOWED_SETTING_KEYS.has(k));
    if (badKeys.length > 0) {
      return res.status(400).json({ message: `Unknown or protected setting key(s): ${badKeys.join(', ')}` });
    }

    await Promise.all(
      Object.entries(updates).map(([key, value]) =>
        prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
      )
    );
    res.json({ message: 'Settings saved' });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('updateAppSettings failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELIVERY ZONES ──────────────────────────────────────────────────────────

export const getAdminDeliveryZones = async (_req: Request, res: Response) => {
  try {
    const zones = await prisma.deliveryZone.findMany({
      orderBy: { name: 'asc' },
      include: {
        deliveryRates: {
          include: { market: { select: { id: true, name: true } } }
        }
      }
    });
    res.json(zones);
  } catch (error) {
    logger.error('getAdminDeliveryZones failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const createDeliveryZone = async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      cities: z.array(z.string().min(1)),
      deliveryFeeNgn: z.number().nonnegative(),
      consolidatedDeliveryFeeNgn: z.number().nonnegative(),
      isActive: z.boolean().default(true)
    });
    const data = schema.parse(req.body);
    const zone = await prisma.deliveryZone.create({
      data: {
        name: data.name,
        cities: data.cities.map(c => c.toLowerCase().trim()),
        deliveryFeeNgn: data.deliveryFeeNgn,
        consolidatedDeliveryFeeNgn: data.consolidatedDeliveryFeeNgn,
        isActive: data.isActive
      }
    });
    res.status(201).json(zone);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('createDeliveryZone failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateDeliveryZone = async (req: Request, res: Response) => {
  try {
    const zoneId = req.params.zoneId as string;
    const schema = z.object({
      name: z.string().min(2).optional(),
      cities: z.array(z.string().min(1)).optional(),
      deliveryFeeNgn: z.number().nonnegative().optional(),
      consolidatedDeliveryFeeNgn: z.number().nonnegative().optional(),
      isActive: z.boolean().optional()
    });
    const data = schema.parse(req.body);
    const zone = await prisma.deliveryZone.update({
      where: { id: zoneId },
      data: {
        ...data,
        cities: data.cities ? data.cities.map(c => c.toLowerCase().trim()) : undefined
      }
    });
    res.json(zone);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('updateDeliveryZone failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELIVERY RATES ──────────────────────────────────────────────────────────

export const getDeliveryRates = async (_req: Request, res: Response) => {
  try {
    const rates = await prisma.marketDeliveryRate.findMany({
      include: {
        market: { select: { id: true, name: true } },
        deliveryZone: { select: { id: true, name: true } }
      }
    });
    res.json(rates);
  } catch (error) {
    logger.error('getDeliveryRates failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const upsertDeliveryRates = async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      rates: z.array(z.object({
        marketId: z.string().uuid(),
        deliveryZoneId: z.string().uuid(),
        priceNgn: z.number().nonnegative()
      }))
    });
    const { rates } = schema.parse(req.body);

    await Promise.all(rates.map(r =>
      prisma.marketDeliveryRate.upsert({
        where: { marketId_deliveryZoneId: { marketId: r.marketId, deliveryZoneId: r.deliveryZoneId } },
        create: { marketId: r.marketId, deliveryZoneId: r.deliveryZoneId, priceNgn: r.priceNgn },
        update: { priceNgn: r.priceNgn }
      })
    ));

    res.json({ message: 'Rates updated', count: rates.length });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('upsertDeliveryRates failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── CREATE MARKET ────────────────────────────────────────────────────────────

export const createMarket = async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      category: z.string().min(2),
      imageUrl: z.string().url().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      isActive: z.boolean().default(false)
    });
    const data = schema.parse(req.body);
    const slug = data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const market = await prisma.market.create({
      data: {
        name: data.name,
        slug,
        category: data.category,
        imageUrl: data.imageUrl,
        lat: data.lat,
        lng: data.lng,
        isActive: data.isActive
      }
    });
    res.status(201).json(market);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('createMarket failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

export const confirmShortlet = async (req: Request, res: Response) => {
  try {
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(req.body);

    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAYMENT_CONFIRMED' } });
    res.json({ message: 'Shortlet confirmed, payment requested' });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('confirmShortlet failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

// ─── ADMIN CONTENT CREATION ───────────────────────────────────────────────────────

/**
 * Admin creates a new vendor (either links existing user or creates new)
 */
export const createVendor = async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      businessName: z.string().min(2),
      marketId: z.string().uuid(),
      contactName: z.string().min(2),
      phone: z.string().min(10),
      email: z.string().email(),
      password: z.string().min(6).optional(),
      linkExistingUserId: z.string().uuid().optional(),
    });

    const data = schema.parse(req.body);

    // If linking existing user, verify user exists
    let userId: string;
    if (data.linkExistingUserId) {
      const user = await prisma.user.findUnique({ where: { id: data.linkExistingUserId } });
      if (!user) return res.status(404).json({ message: 'User not found' });
      userId = data.linkExistingUserId;
    } else {
      // Create new user with email and password
      if (!data.password) return res.status(400).json({ message: 'Password required when creating new user' });

      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(data.password, 10);

      const newUser = await prisma.user.create({
        data: {
          email: data.email,
          phone: data.phone,
          passwordHash,
          fullName: data.contactName,
          role: 'VENDOR'
        }
      });
      userId = newUser.id;
    }

    // Create vendor (auto-verified since admin created it)
    const vendor = await prisma.vendor.create({
      data: {
        userId,
        marketId: data.marketId,
        businessName: data.businessName,
        contactName: data.contactName,
        phone: data.phone,
        verificationStatus: 'VERIFIED',
        createdByAdmin: true,
        verifiedAt: new Date(),
        verifiedBy: (req as any).user?.id
      },
      include: { market: { select: { name: true } } }
    });

    // Notify vendor via email
    const NotificationService = require('../services/notificationService').default;
    await NotificationService.notifyVendorCreated(
      data.email,
      data.contactName,
      data.businessName,
      data.password  // pass plain password so welcome email can show it
    );

    res.json({
      message: 'Vendor created successfully',
      vendor: {
        ...vendor,
        userId
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('createVendor failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Admin creates a new artisan
 */
export const createArtisan = async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      category: z.string().min(2),
      phone: z.string().min(10),
      email: z.string().email(),
      bio: z.string().optional(),
      password: z.string().min(6).optional(),
      linkExistingUserId: z.string().uuid().optional(),
    });

    const data = schema.parse(req.body);

    let userId: string;
    if (data.linkExistingUserId) {
      const user = await prisma.user.findUnique({ where: { id: data.linkExistingUserId } });
      if (!user) return res.status(404).json({ message: 'User not found' });
      userId = data.linkExistingUserId;
    } else {
      if (!data.password) return res.status(400).json({ message: 'Password required when creating new user' });

      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(data.password, 10);

      const newUser = await prisma.user.create({
        data: {
          email: data.email,
          phone: data.phone,
          passwordHash,
          fullName: data.name,
          role: 'ARTISAN'
        }
      });
      userId = newUser.id;
    }

    const artisan = await prisma.artisan.create({
      data: {
        userId,
        name: data.name,
        category: data.category,
        bio: data.bio,
        phone: data.phone,
        verificationStatus: 'VERIFIED',
        createdByAdmin: true
      }
    });

    const NotificationService = require('../services/notificationService').default;
    await NotificationService.notifyArtisanCreated(
      data.email,
      data.name,
      data.name,
      data.category,
      data.password
    );

    res.json({
      message: 'Artisan created successfully',
      artisan: {
        ...artisan,
        userId
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('createArtisan failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Admin creates a product for a vendor (can bypass approval)
 */
export const createAdminProduct = async (req: Request, res: Response) => {
  try {
    const vendorId = req.params.vendorId as string;
    if (!vendorId) return res.status(400).json({ message: 'vendorId param required' });

    const schema = z.object({
      name: z.string().min(2),
      description: z.string().optional(),
      unit: z.string().min(1),
      categoryId: z.string().uuid().optional(),
      priceNgn: z.number().positive(),
      stockQuantity: z.number().int().positive().optional(),
      approvalStatus: z.enum(['PENDING_APPROVAL', 'APPROVED']).default('APPROVED'),
      imageUrls: z.array(z.string().url()).optional()
    });

    const data = schema.parse(req.body);

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { marketId: true }
    });
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const product = await prisma.product.create({
      data: {
        vendorId: vendorId,
        marketId: vendor.marketId,
        name: data.name,
        description: data.description,
        unit: data.unit,
        categoryId: data.categoryId,
        imageUrls: data.imageUrls || [],
        stockQuantity: data.stockQuantity,
        approvalStatus: data.approvalStatus,
        approvedAt: data.approvalStatus === 'APPROVED' ? new Date() : undefined,
        approvedBy: data.approvalStatus === 'APPROVED' ? (req as any).user?.id : undefined
      },
      include: {
        vendor: { select: { businessName: true } },
        category: { select: { name: true } }
      }
    });

    // Create price entry
    await prisma.priceEntry.create({
      data: {
        productId: product.id,
        vendorId: vendorId,
        priceNgn: data.priceNgn,
        isCurrent: true,
        recordedBy: (req as any).user?.id
      }
    });

    res.json({
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('createAdminProduct failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Admin creates an artisan service
 */
export const createArtisanService = async (req: Request, res: Response) => {
  try {
    const artisanId = req.params.artisanId as string;
    if (!artisanId) return res.status(400).json({ message: 'artisanId param required' });

    const schema = z.object({
      serviceName: z.string().min(2),
      priceNgn: z.number().positive(),
      description: z.string().optional(),
      turnaroundDays: z.number().int().positive().optional()
    });

    const data = schema.parse(req.body);

    const artisan = await prisma.artisan.findUnique({ where: { id: artisanId } });
    if (!artisan) return res.status(404).json({ message: 'Artisan not found' });

    const service = await prisma.artisanService.create({
      data: {
        artisanId: artisanId,
        serviceName: data.serviceName,
        priceNgn: data.priceNgn,
        description: data.description,
        turnaroundDays: data.turnaroundDays
      }
    });

    res.json({
      message: 'Service created successfully',
      service
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('createArtisanService failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Admin creates a shortlet
 */
export const createShortlet = async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      location: z.string().min(2),
      ratePerNight: z.number().positive(),
      amenities: z.array(z.string()).optional(),
      images: z.array(z.string().url()).optional(),
      email: z.string().email(),
      password: z.string().min(6).optional(),
      linkExistingUserId: z.string().uuid().optional(),
    });

    const data = schema.parse(req.body);

    let userId: string | undefined;
    if (data.linkExistingUserId) {
      const user = await prisma.user.findUnique({ where: { id: data.linkExistingUserId } });
      if (!user) return res.status(404).json({ message: 'User not found' });
      userId = data.linkExistingUserId;
    } else if (data.email && data.password) {
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(data.password, 10);

      const newUser = await prisma.user.create({
        data: {
          email: data.email,
          phone: data.email, // Use email as fallback for phone
          passwordHash,
          fullName: data.name || 'Shortlet Manager',
          role: 'CUSTOMER'
        }
      });
      userId = newUser.id;
    }

    const apartment = await prisma.apartment.create({
      data: {
        userId,
        name: data.name,
        location: data.location,
        ratePerNight: data.ratePerNight,
        amenities: data.amenities || [],
        images: data.images || [],
        createdByAdmin: true
      }
    });

    const NotificationService = require('../services/notificationService').default;
    if (userId && data.email) {
      await NotificationService.notifyShortletCreated(
        data.email,
        data.name || 'Shortlet Manager',
        data.name,
        data.password
      );
    }

    res.json({
      message: 'Shortlet created successfully',
      apartment: {
        ...apartment,
        userId
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('createShortlet failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Admin approves or rejects a product
 */
export const approveOrRejectProduct = async (req: Request, res: Response) => {
  try {
    const { productId } = z.object({ productId: z.string().uuid() }).parse(req.params);
    const schema = z.object({
      approvalStatus: z.enum(['APPROVED', 'REJECTED']),
      rejectionReason: z.string().optional()
    });

    const data = schema.parse(req.body);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { vendor: { select: { id: true, userId: true, businessName: true } } }
    });

    if (!product) return res.status(404).json({ message: 'Product not found' });

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        approvalStatus: data.approvalStatus as any,
        approvedAt: new Date(),
        approvedBy: (req as any).user?.id,
        rejectionReason: data.approvalStatus === 'REJECTED' ? data.rejectionReason : null
      },
      include: {
        vendor: { select: { id: true, businessName: true } },
        category: { select: { name: true } }
      }
    });

    // Notify vendor via email — look up user from vendor.userId
    const NotificationService = require('../services/notificationService').default;
    let vendorEmail: string | null = null;
    if (product.vendor?.userId) {
      const vendorUser = await prisma.user.findUnique({
        where: { id: product.vendor.userId },
        select: { email: true }
      });
      vendorEmail = vendorUser?.email ?? null;
    }
    if (data.approvalStatus === 'APPROVED') {
      await NotificationService.notifyProductApproved(vendorEmail, product.name);
    } else {
      await NotificationService.notifyProductRejected(vendorEmail, product.name, data.rejectionReason || 'No reason provided');
    }

    res.json({
      message: `Product ${data.approvalStatus.toLowerCase()}`,
      product: updated
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('approveOrRejectProduct failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Admin gets list of pending products for approval
 */
export const getPendingProducts = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? 1)));
    const limit = Math.min(50, parseInt(String(req.query.limit ?? 20)));
    const marketId = req.query.marketId ? String(req.query.marketId) : undefined;
    const vendorId = req.query.vendorId ? String(req.query.vendorId) : undefined;

    const where: any = { approvalStatus: 'PENDING_APPROVAL' };
    if (marketId) where.marketId = marketId;
    if (vendorId) where.vendorId = vendorId;

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          vendor: { select: { id: true, businessName: true } },
          category: { select: { name: true } },
          priceEntries: { where: { isCurrent: true }, select: { priceNgn: true }, take: 1 }
        }
      }),
      prisma.product.count({ where })
    ]);

    const formattedProducts = products.map(p => ({
      ...p,
      currentPrice: p.priceEntries[0]?.priceNgn
    }));

    res.json({
      products: formattedProducts,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    logger.error('getPendingProducts failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Admin: list all markets with their run days
 */
export const getAdminMarkets = async (_req: Request, res: Response) => {
  try {
    const markets = await prisma.market.findMany({
      orderBy: { name: 'asc' },
      include: { runDays: { orderBy: { dayOfWeek: 'asc' } } }
    });
    res.json(markets);
  } catch (error) {
    logger.error('getAdminMarkets failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Admin: replace all run days for a market (handles cutoff time + delivery days)
 */
export const updateMarketRunDays = async (req: Request, res: Response) => {
  try {
    const marketId = req.params.marketId as string;

    const runDaySchema = z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      cutoffHour: z.number().int().min(0).max(23),
      cutoffMinute: z.number().int().min(0).max(59).default(0),
      isMasterConsolidation: z.boolean().default(false)
    });

    const schema = z.object({
      runDays: z.array(runDaySchema)
    });

    const { runDays } = schema.parse(req.body);

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market) return res.status(404).json({ message: 'Market not found' });

    // Replace run days atomically
    await prisma.$transaction([
      prisma.runDay.deleteMany({ where: { marketId } }),
      prisma.runDay.createMany({
        data: runDays.map(d => ({
          marketId,
          dayOfWeek: d.dayOfWeek,
          cutoffHour: d.cutoffHour,
          cutoffMinute: d.cutoffMinute,
          isMasterConsolidation: d.isMasterConsolidation
        }))
      })
    ]);

    const updated = await prisma.market.findUnique({
      where: { id: marketId },
      include: { runDays: { orderBy: { dayOfWeek: 'asc' } } }
    });

    res.json({ message: 'Run days updated', market: updated });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: error.issues });
    logger.error('updateMarketRunDays failed', { error });
    res.status(500).json({ message: 'Server error' });
  }
};
