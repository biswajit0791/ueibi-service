import { Router } from 'express';
import messageController from '../controllers/message.controller.js';

const router = Router();

router.get('/messages', (req, res) => messageController.getMessages(req, res));
router.delete('/messages/clear', (req, res) => messageController.clearChat(req, res));
router.delete('/messages/:id/me', (req, res) => messageController.deleteForMe(req, res));
router.delete('/messages/:id/everyone', (req, res) => messageController.deleteForEveryone(req, res));

export default router;
