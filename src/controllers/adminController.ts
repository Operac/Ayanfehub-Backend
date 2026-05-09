import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';

export const getAdminReports = async (req: Request, res: Response) => {
    try {
        const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const to   = req.query.to   ? new Date(String(req.query.to))   : new Date();

        const [totalOrders, revenueAgg, topVendors, statusBreakdown, recentOrders] = await Promise.all([
            prisma.order.count({ where: { createdAt: { gte: from, lte: to } } }),
            prisma.order.aggregate({
                where: { createdAt: { gte: from, lte: to }, status: { in: ['PAYMENT_CONFIRMED', 'SOURCING', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'] } },
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
                include: {
                    user: { select: { fullName: true, phone: true } },
                    items: { include: { product: { select: { name: true } }, vendor: { select: { businessName: true } } } }
                }
            })
        ]);

        const vendorIds = topVendors.map(v => v.vendorId);
        const vendors = await prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, businessName: true } });
        const vendorMap = Object.fromEntries(vendors.map(v => [v.id, v.businessName]));

        res.json({
            period: { from, to },
            summary: {
                totalOrders,
                totalRevenue: revenueAgg._sum.totalNgn ?? 0
            },
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
        console.error(error);
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
        console.error(error);
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
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getDeliveryZones = async (req: Request, res: Response) => {
    try {
        const zones = await prisma.deliveryZone.findMany({ orderBy: { name: 'asc' } });
        res.json(zones);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

const generateCodeSchema = z.object({
    orderId: z.string().uuid()
});

const availabilitySchema = z.object({
    artisanId: z.string().uuid(),
    isAvailable: z.boolean()
});

export const getAllOrders = async (req: Request, res: Response) => {
    try {
        const orders = await prisma.order.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                items: true,
                user: { select: { id: true, email: true, phone: true, fullName: true } }
            }
        });
        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

export const generateVerificationCode = async (req: Request, res: Response) => {
    try {
        const { orderId } = generateCodeSchema.parse(req.body);

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        res.json({ message: 'Code generated', code });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

export const toggleArtisanAvailability = async (req: Request, res: Response) => {
    try {
        const { artisanId, isAvailable } = availabilitySchema.parse(req.body);

        await prisma.artisan.update({
            where: { id: artisanId },
            data: { isAvailable }
        });

        res.json({ message: `Artisan availability set to ${isAvailable}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

export const confirmShortlet = async (req: Request, res: Response) => {
    try {
        const { orderId } = req.body;

        await prisma.order.update({
            where: { id: orderId },
            data: { status: 'PAYMENT_CONFIRMED' }
        });

        res.json({ message: 'Shortlet confirmed, payment requested' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
