import { Router } from 'express';
import { listNotifications, markAllRead } from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', listNotifications);
router.patch('/read-all', markAllRead);

export default router;
