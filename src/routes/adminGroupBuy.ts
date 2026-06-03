import { Router, Request, Response, NextFunction } from 'express';
import {
  createGroupBuyEvent, editGroupBuyEvent,
  cancelGroupBuyEvent, fulfillGroupBuyEvent,
  adminListGroupBuyEvents, adminGetParticipants,
  adminReleaseSlot,
} from '../controllers/groupBuyAdminController';
import { authenticate } from '../middleware/auth';

const router = Router();

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const role = (req as any).user?.role;
  if (role !== 'ADMIN') return res.status(403).json({ message: 'Admin access required' });
  next();
};

router.use(authenticate, requireAdmin);

router.get('/', adminListGroupBuyEvents);
router.post('/', createGroupBuyEvent);
router.patch('/:id', editGroupBuyEvent);
router.patch('/:id/cancel', cancelGroupBuyEvent);
router.patch('/:id/fulfill', fulfillGroupBuyEvent);
router.get('/:id/participants', adminGetParticipants);
router.patch('/:id/slots/:slotId/release', adminReleaseSlot);

export default router;
