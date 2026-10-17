import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  avatar?: string | null;
}

declare global {
  namespace Express {
    // Extend Passport's User interface
    interface User extends AuthUser {}
  }
}

export type AuthenticatedRequest = Request;

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let token: string | undefined;

    // 1. Check httpOnly cookie
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    // 2. Fallback to Authorization Header
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, env.JWT_SECRET) as AuthUser;
        req.user = decoded;
        return next();
      } catch {
        res.status(401).json({ error: 'Unauthorized: Token expired or invalid' });
        return;
      }
    }

    res.status(401).json({ error: 'Unauthorized: Valid authentication cookie required' });
  } catch {
    res.status(401).json({ error: 'Unauthorized: Authentication failed' });
  }
}
