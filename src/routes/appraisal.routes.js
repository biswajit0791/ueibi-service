import { Router } from 'express';
import { submitSelfRating, submitManagerRating, listReviews } from '../controllers/appraisal.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

router.post('/appraisals/submit', requireAuth, requireTenant, submitSelfRating);
router.patch('/appraisals/:id/manager-review', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'MANAGER'), submitManagerRating);
router.get('/appraisals', requireAuth, requireTenant, listReviews);

export default router;
