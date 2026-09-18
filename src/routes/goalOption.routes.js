import { Router } from 'express';
import {
  listGoalOptions,
  createGoalOption,
  updateGoalOption,
  archiveGoalOption,
} from '../controllers/goalOption.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import { authorize } from '../middleware/rbac.js';

const router = Router();

// Read: every authenticated role. The goal form needs these lists, and any
// employee can create a goal for themselves.
router.get('/goal-options', requireAuth, requireTenant, listGoalOptions);

// Write: same set as Departments and Blood Groups.
const MANAGE = authorize('SUPER_ADMIN', 'ADMIN', 'HR');
router.post('/goal-options', requireAuth, requireTenant, MANAGE, createGoalOption);
router.patch('/goal-options/:id', requireAuth, requireTenant, MANAGE, updateGoalOption);
router.delete('/goal-options/:id', requireAuth, requireTenant, MANAGE, archiveGoalOption);

export default router;
