import { Request, Response } from 'express';
import prisma from '../config/db';
import { z } from 'zod';
import logger from '../utils/logger';

const verifyAccountSchema = z.object({
  accountNumber: z.string().min(10).max(10),
  bankCode: z.string().min(3)
});

const initiatePayoutSchema = z.object({
  vendorId: z.string().uuid().optional(),
  artisanId: z.string().uuid().optional(),
  amount: z.number().positive()
});

// GET /api/payouts/banks
export const getBanks = async (req: Request, res: Response) => {
  try {
    const flwKey = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!flwKey) {
      return res.status(500).json({ message: 'Flutterwave key is not configured' });
    }

    const response = await fetch('https://api.flutterwave.com/v3/banks/NG', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${flwKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    if (data.status !== 'success') {
      return res.status(400).json({ message: data.message || 'Failed to fetch banks' });
    }

    return res.json(data.data);
  } catch (error: any) {
    logger.error('Error fetching banks from Flutterwave', { error: error.message });
    return res.status(500).json({ message: 'Server error fetching banks' });
  }
};

// POST /api/payouts/verify-bank
export const verifyBankAccount = async (req: Request, res: Response) => {
  try {
    const { accountNumber, bankCode } = verifyAccountSchema.parse(req.body);
    const flwKey = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!flwKey) {
      return res.status(500).json({ message: 'Flutterwave key is not configured' });
    }

    const response = await fetch('https://api.flutterwave.com/v3/accounts/resolve', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${flwKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        account_number: accountNumber,
        account_bank: bankCode
      })
    });

    const data = await response.json();
    if (data.status !== 'success') {
      return res.status(400).json({ message: data.message || 'Failed to verify account' });
    }

    return res.json({ accountName: data.data.account_name });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    logger.error('Error verifying bank account', { error: error.message });
    return res.status(500).json({ message: 'Server error verifying bank account' });
  }
};

// POST /api/payouts/initiate (Admin only)
export const initiatePayout = async (req: Request, res: Response) => {
  try {
    const { vendorId, artisanId, amount } = initiatePayoutSchema.parse(req.body);

    if (!vendorId && !artisanId) {
      return res.status(400).json({ message: 'Specify either vendorId or artisanId' });
    }
    if (vendorId && artisanId) {
      return res.status(400).json({ message: 'Specify only one: vendorId or artisanId' });
    }

    let bankAccountNumber: string | null = null;
    let bankCode: string | null = null;
    let businessName = '';

    if (vendorId) {
      const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
      if (vendor.verificationStatus !== 'VERIFIED') {
        return res.status(400).json({ message: 'Vendor must be verified' });
      }
      bankAccountNumber = vendor.bankAccountNumber;
      bankCode = vendor.bankCode;
      businessName = vendor.businessName;
    } else if (artisanId) {
      const artisan = await prisma.artisan.findUnique({ where: { id: artisanId } });
      if (!artisan) return res.status(404).json({ message: 'Artisan not found' });
      if (artisan.verificationStatus !== 'VERIFIED') {
        return res.status(400).json({ message: 'Artisan must be verified' });
      }
      bankAccountNumber = artisan.bankAccountNumber;
      bankCode = artisan.bankCode;
      businessName = artisan.name;
    }

    if (!bankAccountNumber || !bankCode) {
      return res.status(400).json({ message: 'Recipient bank details are not configured' });
    }

    const reference = `PO-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // Create pending payout record
    const payout = await prisma.payout.create({
      data: {
        vendorId,
        artisanId,
        amount,
        bankAccountNumber,
        bankCode,
        reference,
        status: 'PENDING'
      }
    });

    const flwKey = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!flwKey) {
      return res.status(500).json({ message: 'Flutterwave key is not configured' });
    }

    // Call Flutterwave Transfer API
    const response = await fetch('https://api.flutterwave.com/v3/transfers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${flwKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        account_bank: bankCode,
        account_number: bankAccountNumber,
        amount: amount,
        narrative: `Ayanfe Hub Payout to ${businessName}`,
        currency: 'NGN',
        reference,
        debit_currency: 'NGN'
      })
    });

    const data = await response.json();

    if (response.ok && data.status === 'success') {
      // Payout initiated successfully, wait for webhook or sync
      const updated = await prisma.payout.update({
        where: { id: payout.id },
        data: {
          transferId: String(data.data.id),
          bankName: data.data.bank_name || null,
          status: 'PENDING' // Keep pending until status confirmed
        }
      });
      return res.json({ message: 'Payout initiated successfully', payout: updated });
    } else {
      // Payout failed immediately
      const updated = await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'FAILED',
          failureReason: data.message || 'API error'
        }
      });
      return res.status(400).json({ message: data.message || 'Payout failed immediately', payout: updated });
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    logger.error('Error initiating payout', { error: error.message });
    return res.status(500).json({ message: 'Server error initiating payout' });
  }
};

// GET /api/payouts
export const getPayouts = async (req: Request, res: Response) => {
  try {
    const userRole = (req as any).user?.role;
    const userId = (req as any).user?.id;

    if (userRole === 'ADMIN') {
      const payouts = await prisma.payout.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          vendor: true,
          artisan: true
        }
      });
      return res.json(payouts);
    }

    // Filter by currently logged-in vendor or artisan user
    let vendorId: string | undefined;
    let artisanId: string | undefined;

    const vendor = await prisma.vendor.findFirst({ where: { userId } });
    if (vendor) vendorId = vendor.id;

    const artisan = await prisma.artisan.findFirst({ where: { userId } });
    if (artisan) artisanId = artisan.id;

    if (!vendorId && !artisanId) {
      return res.json([]);
    }

    const payouts = await prisma.payout.findMany({
      where: {
        OR: [
          vendorId ? { vendorId } : undefined,
          artisanId ? { artisanId } : undefined
        ].filter(Boolean) as any
      },
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: true,
        artisan: true
      }
    });

    return res.json(payouts);
  } catch (error: any) {
    logger.error('Error fetching payouts', { error: error.message });
    return res.status(500).json({ message: 'Server error fetching payouts' });
  }
};

// POST /api/payouts/:id/sync
export const syncPayoutStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const payout = await prisma.payout.findUnique({ where: { id } });
    if (!payout) return res.status(404).json({ message: 'Payout not found' });

    if (!payout.transferId) {
      return res.status(400).json({ message: 'Payout was not successfully sent to Flutterwave' });
    }

    const flwKey = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!flwKey) {
      return res.status(500).json({ message: 'Flutterwave key is not configured' });
    }

    const response = await fetch(`https://api.flutterwave.com/v3/transfers/${payout.transferId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${flwKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok || data.status !== 'success') {
      return res.status(400).json({ message: data.message || 'Failed to fetch status from Flutterwave' });
    }

    const flwStatus = data.data.status; // SUCCESSFUL, FAILED, NEW, PENDING
    let newStatus = payout.status;
    let failureReason = payout.failureReason;

    if (flwStatus === 'SUCCESSFUL') {
      newStatus = 'SUCCESSFUL';
    } else if (flwStatus === 'FAILED') {
      newStatus = 'FAILED';
      failureReason = data.data.complete_message || 'Transfer failed';
    }

    const updated = await prisma.payout.update({
      where: { id },
      data: { status: newStatus, failureReason },
      include: { vendor: true, artisan: true }
    });

    return res.json({ message: `Payout status updated to ${newStatus}`, payout: updated });
  } catch (error: any) {
    logger.error('Error syncing payout status', { error: error.message });
    return res.status(500).json({ message: 'Server error syncing payout status' });
  }
};
