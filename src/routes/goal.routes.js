import { Router } from 'express';
import { createGoal, listGoals, deleteGoal } from '../controllers/goal.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

router.post('/goals', requireAuth, requireTenant, createGoal);
router.get('/goals', requireAuth, requireTenant, listGoals);
router.delete('/goals/:id', requireAuth, requireTenant, deleteGoal);

export default router;
