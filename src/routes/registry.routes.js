import { Router } from 'express';
import { searchRegistry } from '../controllers/registry.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

router.get('/registry/search', requireAuth, requireTenant, searchRegistry);

export default router;
