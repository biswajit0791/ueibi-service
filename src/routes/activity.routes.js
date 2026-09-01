import { Router } from 'express';
import multer from 'multer';
import {
  addTaskComment,
  listTaskComments,
  listTaskAudit,
  deleteTaskComment,
  getTaskCommentAttachment,
  deleteTaskCommentAttachment,
} from '../controllers/taskActivity.controller.js';
import {
  addGoalComment,
  listGoalComments,
  listGoalAudit,
  deleteGoalComment,
} from '../controllers/goalActivity.controller.js';
import {
  listNotifications,
  markRead,
  markAllRead,
  deleteNotification,
} from '../controllers/notification.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const router = Router();

// ── Task Comments & Audit ────────────────────────────────────────────────────
router.post('/tasks/:id/comments', requireAuth, requireTenant, upload.single('file'), addTaskComment);
router.get('/tasks/:id/comments', requireAuth, requireTenant, listTaskComments);
router.get('/tasks/:id/comments/:cid/attachments/:aid', requireAuth, requireTenant, getTaskCommentAttachment);
router.delete('/tasks/:id/comments/:cid/attachments/:aid', requireAuth, requireTenant, deleteTaskCommentAttachment);
router.get('/tasks/:id/audit', requireAuth, requireTenant, listTaskAudit);
router.delete('/tasks/:id/comments/:cid', requireAuth, requireTenant, deleteTaskComment);

// ── Goal Comments & Audit ────────────────────────────────────────────────────
router.post('/goals/:id/comments', requireAuth, requireTenant, addGoalComment);
router.get('/goals/:id/comments', requireAuth, requireTenant, listGoalComments);
router.get('/goals/:id/audit', requireAuth, requireTenant, listGoalAudit);
router.delete('/goals/:id/comments/:cid', requireAuth, requireTenant, deleteGoalComment);

// ── Notifications ────────────────────────────────────────────────────────────
router.get('/notifications', requireAuth, requireTenant, listNotifications);
router.patch('/notifications/read-all', requireAuth, requireTenant, markAllRead);
router.patch('/notifications/:id/read', requireAuth, requireTenant, markRead);
router.delete('/notifications/:id', requireAuth, requireTenant, deleteNotification);

export default router;
