import { Router } from 'express';
import { createLeaveRequest, listLeaveRequests, approveLeaveRequest } from '../controllers/leave.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

router.post('/leaves', requireAuth, requireTenant, createLeaveRequest);
router.get('/leaves', requireAuth, requireTenant, listLeaveRequests);
router.patch('/leaves/:id/approve', requireAuth, requireTenant, approveLeaveRequest);

export default router;
