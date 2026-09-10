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
router.post('/goals/:id/submit', requireAuth, requireTenant, submitGoal);
router.post('/goals/:id/approve', requireAuth, requireTenant, managerApproveGoal);
router.post('/goals/:id/reject', requireAuth, requireTenant, managerRejectGoal);
router.post('/goals/:id/hr-approve', requireAuth, requireTenant, hrApproveGoal);
router.post('/goals/:id/hr-reject', requireAuth, requireTenant, hrRejectGoal);
router.post('/goals/:id/resubmit', requireAuth, requireTenant, resubmitGoal);

// ── Goal Activity & Audit ──────────────────────────────────────────────────
// (comments + audit routes live in activity.routes.js — they used to be
//  duplicated here pointing at the same handlers.)

export default router;
