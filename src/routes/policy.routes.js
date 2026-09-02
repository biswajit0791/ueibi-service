import { Router } from 'express';
import {
  getMyPolicies,
  getMyPolicyById,
  signPolicy,
  listPolicies,
  getPolicyById,
  createPolicy,
  updatePolicy,
  publishPolicy,
  archivePolicy,
  deletePolicy,
  assignPolicy,
  getComplianceRegistry,
  getPendingCompliance,
  sendReminders,
  exportComplianceCSV,
} from '../controllers/policy.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

const hrRoles = ['SUPER_ADMIN', 'ADMIN', 'HR', 'LEADERSHIP', 'OWNER'];

// ── Employee Personal Policy Actions ─────────────────────────────────────────
router.get('/policies/my', requireAuth, requireTenant, getMyPolicies);
router.get('/policies/my/:id', requireAuth, requireTenant, getMyPolicyById);
router.post('/policies/:id/sign', requireAuth, requireTenant, signPolicy);

// ── HR Compliance & Reporting Endpoints ─────────────────────────────────────
router.get('/policies/compliance/registry', requireAuth, requireTenant, authorize(...hrRoles), getComplianceRegistry);
router.get('/policies/compliance/pending', requireAuth, requireTenant, authorize(...hrRoles), getPendingCompliance);
router.get('/policies/compliance/export', requireAuth, requireTenant, authorize(...hrRoles), exportComplianceCSV);

// ── HR Policy Management & Lifecycle Endpoints ──────────────────────────────
router.get('/policies', requireAuth, requireTenant, authorize(...hrRoles), listPolicies);
router.post('/policies', requireAuth, requireTenant, authorize(...hrRoles), createPolicy);
router.get('/policies/:id', requireAuth, requireTenant, authorize(...hrRoles), getPolicyById);
router.put('/policies/:id', requireAuth, requireTenant, authorize(...hrRoles), updatePolicy);
router.delete('/policies/:id', requireAuth, requireTenant, authorize(...hrRoles), deletePolicy);
router.post('/policies/:id/publish', requireAuth, requireTenant, authorize(...hrRoles), publishPolicy);
router.post('/policies/:id/archive', requireAuth, requireTenant, authorize(...hrRoles), archivePolicy);
router.post('/policies/:id/assign', requireAuth, requireTenant, authorize(...hrRoles), assignPolicy);
router.post('/policies/:id/reminders', requireAuth, requireTenant, authorize(...hrRoles), sendReminders);
router.post('/policies/:id/remind', requireAuth, requireTenant, authorize(...hrRoles), sendReminders);

export default router;
