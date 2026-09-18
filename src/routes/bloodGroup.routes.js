import { Router } from 'express';
import {
  listBloodGroups,
  createBloodGroup,
  updateBloodGroup,
  deactivateBloodGroup,
} from '../controllers/bloodGroup.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

// ── Read: every authenticated role. This feeds the onboarding dropdown, which
//    an employee completes before they have any elevated permissions. ──
router.get('/blood-groups', requireAuth, requireTenant, listBloodGroups);

// ── Create / update: SUPER_ADMIN, ADMIN, HR (same set as Departments) ──
router.post('/blood-groups', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), createBloodGroup);
router.patch('/blood-groups/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), updateBloodGroup);

// ── Archive: SUPER_ADMIN, ADMIN only — not HR, matching Departments ──
router.delete('/blood-groups/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN'), deactivateBloodGroup);

export default router;
