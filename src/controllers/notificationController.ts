import { Request, Response } from 'express';
import prisma from '../config/db';
import logger from '../utils/logger';

/** GET /api/notifications — last 50 notifications for the logged-in user */
export async function listNotifications(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).user?.id as string;
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(notifications);
  } catch (err) {
    logger.error('listNotifications error', { err });
    res.status(500).json({ message: 'Internal server error' });
  }
}

/** PATCH /api/notifications/read-all — mark all notifications as read */
export async function markAllRead(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).user?.id as string;
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    logger.error('markAllRead error', { err });
    res.status(500).json({ message: 'Internal server error' });
  }
}
