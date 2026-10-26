import { Router } from 'express';
import { createTask, listTasks, updateTaskStatus, updateTask, deleteTask } from '../controllers/task.controller.js';
import { getTeamWeightage, setTaskFinalWeight, getTeamWeightageSummary } from '../controllers/taskWeightage.controller.js';
import { rateGoalTask } from '../controllers/taskRating.controller.js';
import { submitTaskForReview, approveTaskReview, rejectTaskReview } from '../controllers/taskReview.controller.js';
import {
  listMilestones, createMilestone, updateMilestone, deleteMilestone, listOverdueMilestones, listMyAssignedMilestones,
  getMilestoneLiveStatusSvg,
} from '../controllers/taskMilestone.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

router.post('/tasks', requireAuth, requireTenant, createTask);
router.get('/tasks', requireAuth, requireTenant, listTasks);
router.patch('/tasks/:id/status', requireAuth, requireTenant, updateTaskStatus);
router.patch('/tasks/:id', requireAuth, requireTenant, updateTask);
router.put('/tasks/:id', requireAuth, requireTenant, updateTask);
router.patch('/tasks/:id/manager-rating', requireAuth, requireTenant, rateGoalTask);
router.delete('/tasks/:id', requireAuth, requireTenant, deleteTask);

// ── Per-task completion review ─────────────────────────────────────────────
// Assignee submits a finished goal task; the goal owner approves or sends it
// back. When every task on a goal is approved the goal completes by itself.
router.post('/tasks/:id/review/submit', requireAuth, requireTenant, submitTaskForReview);
router.post('/tasks/:id/review/approve', requireAuth, requireTenant, approveTaskReview);
router.post('/tasks/:id/review/reject', requireAuth, requireTenant, rejectTaskReview);

// ── Weightage ledger ───────────────────────────────────────────────────────
// What each task was planned to be worth, what completing it earned, whether
// it ran late, and the manager's final figure. Setting the final weightage
// writes ONLY to managerFinalWeight — never to Task.weight, so the goal's
// 100% rule and execution lock are untouched.
// Registered BEFORE '/team/:id/weightage' so the literal path is not
// swallowed by the :id parameter.
router.get('/team/weightage-summary', requireAuth, requireTenant, getTeamWeightageSummary);
router.get('/team/:id/weightage', requireAuth, requireTenant, getTeamWeightage);
router.patch('/tasks/:id/final-weight', requireAuth, requireTenant, setTaskFinalWeight);

// ── Critical-task Milestones ─────────────────────────────────────────────────
// Replaces the old sub-task checklist for critical work: up to 4 dated
// milestones, each with its own watcher list for delay escalation, and an
// employee-proposes / manager-approves date workflow.
// Registered before '/tasks/:id/milestones/:mid' is irrelevant — different
// path — but it shares that endpoint's visibility rule.
router.get('/milestones/overdue', requireAuth, requireTenant, listOverdueMilestones);
router.get('/milestones/assigned-to-me', requireAuth, requireTenant, listMyAssignedMilestones);
router.get('/tasks/:id/milestones', requireAuth, requireTenant, listMilestones);
router.post('/tasks/:id/milestones', requireAuth, requireTenant, createMilestone);
router.patch('/tasks/:id/milestones/:mid', requireAuth, requireTenant, updateMilestone);
router.delete('/tasks/:id/milestones/:mid', requireAuth, requireTenant, deleteMilestone);
// Public dynamic SVG live tracking badge (publicly accessible by email clients)
router.get('/tasks/:id/milestones/:mid/live-status.svg', getMilestoneLiveStatusSvg);

export default router;
