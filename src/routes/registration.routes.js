import { Router } from 'express';
import {
  requestOtp,
  verifyOtp,
  createRegistration,
  validateCompanyDomain,
  validateOfficialEmail,
  getPublicPricingPreview,
  getPublicRegistrationSettings,
} from '../controllers/registration.controller.js';
import { otpRateLimit, mouValidationRateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Public Configuration Settings for Registration & OTP Security
router.get('/public/mou/settings', mouValidationRateLimit, getPublicRegistrationSettings);
router.get('/registrations/settings', mouValidationRateLimit, getPublicRegistrationSettings);

// Real-time AJAX Validation Endpoints
router.post('/public/mou/validate-company-domain', mouValidationRateLimit, validateCompanyDomain);
router.post('/public/mou/validate-official-email', mouValidationRateLimit, validateOfficialEmail);
router.post('/registrations/validate-domain', mouValidationRateLimit, validateCompanyDomain);
router.post('/registrations/validate-official-email', mouValidationRateLimit, validateOfficialEmail);

// Public Pricing Preview & Coupon Calculation
router.post('/public/mou/pricing-preview', mouValidationRateLimit, getPublicPricingPreview);
router.post('/registrations/pricing-preview', mouValidationRateLimit, getPublicPricingPreview);

// OTP Verification Endpoints
router.post('/public/mou/send-email-otp', otpRateLimit, requestOtp);
router.post('/public/mou/verify-email-otp', otpRateLimit, verifyOtp);
router.post('/registrations/otp/request', otpRateLimit, requestOtp);
router.post('/registrations/otp/verify', otpRateLimit, verifyOtp);

// Final Registration Submission
router.post('/registrations', createRegistration);

export default router;
