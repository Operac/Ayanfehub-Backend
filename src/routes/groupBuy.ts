import { Router } from 'express';
import {
  listGroupBuyEvents, getGroupBuyEvent,
  reserveSlots, cancelReservation,
  initiateGroupBuyPayment,
  joinWaitlist, leaveWaitlist,
  getMyGroupBuys,
} from '../controllers/groupBuyController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', listGroupBuyEvents);
router.get('/my', getMyGroupBuys);
router.get('/:id', getGroupBuyEvent);
router.post('/:id/reserve', reserveSlots);
router.delete('/:id/reserve', cancelReservation);
router.post('/:id/pay', initiateGroupBuyPayment);
router.post('/:id/waitlist', joinWaitlist);
router.delete('/:id/waitlist', leaveWaitlist);

export default router;
