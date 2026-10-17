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

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // For development ease, fallback to the first user or mock user if no token provided
      const defaultUser = await prisma.user.findFirst();
      if (defaultUser) {
        req.user = {
          id: defaultUser.id,
          email: defaultUser.email,
          name: defaultUser.name,
          avatar: defaultUser.avatar,
        };
        return next();
      }

      res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthUser;

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}
