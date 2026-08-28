import { Router } from 'express';
import { requestExReview, getExReviewByToken, submitExReview } from '../controllers/exReview.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

// Internal endpoints
router.post('/reviews/request', requireAuth, requireTenant, requestExReview);

// Public endpoints (no authentication required)
router.get('/public/reviews/:token', getExReviewByToken);
router.post('/public/reviews/:token', submitExReview);

export default router;
