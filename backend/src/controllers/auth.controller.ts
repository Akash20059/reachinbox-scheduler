import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export async function googleLogin(req: Request, res: Response): Promise<void> {
  try {
    const { credential, accessToken } = req.body;

    let email = '';
    let name = 'User';
    let avatar = '';
    let googleId = '';

    if (credential) {
      // Verify Google ID Token (from Google One-Tap or Google Identity Services button)
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        res.status(400).json({ error: 'Invalid Google token payload' });
        return;
      }
      email = payload.email;
      name = payload.name || payload.given_name || 'User';
      avatar = payload.picture || '';
      googleId = payload.sub;
    } else if (accessToken) {
      // Access token flow: fetch userinfo from Google
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const userInfo = (await userInfoRes.json()) as any;
      if (!userInfo?.email) {
        res.status(400).json({ error: 'Failed to fetch user info from Google' });
        return;
      }
      email = userInfo.email;
      name = userInfo.name || 'User';
      avatar = userInfo.picture || '';
      googleId = userInfo.sub;
    } else {
      res.status(400).json({ error: 'Missing credential or accessToken' });
      return;
    }

    // Upsert User
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, avatar, googleId },
      create: { email, name, avatar, googleId },
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, avatar: user.avatar },
      env.JWT_SECRET,
      { expiresIn: '7d' }
    );

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
    console.error('Google login error:', error);
    res.status(500).json({ error: 'Failed to authenticate with Google' });
  }
}

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
