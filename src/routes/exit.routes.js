import { Router } from 'express';
import {
  initiateExit,
  saveExitInterview,
  approveClearance,
  getExitStatus,
  getMyExitStatus,
  listPendingExits,
  listMyClearanceInbox,
  completeExit,
  generateCertificate,
  sendExitDocuments,
} from '../controllers/exit.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

// ── Exit Workflow ────────────────────────────────────────────────────────────

// List all pending exits for this tenant
router.get('/exit/pending', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE'), listPendingExits);

// Exits on which the caller must give a clearance (e.g. a reporting manager).
// Any role may call it; the controller returns only records the caller can act on.
router.get('/exit/clearances/inbox', requireAuth, requireTenant, listMyClearanceInbox);

// Employee self-service exit status
router.get('/exit/my-status', requireAuth, requireTenant, getMyExitStatus);

// Initiate exit process for an employee
router.post('/exit/:employeeId/initiate', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), initiateExit);

// Get exit status for an employee
router.get('/exit/:employeeId/status', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'FINANCE', 'EMPLOYEE'), getExitStatus);

// Save exit interview
router.patch('/exit/:id/interview', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR'), saveExitInterview);

// Approve department clearance
router.patch('/exit/:id/clearance', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'MANAGER', 'FINANCE'), approveClearance);

// Complete exit (finalize — mark EXITED, free license, archive)
router.post('/exit/:id/complete', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE'), completeExit);

// Generate certificate (relieving / service / termination)
router.post('/exit/:id/certificate/:type', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE'), generateCertificate);

// Send separation & clearance documents to employee via email
router.post('/exit/:id/send-documents', requireAuth, requireTenant, authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE'), sendExitDocuments);

export default router;
