import { Router } from 'express';
import { googleLogin, directLogin, getCurrentUser } from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/google', googleLogin);
router.post('/login', directLogin);
router.get('/me', authMiddleware, getCurrentUser);

export default router;
