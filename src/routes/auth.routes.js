import { Router } from 'express';
import { login, me, logout, forgotPassword, resetPassword } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { passwordResetRateLimit } from '../middleware/rateLimit.js';

const router = Router();

router.post('/auth/login', login);
router.post('/auth/logout', logout);
router.get('/auth/me', requireAuth, me);

// Password Recovery endpoints
router.post('/auth/forgot-password', passwordResetRateLimit, forgotPassword);
router.post('/auth/reset-password', passwordResetRateLimit, resetPassword);

export default router;

