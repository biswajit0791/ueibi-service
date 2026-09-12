import { Router } from 'express';
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deactivateDepartment,
} from '../controllers/department.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

// ── Read (all roles can select from the dropdown) ──────────────────────────────
router.get(
  '/departments',
  requireAuth,
  requireTenant,
  listDepartments
);

// ── Create (SUPER_ADMIN, ADMIN, HR) ────────────────────────────────────────────
router.post(
  '/departments',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  createDepartment
);

// ── Update name / description / color / sortOrder (SUPER_ADMIN, ADMIN, HR) ─────
router.patch(
  '/departments/:id',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN', 'HR'),
  updateDepartment
);

// ── Archive / soft-delete (SUPER_ADMIN, ADMIN only — not HR) ───────────────────
router.delete(
  '/departments/:id',
  requireAuth,
  requireTenant,
  authorize('SUPER_ADMIN', 'ADMIN'),
  deactivateDepartment
);

export default router;
