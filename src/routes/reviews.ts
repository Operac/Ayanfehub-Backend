import { Router } from 'express';
import { createReview, getReviewsByVendor, getReviewsByArtisan } from '../controllers/reviewController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/', authenticate, createReview);
router.get('/vendor', getReviewsByVendor);
router.get('/artisan', getReviewsByArtisan);

export default router;
