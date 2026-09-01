import { Router } from 'express';
import {
  createLeaveRequest,
  listLeaveRequests,
  getMyLeaveBalances,
  managerApproveLeave,
  managerRejectLeave,
  hrApproveLeave,
  hrRejectLeave,
  cancelLeaveRequest,
  approveLeaveRequest,
} from '../controllers/leave.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

// ── Leave & WFH Requests ───────────────────────────────────────────────────
router.post('/leaves', requireAuth, requireTenant, createLeaveRequest);
router.get('/leaves', requireAuth, requireTenant, listLeaveRequests);
router.get('/leaves/balances', requireAuth, requireTenant, getMyLeaveBalances);
router.get('/leave-balances/me', requireAuth, requireTenant, getMyLeaveBalances);
router.post('/leaves/:id/cancel', requireAuth, requireTenant, cancelLeaveRequest);

// ── Two-Level Approvals ────────────────────────────────────────────────────
router.patch('/leaves/:id/manager/approve', requireAuth, requireTenant, managerApproveLeave);
router.patch('/leaves/:id/manager/reject', requireAuth, requireTenant, managerRejectLeave);
router.patch('/leaves/:id/hr/approve', requireAuth, requireTenant, hrApproveLeave);
router.patch('/leaves/:id/hr/reject', requireAuth, requireTenant, hrRejectLeave);
router.patch('/leaves/:id/approve', requireAuth, requireTenant, approveLeaveRequest);

export default router;
