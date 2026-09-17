import { Router } from 'express';
import messageController from '../controllers/message.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

// Chat is authenticated and tenant-scoped end to end. `requireAuth` resolves the
// caller against the DB on every request, so a de-provisioned account cannot
// keep reading conversations with a still-valid JWT.
router.use('/messages', requireAuth, requireTenant);

router.get('/messages', (req, res) => messageController.getMessages(req, res));
router.post('/messages', (req, res) => messageController.sendMessage(req, res));
router.get('/messages/conversations', (req, res) => messageController.getConversations(req, res));
router.get('/messages/unread', (req, res) => messageController.getUnreadCounts(req, res));
router.post('/messages/read', (req, res) => messageController.markRead(req, res));
router.delete('/messages/clear', (req, res) => messageController.clearConversation(req, res));
router.delete('/messages/:id/me', (req, res) => messageController.deleteForMe(req, res));
router.delete('/messages/:id/everyone', (req, res) => messageController.deleteForEveryone(req, res));

export default router;
