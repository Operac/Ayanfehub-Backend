import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

export const getAdminReports = async (req: Request, res: Response) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to   = req.query.to   ? new Date(String(req.query.to))   : new Date();

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

    const code = Math.floor(100000 + Math.random() * 900000).toString();
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
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to   = req.query.to   ? new Date(String(req.query.to))   : new Date();

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
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
