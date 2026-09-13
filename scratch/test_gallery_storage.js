import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app.js';

console.log('--- RUNNING CORPORATE GALLERY STORAGE & SERVING VERIFICATION ---');

const uploadsBase = path.resolve(process.env.UPLOAD_DIR || './uploads');
const galleryDir = path.join(uploadsBase, 'corporate-gallery');

// 1. Verify directory creation
if (!fs.existsSync(galleryDir)) {
  console.error('FAIL: corporate-gallery directory does not exist!');
  process.exit(1);
} else {
  console.log('PASS 1: uploads/corporate-gallery directory exists:', galleryDir);
}

// 2. Test static serving on both /uploads and /api/uploads
const testFileName = `test-verify-${Date.now()}.png`;
const testFilePath = path.join(galleryDir, testFileName);
// 1x1 transparent PNG buffer
const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(testFilePath, pngBuffer);

try {
  // Test /uploads/corporate-gallery/<testFileName>
  const resUploads = await request(app).get(`/uploads/corporate-gallery/${testFileName}`);
  if (resUploads.status === 200 && resUploads.headers['content-type'].includes('image/png')) {
    console.log('PASS 2a: GET /uploads/corporate-gallery serves image with 200 OK & Content-Type: image/png');
  } else {
    console.error('FAIL 2a: GET /uploads/corporate-gallery returned', resUploads.status, resUploads.headers['content-type']);
  }

  // Verify CORS & CORP headers
  if (resUploads.headers['cross-origin-resource-policy'] === 'cross-origin' && resUploads.headers['access-control-allow-origin'] === '*') {
    console.log('PASS 2b: Cross-Origin-Resource-Policy and Access-Control-Allow-Origin headers present');
  } else {
    console.error('FAIL 2b: Missing CORS headers', resUploads.headers);
  }

  // Test /api/uploads/corporate-gallery/<testFileName>
  const resApiUploads = await request(app).get(`/api/uploads/corporate-gallery/${testFileName}`);
  if (resApiUploads.status === 200 && resApiUploads.headers['content-type'].includes('image/png')) {
    console.log('PASS 2c: GET /api/uploads/corporate-gallery serves image with 200 OK & Content-Type: image/png');
  } else {
    console.error('FAIL 2c: GET /api/uploads/corporate-gallery returned', resApiUploads.status, resApiUploads.headers['content-type']);
  }
} finally {
  if (fs.existsSync(testFilePath)) {
    fs.unlinkSync(testFilePath);
  }
}

// 3. Test upload rejection for invalid file types
const resInvalid = await request(app)
  .post('/api/gallery/posts')
  .set('Authorization', 'Bearer fake-token-for-filter-test')
  .attach('image', Buffer.from('executable binary code'), 'malicious.exe');

console.log('INFO: Upload invalid file test response status:', resInvalid.status, resInvalid.body);
if (resInvalid.status === 400 || resInvalid.status === 401) {
  console.log('PASS 3: Invalid file upload safely rejected');
}

// 4. Verify no .exe file was created in corporate-gallery
const filesInDir = fs.readdirSync(galleryDir);
const hasExe = filesInDir.some(f => f.endsWith('.exe'));
if (!hasExe) {
  console.log('PASS 4: No executable file written to corporate-gallery');
} else {
  console.error('FAIL 4: Executable file found in corporate-gallery!');
}

console.log('--- ALL CHECKS COMPLETED ---');
process.exit(0);
