import { Router } from 'express';
import { validatePrices, calculateDelivery, initiatePayment, handleFlutterwaveWebhook } from '../controllers/checkoutController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/validate-prices', validatePrices);
router.post('/delivery', calculateDelivery);
router.post('/initiate-payment', authenticate, initiatePayment);
router.post('/webhook/flutterwave', handleFlutterwaveWebhook);

export default router;
