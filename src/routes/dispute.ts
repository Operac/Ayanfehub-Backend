import { Router } from 'express';
import {
  createDispute, getDisputes, updateDisputeStatus
} from '../controllers/disputeController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Customers & Admins
router.post('/', createDispute);
router.get('/', getDisputes);

// Admin-only updates
router.patch('/:id', requireAdmin, updateDisputeStatus);

export default router;
