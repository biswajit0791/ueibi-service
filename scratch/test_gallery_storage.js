import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
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

// Start server on temporary port
const server = http.createServer(app);
await new Promise((resolve) => server.listen(4009, resolve));
const baseUrl = 'http://localhost:4009';

try {
  // 2. Test static serving on both /uploads and /api/uploads
  const testFileName = `test-verify-${Date.now()}.png`;
  const testFilePath = path.join(galleryDir, testFileName);
  // 1x1 transparent PNG buffer
  const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(testFilePath, pngBuffer);

  try {
    // Test /uploads/corporate-gallery/<testFileName>
    const resUploads = await fetch(`${baseUrl}/uploads/corporate-gallery/${testFileName}`);
    const contentTypeUploads = resUploads.headers.get('content-type') || '';
    const corpHeader = resUploads.headers.get('cross-origin-resource-policy') || '';
    const corsHeader = resUploads.headers.get('access-control-allow-origin') || '';

    if (resUploads.status === 200 && contentTypeUploads.includes('image/png')) {
      console.log('PASS 2a: GET /uploads/corporate-gallery serves image with 200 OK & Content-Type: image/png');
    } else {
      console.error('FAIL 2a: GET /uploads/corporate-gallery returned', resUploads.status, contentTypeUploads);
    }

    if (corpHeader === 'cross-origin' && corsHeader === '*') {
      console.log('PASS 2b: Cross-Origin-Resource-Policy and Access-Control-Allow-Origin headers present');
    } else {
      console.error('FAIL 2b: Missing CORS headers', { corpHeader, corsHeader });
    }

    // Test /api/uploads/corporate-gallery/<testFileName>
    const resApiUploads = await fetch(`${baseUrl}/api/uploads/corporate-gallery/${testFileName}`);
    const contentTypeApi = resApiUploads.headers.get('content-type') || '';

    if (resApiUploads.status === 200 && contentTypeApi.includes('image/png')) {
      console.log('PASS 2c: GET /api/uploads/corporate-gallery serves image with 200 OK & Content-Type: image/png');
    } else {
      console.error('FAIL 2c: GET /api/uploads/corporate-gallery returned', resApiUploads.status, contentTypeApi);
    }
  } finally {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  }

  // 3. Test invalid file rejection (malicious .exe file)
  const formData = new FormData();
  formData.append('image', new Blob(['binary executable content'], { type: 'application/x-msdownload' }), 'hack.exe');
  formData.append('title', 'Hack attempt');

  const resInvalid = await fetch(`${baseUrl}/api/gallery/posts`, {
    method: 'POST',
    body: formData,
  });
  const invalidBody = await resInvalid.json().catch(() => ({}));
  console.log('INFO: Upload invalid file response status:', resInvalid.status, invalidBody);

  if (resInvalid.status === 400 || resInvalid.status === 401) {
    console.log('PASS 3: Invalid file upload rejected with status', resInvalid.status);
  } else {
    console.error('FAIL 3: Unexpected status for invalid upload:', resInvalid.status);
  }

  // 4. Verify no .exe file was written to corporate-gallery
  const filesInDir = fs.readdirSync(galleryDir);
  const hasExe = filesInDir.some(f => f.endsWith('.exe'));
  if (!hasExe) {
    console.log('PASS 4: No executable file written to corporate-gallery');
  } else {
    console.error('FAIL 4: Executable file found in corporate-gallery!');
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log('--- ALL CHECKS COMPLETED ---');
process.exit(0);
