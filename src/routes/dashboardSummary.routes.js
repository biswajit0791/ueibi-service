import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { getDashboardSummary } from '../controllers/dashboard.controller.js';

/**
 * Backs the Common Dashboard (/uer/dashboard), which every corporate role shares.
 *
 * This lives in its own router rather than in dashboard.routes.js on purpose.
 * That file is currently dead — it is imported nowhere, so all twelve of its
 * routes 404 — and mounting it to reach one endpoint would silently activate
 * the other eleven. One of those, GET /dashboard/super-admin, is declared
 * WITHOUT requireTenant and returns platform-wide tenant counts, so switching
 * it on would hand every company's SUPER_ADMIN cross-company data.
 *
 * No authorizeDashboard() guard here: any authenticated tenant user may load
 * their own summary. The controller resolves an audience (SELF / TEAM / TENANT)
 * and narrows every aggregate to what that viewer may see. requireTenant also
 * keeps the platform owner out, since they belong to no company.
 */
const router = Router();

router.get('/dashboard/summary', requireAuth, requireTenant, getDashboardSummary);

export default router;
