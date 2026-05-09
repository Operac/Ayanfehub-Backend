import { Router } from 'express';
import { getAllOrders, generateVerificationCode, toggleArtisanAvailability, confirmShortlet, getDeliveryZones, getAdminReports, getAdminVendors, updateVendorVerification } from '../controllers/adminController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// Public: delivery zones needed on cart page
router.get('/delivery-zones', getDeliveryZones);

router.use(authenticate, requireAdmin); // All admin routes protected

router.get('/orders', getAllOrders);
router.post('/orders/generate-code', generateVerificationCode);
router.post('/artisans/toggle', toggleArtisanAvailability);
router.post('/shortlets/confirm', confirmShortlet);
router.get('/reports', getAdminReports);
router.get('/vendors', getAdminVendors);
router.patch('/vendors/verification', updateVendorVerification);

export default router;
