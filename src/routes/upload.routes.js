import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { requireAuth } from '../middleware/auth.js';
import { DISALLOWED_EXTENSIONS } from '../services/storage/storage.service.js';

const router = Router();

// Ensure uploads folder exists
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer disk storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique name: timestamp-rand-originalName
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// This endpoint is a general-purpose document/image upload used by employee
// docs, hub profile snaps, leave/policy attachments, etc. — so unlike the
// gallery upload it can't be narrowed to an image-only allowlist without
// breaking those flows. Reuses the same executable/script denylist already
// enforced for entity attachments (storageService.validateFile), which was
// previously never applied here at all.
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (DISALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`Executable or script file type "${ext}" is not permitted for upload`));
    }
    cb(null, true);
  },
});

router.post('/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds 5MB limit' });
      }
      return res.status(400).json({ error: err.message || 'Invalid file upload' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Return the filename to be stored in the docs array
    res.json({
      message: 'File uploaded successfully',
      fileName: req.file.filename,
      originalName: req.file.originalname,
      path: `/uploads/${req.file.filename}`
    });
  });
});

export default router;
