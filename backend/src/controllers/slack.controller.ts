import { Request, Response } from 'express';
import { exchangeSlackCode, getSlackOAuthUrl } from '../services/slack.js';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../db/prisma.js';

export async function getSlackAuthLink(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.id || 'default-user';
  const url = getSlackOAuthUrl(userId);
  res.json({ url });
}

export async function handleSlackOAuthCallback(req: Request, res: Response): Promise<void> {
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error('Slack OAuth returned error:', error);
      res.redirect(`${env.FRONTEND_URL}?slack_error=${encodeURIComponent(String(error))}`);
      return;
    }

    if (!code) {
      res.redirect(`${env.FRONTEND_URL}?slack_error=missing_code`);
      return;
    }

    const userId = (state as string) || (await prisma.user.findFirst())?.id || 'default-user';

    await exchangeSlackCode(String(code), userId);

    // Redirect back to frontend with success query
    res.redirect(`${env.FRONTEND_URL}?slack_connected=true`);
  } catch (err) {
    console.error('Error in Slack OAuth callback:', err);
    res.redirect(`${env.FRONTEND_URL}?slack_error=oauth_failed`);
  }
}

export async function disconnectSlack(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await prisma.slackConnection.deleteMany({
      where: { userId },
    });

    res.json({ success: true, message: 'Slack disconnected successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect Slack' });
  }
}
