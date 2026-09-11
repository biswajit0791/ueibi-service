import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import {
  listGalleryPosts,
  createGalleryPost,
  deleteGalleryPost,
  toggleGalleryLike,
  getGalleryComments,
  addGalleryComment,
  deleteGalleryComment,
  getGalleryCategories,
} from '../controllers/gallery.controller.js';

const router = Router();

// Image upload config (reuse /uploads directory)
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `gallery-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// Gallery post routes
router.get('/gallery/categories', requireAuth, requireTenant, getGalleryCategories);
router.get('/gallery/posts', requireAuth, requireTenant, listGalleryPosts);
router.post('/gallery/posts', requireAuth, requireTenant, upload.single('image'), createGalleryPost);
router.delete('/gallery/posts/:id', requireAuth, requireTenant, deleteGalleryPost);

// Like routes
router.post('/gallery/posts/:id/like', requireAuth, requireTenant, toggleGalleryLike);

// Comment routes
router.get('/gallery/posts/:id/comments', requireAuth, requireTenant, getGalleryComments);
router.post('/gallery/posts/:id/comments', requireAuth, requireTenant, addGalleryComment);
router.delete('/gallery/comments/:id', requireAuth, requireTenant, deleteGalleryComment);

export default router;
