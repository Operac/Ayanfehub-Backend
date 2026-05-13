import { Router } from 'express';
import {
  getAllOrders, generateVerificationCode, toggleArtisanAvailability,
  confirmShortlet, getDeliveryZones, getAdminReports, getAdminVendors,
  updateVendorVerification, exportReportsCSV
} from '../controllers/adminController';
import {
  createPromoCode, listPromoCodes, togglePromoCode
} from '../controllers/promotionController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// Public: delivery zones needed on cart page
router.get('/delivery-zones', getDeliveryZones);

router.use(authenticate, requireAdmin);

router.get('/orders', getAllOrders);
router.post('/orders/generate-code', generateVerificationCode);
router.post('/artisans/toggle', toggleArtisanAvailability);
router.post('/shortlets/confirm', confirmShortlet);

router.get('/reports', getAdminReports);
router.get('/reports/export', exportReportsCSV);

router.get('/vendors', getAdminVendors);
router.patch('/vendors/verification', updateVendorVerification);

router.get('/promos', listPromoCodes);
router.post('/promos', createPromoCode);
router.patch('/promos/:id/toggle', togglePromoCode);

export default router;
