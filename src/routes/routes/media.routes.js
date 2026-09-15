import { Router } from 'express';
import mediaController from '../controllers/media.controller.js';
import { uploadMiddleware } from '../middleware/upload.js';
import { uploadRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post(
  '/media/upload',
  uploadRateLimiter,
  uploadMiddleware.single('file'),
  (req, res) => mediaController.uploadFile(req, res),
);

export default router;
