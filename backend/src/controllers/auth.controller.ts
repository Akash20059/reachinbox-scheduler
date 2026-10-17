import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

import { AuthUser } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

export function setTokenCookie(res: Response, token: string) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
}

// Passport Google OAuth callback handler
export async function handleGoogleOAuthSuccess(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as AuthUser | undefined;
    if (!user) {
      res.redirect(`${env.FRONTEND_URL}/login?error=auth_failed`);
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, avatar: user.avatar },
      env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    setTokenCookie(res, token);
    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (error) {
    logger.error({ error }, 'Error in Google OAuth callback handler');
    res.redirect(`${env.FRONTEND_URL}/login?error=oauth_error`);
  }
}

// Direct email login (matching Figma design's email login option)
export async function directLogin(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const name = email.split('@')[0];
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
      },
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, avatar: user.avatar },
      env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    setTokenCookie(res, token);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
      token,
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
}

// GET /auth/me -> Returns current user info and Slack connection status
export async function getCurrentUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { slackConnection: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
      slackConnected: !!user.slackConnection?.webhookUrl,
      slackChannel: user.slackConnection?.channel || null,
      slackTeam: user.slackConnection?.teamName || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve user' });
  }
}

// POST /auth/logout -> Clears httpOnly JWT cookie
export async function logout(req: Request, res: Response): Promise<void> {
  res.clearCookie('token', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  res.json({ success: true, message: 'Logged out successfully' });
}
