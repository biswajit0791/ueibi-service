import { Router } from 'express';
import {
  login,
  me,
  logout,
  forgotPassword,
  resetPassword,
  verifyLoginOtp,
  resendLoginOtp,
  get2FAStatus,
  requestEnable2FAHandler,
  verifyEnable2FAHandler,
  disable2FAHandler,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { passwordResetRateLimit, authRateLimit } from '../middleware/rateLimit.js';

const router = Router();

router.post('/auth/login', authRateLimit, login);
router.post('/auth/verify-login-otp', authRateLimit, verifyLoginOtp);
router.post('/auth/resend-login-otp', authRateLimit, resendLoginOtp);
router.post('/auth/logout', logout);
router.get('/auth/me', requireAuth, me);

// User-Level Two-Factor Authentication (2FA) Management
router.get('/auth/2fa/status', requireAuth, get2FAStatus);
router.post('/auth/2fa/enable/request', requireAuth, authRateLimit, requestEnable2FAHandler);
router.post('/auth/2fa/enable/verify', requireAuth, authRateLimit, verifyEnable2FAHandler);
router.post('/auth/2fa/disable', requireAuth, authRateLimit, disable2FAHandler);

// Password Recovery endpoints
router.post('/auth/forgot-password', passwordResetRateLimit, forgotPassword);
router.post('/auth/reset-password', passwordResetRateLimit, resetPassword);



export default router;

