import { Router } from 'express';
import { listNotifications } from '../controllers/dev.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner } from '../middleware/rbac.js';

const router = Router();

// Platform-level debug view, moved off the retired shared-password gate.
router.get('/dev/notifications', requireAuth, requirePlatformOwner, listNotifications);

export default router;

