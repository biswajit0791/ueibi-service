import { Router } from 'express';
import {
  getAnalyticsSummary,
  getPerformanceTrend,
  getReportCatalog,
  exportReport,
} from '../controllers/reports.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize, authorizeRoleOrCapability} from '../middleware/rbac.js';

const router = Router();

// Org-wide performance analytics exposes every employee's appraisal ratings,
// hike percentages and per-department scores, so it carries the same gate as
// the appraisal cycle summary it reuses (appraisal.routes.js). Previously
// these routes had no authorize() at all — any authenticated EMPLOYEE could
// read the whole organisation's ratings.
const REPORT_ROLES = ['HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'];

// REGISTRY_ANALYTICS backs the "Can view verification analytics & billing
// history reports" credential on the sub-login invite.
router.get('/reports/analytics', requireAuth, requireTenant, authorizeRoleOrCapability(REPORT_ROLES, ['REGISTRY_ANALYTICS']), getAnalyticsSummary);
router.get('/reports/trend', requireAuth, requireTenant, authorizeRoleOrCapability(REPORT_ROLES, ['REGISTRY_ANALYTICS']), getPerformanceTrend);
router.get('/reports/catalog', requireAuth, requireTenant, authorizeRoleOrCapability(REPORT_ROLES, ['REGISTRY_ANALYTICS']), getReportCatalog);
// Export is its own credential: a Viewer may read but must not take the data
// away, which is what separates Viewer from Recruiter.
router.get('/reports/export/:reportKey', requireAuth, requireTenant, authorizeRoleOrCapability(REPORT_ROLES, ['REGISTRY_EXPORT']), exportReport);

export default router;
