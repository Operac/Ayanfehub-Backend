import { Router } from 'express';
import {
  getArtisans, getArtisanById, bookArtisan, requestCustomService,
  searchArtisans, getArtisanProfile, updateArtisanProfile,
  getArtisanBookings, uploadPortfolioImage, deletePortfolioImage
} from '../controllers/artisanController';
import { authenticate } from '../middleware/auth';
import { portfolioUpload } from '../middleware/upload';

const router = Router();

// Static routes must come before /:id
router.get('/search', searchArtisans);
router.get('/me', authenticate, getArtisanProfile);
router.get('/me/bookings', authenticate, getArtisanBookings);
router.put('/me', authenticate, updateArtisanProfile);
router.post('/me/portfolio', authenticate, portfolioUpload.single('image'), uploadPortfolioImage);
router.delete('/me/portfolio', authenticate, deletePortfolioImage);

router.get('/', getArtisans);
router.get('/:id', getArtisanById);
router.post('/book', authenticate, bookArtisan);
router.post('/request', authenticate, requestCustomService);

export default router;
