import { Router } from 'express';
import {
  getAnalyticsSummary,
  getPerformanceTrend,
  getReportCatalog,
  exportReport,
} from '../controllers/reports.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

// Org-wide performance analytics exposes every employee's appraisal ratings,
// hike percentages and per-department scores, so it carries the same gate as
// the appraisal cycle summary it reuses (appraisal.routes.js). Previously
// these routes had no authorize() at all — any authenticated EMPLOYEE could
// read the whole organisation's ratings.
const REPORT_ROLES = ['HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'];

router.get('/reports/analytics', requireAuth, requireTenant, authorize(...REPORT_ROLES), getAnalyticsSummary);
router.get('/reports/trend', requireAuth, requireTenant, authorize(...REPORT_ROLES), getPerformanceTrend);
router.get('/reports/catalog', requireAuth, requireTenant, authorize(...REPORT_ROLES), getReportCatalog);
router.get('/reports/export/:reportKey', requireAuth, requireTenant, authorize(...REPORT_ROLES), exportReport);

export default router;
