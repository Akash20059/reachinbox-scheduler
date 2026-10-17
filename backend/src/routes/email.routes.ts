import { Router } from 'express';
import {
  scheduleEmails,
  getScheduledEmails,
  getSentEmails,
  getEmailStats,
  getSenders,
  searchEmails,
} from '../controllers/email.controller.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Apply auth middleware
router.use(authMiddleware);

// Schedule endpoint
router.post('/schedule', scheduleEmails);

// Search endpoint (GET /api/emails/search?q=&status=)
router.get('/emails/search', searchEmails);
router.get('/search', searchEmails);

// Email lists (supports both /emails/scheduled and /scheduled)
router.get('/emails/scheduled', getScheduledEmails);
router.get('/emails/sent', getSentEmails);
router.get('/emails/stats', getEmailStats);
router.get('/emails/senders', getSenders);

router.get('/scheduled', getScheduledEmails);
router.get('/sent', getSentEmails);
router.get('/stats', getEmailStats);
router.get('/senders', getSenders);

export default router;
