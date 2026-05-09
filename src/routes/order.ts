import { Router } from 'express';
import { getMyOrders, getOrderById, verifyDelivery, updateOrderStatus } from '../controllers/orderController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate); // All order routes require auth

router.get('/', getMyOrders);
router.get('/:id', getOrderById);
router.post('/verify-delivery', verifyDelivery);
router.patch('/status', requireAdmin, updateOrderStatus);

export default router;
