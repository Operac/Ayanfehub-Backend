import { Router } from 'express';
import { applyPartner, getPartnerApplications, updatePartnerStatus } from '../controllers/partnerController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Public applicant endpoint - submit a partnership proposal
router.post('/apply', applyPartner);

// Admin-only management endpoints
router.use(requireAdmin);
router.get('/admin', getPartnerApplications);
router.patch('/admin/:id', updatePartnerStatus);

export default router;
