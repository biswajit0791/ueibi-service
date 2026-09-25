import { Router } from 'express';
import { createTask, listTasks, updateTaskStatus, updateTask, deleteTask } from '../controllers/task.controller.js';
import {
  listSubTasks, createSubTask, updateSubTask, deleteSubTask, reorderSubTasks,
} from '../controllers/subTask.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

router.post('/tasks', requireAuth, requireTenant, createTask);
router.get('/tasks', requireAuth, requireTenant, listTasks);
router.patch('/tasks/:id/status', requireAuth, requireTenant, updateTaskStatus);
router.patch('/tasks/:id', requireAuth, requireTenant, updateTask);
router.put('/tasks/:id', requireAuth, requireTenant, updateTask);
router.delete('/tasks/:id', requireAuth, requireTenant, deleteTask);

// ── Sub-tasks ──────────────────────────────────────────────────────────────
// A checklist under a task: what someone is working through, and when each
// piece was finished. Records only — a sub-task never changes the task's
// percentage or the goal's weight total.
router.get('/tasks/:id/subtasks', requireAuth, requireTenant, listSubTasks);
router.post('/tasks/:id/subtasks', requireAuth, requireTenant, createSubTask);
router.patch('/tasks/:id/subtasks-order', requireAuth, requireTenant, reorderSubTasks);
router.patch('/tasks/:id/subtasks/:sid', requireAuth, requireTenant, updateSubTask);
router.delete('/tasks/:id/subtasks/:sid', requireAuth, requireTenant, deleteSubTask);

export default router;
