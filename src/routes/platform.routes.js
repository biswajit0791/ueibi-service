import { Router } from 'express';
import { getPlatformOverview, listPlatformTenants } from '../controllers/platform.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner } from '../middleware/rbac.js';

const router = Router();

// Note the absence of requireTenant: these handlers read ACROSS tenants by
// design, and requireTenant would pin them to the platform's own tenant row.
// requirePlatformOwner is what keeps them closed — no company role passes it.
router.get('/platform/overview', requireAuth, requirePlatformOwner, getPlatformOverview);
router.get('/platform/tenants', requireAuth, requirePlatformOwner, listPlatformTenants);

export default router;
