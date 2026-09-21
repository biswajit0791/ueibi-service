import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenantScope.js';
import {
  listGalleryPosts,
  createGalleryPost,
  updateGalleryPost,
  deleteGalleryPost,
  toggleGalleryLike,
  getGalleryComments,
  addGalleryComment,
  deleteGalleryComment,
  updateGalleryComment,
  getGalleryCategories,
} from '../controllers/gallery.controller.js';

const router = Router();

// Corporate Gallery local storage directory: uploads/corporate-gallery
const uploadsBaseDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
const corporateGalleryDir = path.join(uploadsBaseDir, 'corporate-gallery');
if (!fs.existsSync(corporateGalleryDir)) {
  fs.mkdirSync(corporateGalleryDir, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, corporateGalleryDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.jpg';
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `gallery-${uniqueSuffix}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!file.mimetype.startsWith('image/') || !ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('Only valid image files (JPEG, PNG, GIF, WEBP, SVG) are allowed'));
    }
    cb(null, true);
  },
});

// Middleware to gracefully handle multer errors (e.g. invalid type, file size limit)
function handleGalleryUpload(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size exceeds 10MB limit' });
        }
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message || 'Invalid image upload' });
    }
    next();
  });
}

// Gallery post routes
router.get('/gallery/categories', requireAuth, requireTenant, getGalleryCategories);
router.get('/gallery/posts', requireAuth, requireTenant, listGalleryPosts);
router.post('/gallery/posts', requireAuth, requireTenant, handleGalleryUpload, createGalleryPost);
router.put('/gallery/posts/:id', requireAuth, requireTenant, handleGalleryUpload, updateGalleryPost);
router.patch('/gallery/posts/:id', requireAuth, requireTenant, handleGalleryUpload, updateGalleryPost);
router.delete('/gallery/posts/:id', requireAuth, requireTenant, deleteGalleryPost);

// Like routes
router.post('/gallery/posts/:id/like', requireAuth, requireTenant, toggleGalleryLike);

// Comment routes
router.get('/gallery/posts/:id/comments', requireAuth, requireTenant, getGalleryComments);
router.post('/gallery/posts/:id/comments', requireAuth, requireTenant, addGalleryComment);
router.patch('/gallery/comments/:id', requireAuth, requireTenant, updateGalleryComment);
router.delete('/gallery/comments/:id', requireAuth, requireTenant, deleteGalleryComment);

export default router;
