import { Router } from 'express';
import multer from 'multer';
import {
  listDisputes,
  createDispute,
  getDisputeDetail,
  updateDispute,
  createDisputeMessage,
  uploadDisputeAttachment,
  downloadDisputeAttachment,
} from '../controllers/dispute.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — enforced again inside storageService.validateFile
});

router.get('/disputes', requireAuth, requireTenant, listDisputes);
router.post('/disputes', requireAuth, requireTenant, upload.single('file'), createDispute);
router.get('/disputes/:id', requireAuth, requireTenant, getDisputeDetail);
router.patch('/disputes/:id', requireAuth, requireTenant, updateDispute);

router.post('/disputes/:id/messages', requireAuth, requireTenant, createDisputeMessage);

router.post('/disputes/:id/attachment', requireAuth, requireTenant, upload.single('file'), uploadDisputeAttachment);
router.get('/disputes/:id/attachment/:attachmentId', requireAuth, requireTenant, downloadDisputeAttachment);

export default router;
