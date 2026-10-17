import { Router } from 'express';
import {
  getSlackAuthLink,
  handleSlackOAuthCallback,
  disconnectSlack,
} from '../controllers/slack.controller.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/auth-url', authMiddleware, getSlackAuthLink);
router.get('/callback', handleSlackOAuthCallback);
router.post('/disconnect', authMiddleware, disconnectSlack);

export default router;
