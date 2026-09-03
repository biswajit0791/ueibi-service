import { Router } from 'express';
import { requestExReview, getExReviewByToken, submitExReview } from '../controllers/exReview.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

// Internal endpoints (authenticated employee)
router.post('/ex-employer-reviews', requireAuth, requireTenant, requestExReview);
router.post('/reviews/request', requireAuth, requireTenant, requestExReview); // backward compat

// Public endpoints (no authentication required)
router.get('/public/ex-employer-review/:token', getExReviewByToken);
router.post('/public/ex-employer-review/:token', submitExReview);
router.get('/public/reviews/:token', getExReviewByToken); // backward compat
router.post('/public/reviews/:token', submitExReview); // backward compat

export default router;
