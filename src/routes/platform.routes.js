import { Router } from 'express';
import {
  getPlatformOverview,
  listPlatformTenants,
  suspendTenant,
  restoreTenant,
  getPlatformAudit,
} from '../controllers/platform.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner } from '../middleware/rbac.js';

const router = Router();

// Note the absence of requireTenant: these handlers read ACROSS tenants by
// design, and requireTenant would pin them to the platform's own tenant row.
// requirePlatformOwner is what keeps them closed — no company role passes it.
router.get('/platform/overview', requireAuth, requirePlatformOwner, getPlatformOverview);
router.get('/platform/tenants', requireAuth, requirePlatformOwner, listPlatformTenants);

// Lifecycle. Every mutation writes a PlatformAuditLog row in the same
// transaction as the change itself.
router.post('/platform/tenants/:id/suspend', requireAuth, requirePlatformOwner, suspendTenant);
router.post('/platform/tenants/:id/restore', requireAuth, requirePlatformOwner, restoreTenant);

// The trail of what the operator has done.
router.get('/platform/audit', requireAuth, requirePlatformOwner, getPlatformAudit);

export default router;
