import { Router } from 'express';
import {
  getMyVendorProfile, getMyProducts, updateMyProduct,
  getMyVendorOrders, getVendorStats, uploadProductImage, uploadProduct, updateProductPrice
} from '../controllers/vendorController';
import { authenticate } from '../middleware/auth';
import { productImageUpload } from '../middleware/upload';

const router = Router();

router.use(authenticate);

router.get('/me', getMyVendorProfile);
router.get('/me/stats', getVendorStats);
router.get('/me/products', getMyProducts);
router.patch('/me/products/:productId', updateMyProduct);
router.patch('/me/products/:productId/price', updateProductPrice);
router.post('/me/products', uploadProduct);
router.post('/me/products/:productId/image', productImageUpload.single('image'), uploadProductImage);
router.get('/me/orders', getMyVendorOrders);

export default router;
