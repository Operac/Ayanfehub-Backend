import { Router } from 'express';
import {
  getAllOrders, generateVerificationCode, toggleArtisanAvailability,
  confirmShortlet, getDeliveryZones, getAdminReports, getAdminVendors,
  updateVendorVerification, exportReportsCSV,
  createVendor, createArtisan, createAdminProduct, createArtisanService,
  createShortlet, approveOrRejectProduct, getPendingProducts
} from '../controllers/adminController';
import {
  createPromoCode, listPromoCodes, togglePromoCode
} from '../controllers/promotionController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// Public: delivery zones needed on cart page
router.get('/delivery-zones', getDeliveryZones);

router.use(authenticate, requireAdmin);

// Orders
router.get('/orders', getAllOrders);
router.post('/orders/generate-code', generateVerificationCode);

// Artisans
router.post('/artisans/toggle', toggleArtisanAvailability);
router.post('/artisans', createArtisan);

// Shortlets
router.post('/shortlets/confirm', confirmShortlet);
router.post('/shortlets', createShortlet);

// Reports
router.get('/reports', getAdminReports);
router.get('/reports/export', exportReportsCSV);

// Vendors
router.get('/vendors', getAdminVendors);
router.patch('/vendors/verification', updateVendorVerification);
router.post('/vendors', createVendor);
router.post('/vendors/:vendorId/products', createAdminProduct);

// Artisan Services
router.post('/artisans/:artisanId/services', createArtisanService);

// Product Approval
router.get('/products/pending', getPendingProducts);
router.patch('/products/:productId/approval', approveOrRejectProduct);

// Promotions
router.get('/promos', listPromoCodes);
router.post('/promos', createPromoCode);
router.patch('/promos/:id/toggle', togglePromoCode);

export default router;
