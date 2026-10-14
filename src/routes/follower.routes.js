import { Router } from 'express';
import { getFollowers, addFollower, removeFollower } from '../controllers/follower.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

router.get('/followers', requireAuth, requireTenant, getFollowers);
router.post('/followers', requireAuth, requireTenant, addFollower);
router.delete('/followers', requireAuth, requireTenant, removeFollower);

export default router;
