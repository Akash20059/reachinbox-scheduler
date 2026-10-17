import { Request, Response } from 'express';
import { exchangeSlackCode, getSlackOAuthUrl } from '../services/slack.js';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';

// GET /slack/connect -> redirects to Slack OAuth authorization page
export async function connectSlack(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id || (req.query.userId as string) || (await prisma.user.findFirst())?.id || 'default-user';
  const url = getSlackOAuthUrl(userId);
  res.redirect(url);
}

// GET /slack/auth-url -> returns JSON URL for frontend buttons
export async function getSlackAuthLink(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id || (await prisma.user.findFirst())?.id || 'default-user';
  const url = getSlackOAuthUrl(userId);
  res.json({ url });
}

// GET /slack/callback -> exchanges code and stores incoming webhook URL per user
export async function handleSlackOAuthCallback(req: Request, res: Response): Promise<void> {
  try {
    const { code, state, error } = req.query;

    if (error) {
      logger.error({ error }, 'Slack OAuth returned error query param');
      res.redirect(`${env.FRONTEND_URL}?slack_error=${encodeURIComponent(String(error))}`);
      return;
    }

    if (!code) {
      res.redirect(`${env.FRONTEND_URL}?slack_error=missing_code`);
      return;
    }

    const userId = (state as string) || (await prisma.user.findFirst())?.id || 'default-user';

    await exchangeSlackCode(String(code), userId);

    logger.info({ userId }, 'Slack connected successfully in OAuth callback');
    res.redirect(`${env.FRONTEND_URL}?slack_connected=true`);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Error in Slack OAuth callback');
    res.redirect(`${env.FRONTEND_URL}?slack_error=oauth_failed`);
  }
}

// DELETE /slack/disconnect -> removes Slack webhook connection
export async function disconnectSlack(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: Authentication required' });
      return;
    }

    await prisma.slackConnection.deleteMany({
      where: { userId },
    });

    logger.info({ userId }, 'Slack connection disconnected');
    res.json({ success: true, message: 'Slack disconnected successfully' });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to disconnect Slack');
    res.status(500).json({ error: 'Failed to disconnect Slack' });
  }
}

// GET /slack/status -> returns connection status, channel, and team
export async function getSlackStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: Authentication required' });
      return;
    }

    const connection = await prisma.slackConnection.findUnique({
      where: { userId },
    });

    res.json({
      connected: !!connection?.webhookUrl,
      channel: connection?.channel || null,
      teamName: connection?.teamName || null,
      connectedAt: connection?.updatedAt || null,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to retrieve Slack status');
    res.status(500).json({ error: 'Failed to retrieve Slack status' });
  }
}
