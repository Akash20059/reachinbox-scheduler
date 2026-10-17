import { Router } from 'express';
import passport from '../config/passport.js';
import {
  handleGoogleOAuthSuccess,
  directLogin,
  getCurrentUser,
  logout,
} from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /auth/google -> initiates Google OAuth flow
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    prompt: 'select_account',
  })
);

// GET /auth/google/callback -> passport handles exchange, upserts user, sets cookie, redirects
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: 'http://localhost:5173/login?error=google_failed',
  }),
  handleGoogleOAuthSuccess
);

// Direct email login (demo fallback matching Figma)
router.post('/login', directLogin);

// GET /auth/me -> current user info
router.get('/me', authMiddleware, getCurrentUser);

// POST /auth/logout -> clears cookie
router.post('/logout', logout);

export default router;
