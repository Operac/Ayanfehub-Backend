import { Router } from 'express';
import {
  getAllOrders, generateVerificationCode, toggleArtisanAvailability,
  confirmShortlet, getDeliveryZones, getAdminReports, getAdminVendors,
  updateVendorVerification, exportReportsCSV,
  createVendor, createArtisan, createAdminProduct, createArtisanService,
  createShortlet, approveOrRejectProduct, getPendingProducts,
  getAdminMarkets, updateMarketRunDays,
  getAppSettings, updateAppSettings,
  getAdminDeliveryZones, createDeliveryZone, updateDeliveryZone,
  getDeliveryRates, upsertDeliveryRates,
  createMarket
} from '../controllers/adminController';
import {
  createPromoCode, listPromoCodes, togglePromoCode
} from '../controllers/promotionController';
import {
  adminListCleaningRequests, adminSendQuote, adminScheduleInspection,
  adminCompleteInspection, adminAssignCleaner, adminUpdateCleaningStatus,
  getHomePricing, updateHomePricing,
} from '../controllers/cleaningController';
import { cleaningPhotoUpload } from '../middleware/upload';
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

// App Settings
router.get('/settings', getAppSettings);
router.patch('/settings', updateAppSettings);

// Markets
router.get('/markets', getAdminMarkets);
router.post('/markets', createMarket);
router.put('/markets/:marketId/run-days', updateMarketRunDays);

// Delivery Zones
router.get('/zones', getAdminDeliveryZones);
router.post('/zones', createDeliveryZone);
router.patch('/zones/:zoneId', updateDeliveryZone);

// Delivery Rates
router.get('/delivery-rates', getDeliveryRates);
router.put('/delivery-rates', upsertDeliveryRates);

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

// Cleaning HOME Pricing Config (must come before :id routes)
router.get('/cleaning/pricing', getHomePricing);
router.put('/cleaning/pricing', updateHomePricing);

// Cleaning Requests
router.get('/cleaning', adminListCleaningRequests);
router.post('/cleaning/:id/schedule-inspection', adminScheduleInspection);
router.patch('/cleaning/:id/complete-inspection', cleaningPhotoUpload.array('beforePhotos', 8), adminCompleteInspection);
router.post('/cleaning/:id/quote', adminSendQuote);
router.patch('/cleaning/:id/assign', adminAssignCleaner);
router.patch('/cleaning/:id/status', cleaningPhotoUpload.array('afterPhotos', 8), adminUpdateCleaningStatus);

export default router;
