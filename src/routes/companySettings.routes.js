import { Router } from 'express';
import { getSettings, patchSettings } from '../controllers/companySettings.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

router.get('/company/settings', requireAuth, requireTenant, getSettings);
router.patch('/company/settings', requireAuth, requireTenant, authorize('HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'), patchSettings);

export default router;
