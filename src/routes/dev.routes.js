import { Router } from 'express';
import { listNotifications } from '../controllers/dev.controller.js';
import { requireAdminSession } from '../middleware/requireAdminSession.js';

const router = Router();

router.get('/dev/notifications', requireAdminSession, listNotifications);

export default router;

