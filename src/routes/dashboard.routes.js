import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorizeDashboard } from '../middleware/rbac.js';
import {
  getSuperAdminDashboardData,
  getAdminDashboardData,
  getHrDashboardData,
  getFinanceDashboardData,
  getManagerDashboardData,
  getEmployeeDashboardData,
} from '../controllers/dashboard.controller.js';

const router = Router();

// ── Super Admin Dashboard ───────────────────────────────────────────────────
// Accessible ONLY by SUPER_ADMIN.
router.get('/dashboard/super-admin', requireAuth, authorizeDashboard('SUPER_ADMIN'), getSuperAdminDashboardData);
router.get('/super-admin/dashboard', requireAuth, authorizeDashboard('SUPER_ADMIN'), getSuperAdminDashboardData);

// ── Admin Dashboard ─────────────────────────────────────────────────────────
// Accessible by SUPER_ADMIN and ADMIN.
router.get('/dashboard/admin', requireAuth, requireTenant, authorizeDashboard('ADMIN'), getAdminDashboardData);
router.get('/admin/dashboard', requireAuth, requireTenant, authorizeDashboard('ADMIN'), getAdminDashboardData);

// ── HR Dashboard ────────────────────────────────────────────────────────────
// Accessible by SUPER_ADMIN, ADMIN, HR.
router.get('/dashboard/hr', requireAuth, requireTenant, authorizeDashboard('HR'), getHrDashboardData);
router.get('/hr/dashboard', requireAuth, requireTenant, authorizeDashboard('HR'), getHrDashboardData);

// ── Finance Dashboard ───────────────────────────────────────────────────────
// Accessible by SUPER_ADMIN, ADMIN, HR, FINANCE.
router.get('/dashboard/finance', requireAuth, requireTenant, authorizeDashboard('FINANCE'), getFinanceDashboardData);
router.get('/finance/dashboard', requireAuth, requireTenant, authorizeDashboard('FINANCE'), getFinanceDashboardData);

// ── Manager Dashboard ───────────────────────────────────────────────────────
// Accessible by SUPER_ADMIN, ADMIN, HR, FINANCE, MANAGER.
router.get('/dashboard/manager', requireAuth, requireTenant, authorizeDashboard('MANAGER'), getManagerDashboardData);
router.get('/manager/dashboard', requireAuth, requireTenant, authorizeDashboard('MANAGER'), getManagerDashboardData);

// ── Employee Dashboard ──────────────────────────────────────────────────────
// Accessible by ALL authenticated tenant roles.
router.get('/dashboard/employee', requireAuth, requireTenant, authorizeDashboard('EMPLOYEE'), getEmployeeDashboardData);
router.get('/employee/dashboard', requireAuth, requireTenant, authorizeDashboard('EMPLOYEE'), getEmployeeDashboardData);

export default router;
