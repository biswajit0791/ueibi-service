import { Router } from 'express';
import { searchRegistry } from '../controllers/registry.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

// Tenant-scoped registry search — restricted to the roles the sidebar already
// only shows this link to (previously any authenticated role could hit this
// by direct URL; the route had no authorize() gate at all).
router.get('/registry/search', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE'), searchRegistry);

export default router;
