import { Router } from 'express';
import { getAnalyticsSummary } from '../controllers/reports.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

router.get('/reports/analytics', requireAuth, requireTenant, getAnalyticsSummary);

export default router;
