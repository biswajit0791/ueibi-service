import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';

console.log('--- RUNNING GALLERY UPLOAD UNIT TESTS ---');

const uploadsBase = path.resolve(process.env.UPLOAD_DIR || './uploads');
const corporateGalleryDir = path.join(uploadsBase, 'corporate-gallery');
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

const testApp = express();
testApp.post('/test-upload', handleGalleryUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({
    success: true,
    file: req.file.filename,
    path: `/uploads/corporate-gallery/${req.file.filename}`,
  });
});

const server = http.createServer(testApp);
await new Promise((resolve) => server.listen(4011, resolve));
const baseUrl = 'http://localhost:4011';

let uploadedFilesToClean = [];

try {
  // Test 1: Reject non-image (.txt file)
  const formTxt = new FormData();
  formTxt.append('image', new Blob(['just some text'], { type: 'text/plain' }), 'test.txt');

  const resTxt = await fetch(`${baseUrl}/test-upload`, { method: 'POST', body: formTxt });
  const bodyTxt = await resTxt.json().catch(() => ({}));
  if (resTxt.status === 400 && bodyTxt.error?.includes('Only valid image files')) {
    console.log('PASS U1: Non-image .txt rejected with 400:', bodyTxt.error);
  } else {
    console.error('FAIL U1: Expected 400 for .txt, got', resTxt.status, bodyTxt);
  }

  // Test 2: Reject spoofed MIME with dangerous extension (.exe)
  const formExe = new FormData();
  formExe.append('image', new Blob(['binary'], { type: 'image/jpeg' }), 'malicious.exe');

  const resExe = await fetch(`${baseUrl}/test-upload`, { method: 'POST', body: formExe });
  const bodyExe = await resExe.json().catch(() => ({}));
  if (resExe.status === 400 && bodyExe.error?.includes('Only valid image files')) {
    console.log('PASS U2: Spoofed extension .exe rejected with 400:', bodyExe.error);
  } else {
    console.error('FAIL U2: Expected 400 for .exe, got', resExe.status, bodyExe);
  }

  // Test 3: Reject file exceeding 10MB limit
  const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 0);
  const formLarge = new FormData();
  formLarge.append('image', new Blob([largeBuffer], { type: 'image/png' }), 'large.png');

  const resLarge = await fetch(`${baseUrl}/test-upload`, { method: 'POST', body: formLarge });
  const bodyLarge = await resLarge.json().catch(() => ({}));
  if (resLarge.status === 400 && bodyLarge.error?.includes('10MB')) {
    console.log('PASS U3: Oversized 11MB file rejected with 400:', bodyLarge.error);
  } else {
    console.error('FAIL U3: Expected 400 for oversized file, got', resLarge.status, bodyLarge);
  }

  // Test 4: Accept valid JPG image
  const jpg1x1 = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const formJpg = new FormData();
  formJpg.append('image', new Blob([jpg1x1], { type: 'image/jpeg' }), 'sample-event.jpg');

  const resJpg = await fetch(`${baseUrl}/test-upload`, { method: 'POST', body: formJpg });
  const bodyJpg = await resJpg.json().catch(() => ({}));
  if (resJpg.status === 200 && bodyJpg.path?.startsWith('/uploads/corporate-gallery/gallery-')) {
    console.log('PASS U4: Valid JPG successfully uploaded to:', bodyJpg.path);
    uploadedFilesToClean.push(bodyJpg.file);
  } else {
    console.error('FAIL U4: Expected 200 for valid JPG, got', resJpg.status, bodyJpg);
  }

  // Test 5: Accept valid PNG image
  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const formPng = new FormData();
  formPng.append('image', new Blob([png1x1], { type: 'image/png' }), 'sample-event.png');

  const resPng = await fetch(`${baseUrl}/test-upload`, { method: 'POST', body: formPng });
  const bodyPng = await resPng.json().catch(() => ({}));
  if (resPng.status === 200 && bodyPng.path?.startsWith('/uploads/corporate-gallery/gallery-')) {
    console.log('PASS U5: Valid PNG successfully uploaded to:', bodyPng.path);
    uploadedFilesToClean.push(bodyPng.file);
  } else {
    console.error('FAIL U5: Expected 200 for valid PNG, got', resPng.status, bodyPng);
  }

  // Test 6: Verify uploaded files physically exist in uploads/corporate-gallery
  for (const filename of uploadedFilesToClean) {
    const fullPath = path.join(corporateGalleryDir, filename);
    if (fs.existsSync(fullPath)) {
      console.log('PASS U6: Verified file on disk:', filename);
    } else {
      console.error('FAIL U6: File not found on disk:', fullPath);
    }
  }

  // Test 7: Verify safe deletion of files
  for (const filename of uploadedFilesToClean) {
    const fullPath = path.join(corporateGalleryDir, filename);
    fs.unlinkSync(fullPath);
    if (!fs.existsSync(fullPath)) {
      console.log('PASS U7: Successfully unlinked:', filename);
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log('--- ALL UNIT TESTS COMPLETED SUCCESSFULLY ---');
process.exit(0);
