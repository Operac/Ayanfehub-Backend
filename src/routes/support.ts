import { Router, Request, Response, NextFunction } from 'express';
import { createSupportMessage, getSupportMessages, resolveSupportMessage } from '../controllers/supportController';
import { authenticate, requireAdmin } from '../middleware/auth';
import { verifyToken } from '../utils/jwt';

const router = Router();

// Middleware to optionally decode token if present, without blocking unauthenticated requests
const optionalAuthenticate = (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = verifyToken(token);
      (req as any).user = decoded;
    } catch (e) {
      // Silently fall back to unauthenticated if token is invalid
    }
  }
  next();
};

// Submit a support message (public)
router.post('/submit', optionalAuthenticate, createSupportMessage);

// Admin management (admin only)
router.use(authenticate);
router.use(requireAdmin);
router.get('/admin', getSupportMessages);
router.patch('/admin/:id/resolve', resolveSupportMessage);

export default router;
