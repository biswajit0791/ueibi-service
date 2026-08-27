import { Router } from 'express';
import { listNotifications } from '../controllers/dev.controller.js';

const router = Router();

router.get('/dev/notifications', listNotifications);

export default router;
