import { Router } from 'express';
import {
  scheduleEmails,
  getScheduledEmails,
  getSentEmails,
  getEmailStats,
  getSenders,
} from '../controllers/email.controller.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.post('/schedule', scheduleEmails);
router.get('/scheduled', getScheduledEmails);
router.get('/sent', getSentEmails);
router.get('/stats', getEmailStats);
router.get('/senders', getSenders);

export default router;
