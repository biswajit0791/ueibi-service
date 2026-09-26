import { Router } from 'express';
import {
  inviteEmployee,
  bulkInviteEmployees,
  getEligibleManagers,
  resendInvite,
  onboardEmployee,
  listEmployees,
  getEmployee,
  listExEmployees,
  addExEmployee,
  bulkAddExEmployees,
  listNonJoiners,
  addNonJoiner,
  bulkAddNonJoiners,
  updateEmployee,
  updateExEmployee,
  updateNonJoiner,
  deleteEmployee,
  deleteExEmployee,
  deleteNonJoiner,
  getEmployeeStats,
  exitEmployee,
  reactivateEmployee,
} from '../controllers/employee.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize, authorizeRoleOrCapability } from '../middleware/rbac.js';

const router = Router();

// ── Active Employees ─────────────────────────────────────────────────────────
router.post('/employees', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'), inviteEmployee);
router.post('/employees/bulk-invite', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'), bulkInviteEmployees);
router.get('/employees/managers', requireAuth, requireTenant, getEligibleManagers);
router.patch('/employees/onboard', requireAuth, requireTenant, onboardEmployee);
router.get('/employees', requireAuth, requireTenant, listEmployees);

// Stats — must be registered BEFORE /:id to avoid route collision
router.get('/employees/stats', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'), getEmployeeStats);

router.patch('/employees/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), updateEmployee);
router.delete('/employees/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), deleteEmployee);

// Invitation resend & Exit/Reactivation workflows
router.post('/employees/:id/resend-invite', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'), resendInvite);
router.post('/employees/:id/exit', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), exitEmployee);
router.post('/employees/:id/reactivate', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), reactivateEmployee);

// ── Ex-Employees ─────────────────────────────────────────────────────────────
router.get('/employees/ex', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_SEARCH', 'REGISTRY_WRITE']), listExEmployees);
router.post('/employees/ex', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), addExEmployee);
router.post('/employees/ex/bulk', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), bulkAddExEmployees);
router.patch('/employees/ex/:id', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), updateExEmployee);
router.delete('/employees/ex/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), deleteExEmployee);

// ── Non-Joiners / Offers ─────────────────────────────────────────────────────
router.get('/employees/offers', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_SEARCH', 'REGISTRY_WRITE']), listNonJoiners);
router.post('/employees/offers', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), addNonJoiner);
router.post('/employees/offers/bulk', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), bulkAddNonJoiners);
router.patch('/employees/offers/:id', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), updateNonJoiner);
router.delete('/employees/offers/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), deleteNonJoiner);

// Single-employee detail — registered LAST among /employees GET routes so it
// never shadows the more specific /employees/ex, /employees/offers, /employees/stats, /employees/managers.
router.get('/employees/:id', requireAuth, requireTenant, getEmployee);

export default router;

