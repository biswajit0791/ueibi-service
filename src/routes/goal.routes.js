import { Router } from 'express';
import { createGoal, listGoals, deleteGoal, getAssignableUsers } from '../controllers/goal.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

router.get('/goals/assignable-users', requireAuth, requireTenant, getAssignableUsers);
router.post('/goals', requireAuth, requireTenant, createGoal);
router.get('/goals', requireAuth, requireTenant, listGoals);
router.delete('/goals/:id', requireAuth, requireTenant, deleteGoal);

export default router;
