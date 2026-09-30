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
  restoreExEmployee,
  getEmployeeHandoverStatus,
  verifyEmployee,
  generateExEmployeeRefCheckPdf,
  addTenantLicenses,
  listLicenseRequests,
  requestTenantLicenses,
  payAndAddLicenses,
  rejectLicenseRequest,
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

// License capacity management & request workflow
router.get('/employees/license-requests', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE', 'CMD'), listLicenseRequests);
router.post('/employees/request-license', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'CMD'), requestTenantLicenses);
router.post('/employees/pay-license', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE', 'CMD'), payAndAddLicenses);
router.post('/employees/reject-license-request', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE', 'CMD'), rejectLicenseRequest);
router.post('/employees/add-license', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE', 'CMD'), addTenantLicenses);

// Stats & Handover Status — must be registered BEFORE /:id to avoid route collision
router.get('/employees/stats', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'FINANCE'), getEmployeeStats);
router.get('/employees/:id/handover-status', requireAuth, requireTenant, getEmployeeHandoverStatus);

// Verification workflow for HR / Admins
router.post('/employees/:id/verify', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), verifyEmployee);
router.patch('/employees/:id/verify', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), verifyEmployee);

router.patch('/employees/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), updateEmployee);
router.delete('/employees/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), deleteEmployee);

// Invitation resend & Exit/Reactivation workflows
router.post('/employees/:id/resend-invite', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER'), resendInvite);
router.post('/employees/:id/exit', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), exitEmployee);
router.post('/employees/:id/reactivate', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), reactivateEmployee);
router.post('/employees/:id/restore', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), restoreExEmployee);

// ── Ex-Employees ─────────────────────────────────────────────────────────────
router.get('/employees/ex', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE'], ['REGISTRY_SEARCH', 'REGISTRY_WRITE']), listExEmployees);
router.post('/employees/ex', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), addExEmployee);
router.post('/employees/ex/bulk', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), bulkAddExEmployees);
router.patch('/employees/ex/:id', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), updateExEmployee);
router.get('/employees/ex/:id/refcheck-pdf', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE'], ['REGISTRY_SEARCH', 'REGISTRY_WRITE']), generateExEmployeeRefCheckPdf);
router.post('/employees/ex/:id/restore', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), restoreExEmployee);
console.log('[ROUTES] POST /employees/ex/:id/restore → restoreExEmployee registered');
router.delete('/employees/ex/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), deleteExEmployee);

// ── Non-Joiners / Offers ─────────────────────────────────────────────────────
router.get('/employees/offers', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE'], ['REGISTRY_SEARCH', 'REGISTRY_WRITE']), listNonJoiners);
router.post('/employees/offers', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), addNonJoiner);
router.post('/employees/offers/bulk', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), bulkAddNonJoiners);
router.patch('/employees/offers/:id', requireAuth, requireTenant, authorizeRoleOrCapability(['SUPER_ADMIN', 'ADMIN', 'HR'], ['REGISTRY_WRITE']), updateNonJoiner);
router.delete('/employees/offers/:id', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), deleteNonJoiner);

// Single-employee detail — registered LAST among /employees GET routes so it
// never shadows the more specific /employees/ex, /employees/offers, /employees/stats, /employees/managers.
router.get('/employees/:id', requireAuth, requireTenant, getEmployee);

export default router;

