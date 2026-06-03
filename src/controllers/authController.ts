import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/db';
import { hashPassword, comparePassword } from '../utils/auth';
import { generateToken } from '../utils/jwt';

const registerSchema = z.object({
  phone: z.string().min(7),
  email: z.string().email().optional(),
  password: z.string().min(6),
  fullName: z.string().optional(),
});

const loginSchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6),
}).refine(data => data.phone || data.email, {
  message: 'Either phone or email is required'
});

export const register = async (req: Request, res: Response) => {
  try {
    const { phone, email, password, fullName } = registerSchema.parse(req.body);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ phone }, ...(email ? [{ email }] : [])] }
    });
    if (existing) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await hashPassword(password);

    const newUser = await prisma.user.create({
      data: {
        phone,
        email,
        passwordHash: hashedPassword,
        fullName,
        role: 'CUSTOMER'
      },
      select: { id: true, email: true, phone: true, role: true }
    });

    const token = generateToken({ id: newUser.id, role: newUser.role });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.status(201).json({ user: newUser });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { phone, email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: phone ? { phone } : { email: email! }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = generateToken({ id: user.id, role: user.role });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({ user: { id: user.id, email: user.email, phone: user.phone, role: user.role } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const logout = (_req: Request, res: Response) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
  res.json({ message: 'Logged out' });
};

export const getSession = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, role: true, fullName: true, avatarUrl: true }
    });
    if (!user) return res.status(401).json({ message: 'User not found' });
    res.json({ user });
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
};

const updateProfileSchema = z.object({
  fullName: z.string().optional(),
  preferredCurrency: z.enum(['NGN', 'GBP', 'USD', 'EUR']).optional(),
  whatsappOptedIn: z.boolean().optional()
});

const updateAddressSchema = z.object({
  label: z.string().optional(),
  landmarkDescription: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  deliveryZoneId: z.string().uuid().optional(),
  isDefault: z.boolean().optional()
});

const createAddressSchema = z.object({
  label: z.string(),
  landmarkDescription: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  deliveryZoneId: z.string().uuid(),
  isDefault: z.boolean().optional()
});

export const getProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        preferredCurrency: true,
        whatsappOptedIn: true,
        createdAt: true,
        addresses: { select: { id: true, label: true, landmarkDescription: true, lat: true, lng: true, isDefault: true } }
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { fullName, preferredCurrency, whatsappOptedIn } = updateProfileSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(fullName !== undefined && { fullName }),    // allow clearing to ""
        ...(preferredCurrency !== undefined && { preferredCurrency }),
        ...(whatsappOptedIn !== undefined && { whatsappOptedIn })
      },
      select: { id: true, email: true, phone: true, fullName: true, role: true, preferredCurrency: true }
    });

    res.json({ message: 'Profile updated', user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const uploadAvatar = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    // Cloudinary storage puts the secure URL at file.path
    const file = (req as any).file as { path: string } | undefined;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    const avatarUrl = file.path;
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: { id: true, avatarUrl: true }
    });

    res.json({ avatarUrl, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const createAddress = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const data = createAddressSchema.parse(req.body);

    if (data.isDefault) {
      await prisma.deliveryAddress.updateMany({ where: { userId }, data: { isDefault: false } });
    }

    const address = await prisma.deliveryAddress.create({
      data: {
        userId,
        label: data.label,
        landmarkDescription: data.landmarkDescription,
        lat: data.lat,
        lng: data.lng,
        deliveryZoneId: data.deliveryZoneId,
        isDefault: data.isDefault || false
      }
    });

    res.status(201).json(address);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getAddresses = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const addresses = await prisma.deliveryAddress.findMany({
      where: { userId },
      include: { deliveryZone: { select: { id: true, name: true } } }
    });

    res.json(addresses);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = z.object({ addressId: z.string().uuid() }).parse(req.params);
    const userId = (req as any).user.id;
    const data = updateAddressSchema.parse(req.body);

    const address = await prisma.deliveryAddress.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (data.isDefault) {
      await prisma.deliveryAddress.updateMany({
        where: { userId, id: { not: addressId } },
        data: { isDefault: false }
      });
    }

    const updated = await prisma.deliveryAddress.update({
      where: { id: addressId },
      data
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const deleteAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = z.object({ addressId: z.string().uuid() }).parse(req.params);
    const userId = (req as any).user.id;

    const address = await prisma.deliveryAddress.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    await prisma.deliveryAddress.delete({ where: { id: addressId } });
    res.json({ message: 'Address deleted' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};
