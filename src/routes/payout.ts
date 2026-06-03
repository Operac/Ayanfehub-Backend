import { Router } from 'express';
import {
  getBanks, verifyBankAccount, initiatePayout, getPayouts, syncPayoutStatus
} from '../controllers/payoutController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// General authenticated routes
router.get('/banks', getBanks);
router.post('/verify-bank', verifyBankAccount);
router.get('/', getPayouts);

// Admin-only routes
router.post('/initiate', requireAdmin, initiatePayout);
router.post('/:id/sync', requireAdmin, syncPayoutStatus);

export default router;
