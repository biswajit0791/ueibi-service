import { Router } from 'express';
import { requestOtp, verifyOtp, createRegistration } from '../controllers/registration.controller.js';
import { otpRateLimit } from '../middleware/rateLimit.js';

const router = Router();

router.post('/registrations/otp/request', otpRateLimit, requestOtp);
router.post('/registrations/otp/verify', otpRateLimit, verifyOtp);
router.post('/registrations', createRegistration);

export default router;
