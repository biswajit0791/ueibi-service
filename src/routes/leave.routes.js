import { Router } from 'express';
import {
  createLeaveType,
  listLeaveTypes,
  getLeaveTypeById,
  updateLeaveType,
  toggleLeaveTypeStatus,
  deleteLeaveType,
  listActiveLeaveTypes,
  getMyLeaveBalances,
  listEmployeeBalances,
  adjustEmployeeBalance,
  createLeaveRequest,
  listLeaveRequests,
  cancelLeaveRequest,
  managerApproveLeave,
  managerRejectLeave,
  hrApproveLeave,
  hrRejectLeave,
  adminApproveLeave,
  adminRejectLeave,
  approveLeaveRequest,
  rejectLeaveRequest,
  getWfhPolicy,
  updateWfhPolicy,
  getLeaveOverviewStats,
  getLeaveCalendarView,
  getLeaveAuditLogs,
} from '../controllers/leave.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

const hrRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'LEADERSHIP', 'OWNER', 'CMD', 'DIRECTOR'];
const managerRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'LEADERSHIP', 'OWNER', 'CMD', 'DIRECTOR'];

// ── 1. Admin Leave Types Management (CRUD) ──────────────────────────────────
router.post('/admin/leave-types', requireAuth, requireTenant, authorize(...hrRoles), createLeaveType);
router.get('/admin/leave-types', requireAuth, requireTenant, authorize(...hrRoles), listLeaveTypes);
router.get('/admin/leave-types/:id', requireAuth, requireTenant, authorize(...hrRoles), getLeaveTypeById);
router.put('/admin/leave-types/:id', requireAuth, requireTenant, authorize(...hrRoles), updateLeaveType);
router.patch('/admin/leave-types/:id', requireAuth, requireTenant, authorize(...hrRoles), updateLeaveType);
router.patch('/admin/leave-types/:id/status', requireAuth, requireTenant, authorize(...hrRoles), toggleLeaveTypeStatus);
router.delete('/admin/leave-types/:id', requireAuth, requireTenant, authorize(...hrRoles), deleteLeaveType);

// ── 2. Common Leave Types (Employee Dropdown & Details) ─────────────────────
router.get('/leave-types', requireAuth, requireTenant, listActiveLeaveTypes);
router.get('/leave-types/:id', requireAuth, requireTenant, getLeaveTypeById);

// ── 3. Dynamic Balances ─────────────────────────────────────────────────────
router.get('/leaves/balances', requireAuth, requireTenant, getMyLeaveBalances);
router.get('/leave-balances/me', requireAuth, requireTenant, getMyLeaveBalances); // Alias
router.get('/admin/leave-balances', requireAuth, requireTenant, authorize(...hrRoles), listEmployeeBalances);
router.post('/admin/leave-balances/adjust', requireAuth, requireTenant, authorize(...hrRoles), adjustEmployeeBalance);

// ── 4. Leave & WFH Requests ─────────────────────────────────────────────────
router.post('/leaves', requireAuth, requireTenant, createLeaveRequest);
router.get('/leaves', requireAuth, requireTenant, listLeaveRequests);
router.post('/leaves/:id/cancel', requireAuth, requireTenant, cancelLeaveRequest);

// ── 5. Two-Level & Admin Approvals ──────────────────────────────────────────
router.patch('/leaves/:id/admin/approve', requireAuth, requireTenant, authorize(...hrRoles), adminApproveLeave);
router.patch('/leaves/:id/admin/reject', requireAuth, requireTenant, authorize(...hrRoles), adminRejectLeave);
router.patch('/leaves/:id/manager/approve', requireAuth, requireTenant, authorize(...managerRoles), managerApproveLeave);
router.patch('/leaves/:id/manager/reject', requireAuth, requireTenant, authorize(...managerRoles), managerRejectLeave);
router.patch('/leaves/:id/hr/approve', requireAuth, requireTenant, authorize(...hrRoles), hrApproveLeave);
router.patch('/leaves/:id/hr/reject', requireAuth, requireTenant, authorize(...hrRoles), hrRejectLeave);
router.patch('/leaves/:id/approve', requireAuth, requireTenant, authorize(...managerRoles), approveLeaveRequest);
router.patch('/leaves/:id/reject', requireAuth, requireTenant, authorize(...managerRoles), rejectLeaveRequest);

// ── 6. Work From Home Policies ──────────────────────────────────────────────
router.get('/wfh/policy', requireAuth, requireTenant, getWfhPolicy);
router.get('/admin/wfh/policy', requireAuth, requireTenant, authorize(...hrRoles), getWfhPolicy);
router.put('/admin/wfh/policy', requireAuth, requireTenant, authorize(...hrRoles), updateWfhPolicy);
router.patch('/admin/wfh/policy', requireAuth, requireTenant, authorize(...hrRoles), updateWfhPolicy);

// ── 7. Overview Stats, Calendar & Audit Logs ────────────────────────────────
router.get('/admin/leave-overview/stats', requireAuth, requireTenant, authorize(...hrRoles), getLeaveOverviewStats);
router.get('/admin/leave-overview/calendar', requireAuth, requireTenant, authorize(...hrRoles), getLeaveCalendarView);
router.get('/admin/leave-logs', requireAuth, requireTenant, authorize(...hrRoles), getLeaveAuditLogs);

export default router;
