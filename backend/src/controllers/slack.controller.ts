import { Request, Response } from 'express';
import { exchangeSlackCode, getSlackOAuthUrl } from '../services/slack.js';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../db/prisma.js';

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

    console.log(`✅ Slack connected successfully for user ${userId}`);
    res.redirect(`${env.FRONTEND_URL}?slack_connected=true`);
  } catch (err) {
    console.error('Error in Slack OAuth callback:', err);
    res.redirect(`${env.FRONTEND_URL}?slack_error=oauth_failed`);
  }
}

// DELETE /slack/disconnect -> removes Slack webhook connection
export async function disconnectSlack(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      // Disconnect any active connection if in dev
      await prisma.slackConnection.deleteMany();
      res.json({ success: true, message: 'All Slack connections disconnected' });
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

// GET /slack/status -> returns connection status, channel, and team
export async function getSlackStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    let connection = null;

    if (userId) {
      connection = await prisma.slackConnection.findUnique({
        where: { userId },
      });
    }

    if (!connection) {
      connection = await prisma.slackConnection.findFirst();
    }

    res.json({
      connected: !!connection?.webhookUrl,
      channel: connection?.channel || null,
      teamName: connection?.teamName || null,
      connectedAt: connection?.updatedAt || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve Slack status' });
  }
}
