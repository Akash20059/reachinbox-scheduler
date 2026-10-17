import { Router } from 'express';
import {
  connectSlack,
  getSlackAuthLink,
  handleSlackOAuthCallback,
  disconnectSlack,
  getSlackStatus,
} from '../controllers/slack.controller.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /slack/connect -> direct redirect to Slack authorize
router.get('/connect', connectSlack);

// GET /slack/auth-url -> JSON URL
router.get('/auth-url', authMiddleware, getSlackAuthLink);

// GET /slack/callback -> OAuth code exchange
router.get('/callback', handleSlackOAuthCallback);

// DELETE /slack/disconnect -> disconnect
router.delete('/disconnect', authMiddleware, disconnectSlack);
router.post('/disconnect', authMiddleware, disconnectSlack); // Support POST as well

// GET /slack/status -> connection status
router.get('/status', authMiddleware, getSlackStatus);

export default router;
