import { Router } from 'express';
import {
  createGoal,
  listGoals,
  getGoalById,
  updateGoal,
  deleteGoal,
  getAssignableUsers,
  getGoalCategories,
  getGoalTypes,
  getGoalPriorities,
  activateApproveGoal,
  submitGoal,
  managerApproveGoal,
  managerRejectGoal,
  hrApproveGoal,
  hrRejectGoal,
  resubmitGoal,
} from '../controllers/goal.controller.js';
import {
  getMyGoals,
  syncGoalsToAppraisal,
} from '../controllers/appraisal.controller.js';
import {
  addGoalComment,
  listGoalComments,
  listGoalAudit,
  deleteGoalComment,
} from '../controllers/goalActivity.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

// ── Metadata & Dynamic Dropdowns ───────────────────────────────────────────
router.get('/goals/categories', requireAuth, requireTenant, getGoalCategories);
router.get('/goals/types', requireAuth, requireTenant, getGoalTypes);
router.get('/goals/priorities', requireAuth, requireTenant, getGoalPriorities);
router.get('/goals/assignable-users', requireAuth, requireTenant, getAssignableUsers);

// ── Goal CRUD ──────────────────────────────────────────────────────────────
router.post('/goals', requireAuth, requireTenant, createGoal);
router.get('/goals', requireAuth, requireTenant, listGoals);
router.get('/goals/mine', requireAuth, requireTenant, getMyGoals);
router.post('/goals/sync-to-appraisal', requireAuth, requireTenant, syncGoalsToAppraisal);
router.get('/goals/:id', requireAuth, requireTenant, getGoalById);
router.patch('/goals/:id', requireAuth, requireTenant, updateGoal);
router.delete('/goals/:id', requireAuth, requireTenant, deleteGoal);

// ── Workflow Actions ───────────────────────────────────────────────────────
//
// Flow A: Employee self-created
//   DRAFT → [/submit] → PENDING_MANAGER_REVIEW → [/approve] → PENDING_HR_REVIEW → [/hr-approve] → COMPLETED
//
// Flow B: Manager + MANAGER_APPROVAL
//   PENDING_APPROVAL → [/activate-approve] → ACTIVE → [/submit] → PENDING_MANAGER_REVIEW → [/approve] → PENDING_HR_REVIEW → [/hr-approve] → COMPLETED
//
// Flow C: Manager + AUTO_APPROVE
//   ACTIVE → [/submit] → PENDING_MANAGER_REVIEW → [/approve] → PENDING_HR_REVIEW → [/hr-approve] → COMPLETED
//
// Corrections (any flow):
//   CHANGES_REQUESTED → [/resubmit] → PENDING_MANAGER_REVIEW → ...
//
router.post('/goals/:id/activate-approve', requireAuth, requireTenant, activateApproveGoal);
router.post('/goals/:id/submit', requireAuth, requireTenant, submitGoal);
router.post('/goals/:id/approve', requireAuth, requireTenant, managerApproveGoal);
router.post('/goals/:id/reject', requireAuth, requireTenant, managerRejectGoal);
router.post('/goals/:id/hr-approve', requireAuth, requireTenant, hrApproveGoal);
router.post('/goals/:id/hr-reject', requireAuth, requireTenant, hrRejectGoal);
router.post('/goals/:id/resubmit', requireAuth, requireTenant, resubmitGoal);

// ── Goal Activity & Audit ──────────────────────────────────────────────────
router.post('/goals/:id/comments', requireAuth, requireTenant, addGoalComment);
router.get('/goals/:id/comments', requireAuth, requireTenant, listGoalComments);
router.delete('/goals/:id/comments/:cid', requireAuth, requireTenant, deleteGoalComment);
router.get('/goals/:id/audit', requireAuth, requireTenant, listGoalAudit);

export default router;
