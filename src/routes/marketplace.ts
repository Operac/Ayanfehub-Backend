import { Router } from 'express';
import { getMarkets, getMarketItems, searchMarkets, getCategories } from '../controllers/marketController';

const router = Router();

router.get('/categories', getCategories);
router.get('/search', searchMarkets);
router.get('/', getMarkets);
router.get('/:id/items', getMarketItems);

export default router;
