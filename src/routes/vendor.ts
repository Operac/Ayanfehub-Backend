import { Router, Request, Response, NextFunction } from 'express';
import {
  getMyVendorProfile, getMyProducts, updateMyProduct,
  getMyVendorOrders, getVendorStats, uploadProductImage, uploadProduct, updateProductPrice,
  resubmitProduct
} from '../controllers/vendorController';
import { authenticate } from '../middleware/auth';
import { productImageUpload } from '../middleware/upload';

const router = Router();

const requireVendor = (req: Request, res: Response, next: NextFunction) => {
  const role = (req as any).user?.role;
  if (role !== 'VENDOR' && role !== 'ADMIN') {
    return res.status(403).json({ message: 'Vendor access required' });
  }
  next();
};

router.use(authenticate);
router.use(requireVendor);

router.get('/me', getMyVendorProfile);
router.get('/me/stats', getVendorStats);
router.get('/me/products', getMyProducts);
router.patch('/me/products/:productId', updateMyProduct);
router.patch('/me/products/:productId/price', updateProductPrice);
router.post('/me/products', uploadProduct);
router.post('/me/products/:productId/image', productImageUpload.single('image'), uploadProductImage);
router.get('/me/orders', getMyVendorOrders);
router.post('/me/products/:productId/resubmit', resubmitProduct);

export default router;
