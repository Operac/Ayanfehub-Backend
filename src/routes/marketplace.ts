import { Router } from 'express';
import { getMarkets, getMarketItems, searchMarkets } from '../controllers/marketController';

const router = Router();

router.get('/search', searchMarkets);
router.get('/', getMarkets);
router.get('/:id/items', getMarketItems);

export default router;
