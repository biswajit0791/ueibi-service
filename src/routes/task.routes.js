import { Router } from 'express';
import { createTask, listTasks, updateTaskStatus, updateTask, deleteTask } from '../controllers/task.controller.js';
import {
  listSubTasks, createSubTask, updateSubTask, deleteSubTask, reorderSubTasks, listBoardSubTasks,
} from '../controllers/subTask.controller.js';
import { getTeamWeightage, setTaskFinalWeight, getTeamWeightageSummary } from '../controllers/taskWeightage.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

router.post('/tasks', requireAuth, requireTenant, createTask);
router.get('/tasks', requireAuth, requireTenant, listTasks);
router.patch('/tasks/:id/status', requireAuth, requireTenant, updateTaskStatus);
router.patch('/tasks/:id', requireAuth, requireTenant, updateTask);
router.put('/tasks/:id', requireAuth, requireTenant, updateTask);
router.delete('/tasks/:id', requireAuth, requireTenant, deleteTask);

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

// ── Sub-tasks ──────────────────────────────────────────────────────────────
// A checklist under a task: what someone is working through, and when each
// piece was finished. Records only — a sub-task never changes the task's
// percentage or the goal's weight total.
// The sub-task board: every sub-task across the tasks the caller can see.
// Registered before '/tasks/:id/subtasks' is irrelevant — different path —
// but it shares that endpoint's visibility rule exactly.
router.get('/subtasks', requireAuth, requireTenant, listBoardSubTasks);
router.get('/tasks/:id/subtasks', requireAuth, requireTenant, listSubTasks);
router.post('/tasks/:id/subtasks', requireAuth, requireTenant, createSubTask);
router.patch('/tasks/:id/subtasks-order', requireAuth, requireTenant, reorderSubTasks);
router.patch('/tasks/:id/subtasks/:sid', requireAuth, requireTenant, updateSubTask);
router.delete('/tasks/:id/subtasks/:sid', requireAuth, requireTenant, deleteSubTask);

export default router;
