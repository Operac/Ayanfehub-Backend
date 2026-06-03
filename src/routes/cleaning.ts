import { Router } from 'express';
import {
  submitCleaningRequest,
  getMyCleaningRequests,
  getCleaningRequestById,
  initiateDepositPayment,
  cancelCleaningRequest,
  getPublicHomePricing,
} from '../controllers/cleaningController';
import { authenticate } from '../middleware/auth';
import { cleaningPhotoUpload } from '../middleware/upload';

const router = Router();

// Public pricing endpoint (no auth required)
router.get('/pricing', getPublicHomePricing);

router.use(authenticate);

router.post('/', cleaningPhotoUpload.array('photos', 5), submitCleaningRequest);
router.get('/my', getMyCleaningRequests);
router.get('/:id', getCleaningRequestById);
router.post('/:id/pay-deposit', initiateDepositPayment);
router.delete('/:id', cancelCleaningRequest);

export default router;
