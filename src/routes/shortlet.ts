import { Router } from 'express';
import { getShortlets, getShortletById, requestBooking, searchShortlets } from '../controllers/shortletController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/search', searchShortlets);
router.get('/', getShortlets);
router.get('/:id', getShortletById);
router.post('/request', authenticate, requestBooking);

export default router;
