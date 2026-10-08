/**
 * @file publicFiles.js
 * @description Turning stored upload paths into things that work outside the
 * web app: absolute URLs for emails, and local file paths for attachments.
 *
 * Upload paths are stored relative ("/uploads/certificates/x.pdf",
 * "/uploads/123.jpg", sometimes "/api/uploads/..." or a bare file name). In
 * the browser the frontend resolves them (resolveUploadUrl); an email has no
 * such context, so a relative href is unusable there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

const uploadsDir = path.resolve(process.env.UPLOAD_DIR || './uploads');

/** "/uploads/certificates/x.pdf" -> "certificates/x.pdf" (null if not an upload). */
function uploadRelativePath(stored) {
  if (!stored || typeof stored !== 'string') return null;
  let p = stored.trim().replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0];
  p = p.replace(/^\/+/, '');
  if (p.startsWith('api/uploads/')) p = p.slice('api/uploads/'.length);
  else if (p.startsWith('uploads/')) p = p.slice('uploads/'.length);
  return p || null;
}

/**
 * Absolute URL for an uploaded file, served through /api/uploads like the
 * frontend does (the public domain routes /api/* to this server).
 * With `download`, the server sends it as an attachment named `filename`.
 */
export function publicUploadUrl(stored, { download = false, filename } = {}) {
  if (!stored) return null;
  // Already absolute on a real host — leave it alone.
  if (/^https?:\/\//i.test(stored) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(stored)) return stored;
  const rel = uploadRelativePath(stored);
  if (!rel) return null;
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  const url = `${env.backendUrl}/api/uploads/${encoded}`;
  if (!download) return url;
  const name = filename || path.basename(rel);
  return `${url}?download=1&filename=${encodeURIComponent(name)}`;
}

/**
 * Local path of an uploaded file, only if it exists inside the uploads
 * directory (no traversal outside it).
 */
export function localUploadPath(stored) {
  const rel = uploadRelativePath(stored);
  if (!rel) return null;
  const full = path.resolve(uploadsDir, rel);
  if (!full.startsWith(uploadsDir + path.sep)) return null;
  try {
    return fs.statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

/**
 * Email attachments for the given files, skipping any that are missing on
 * disk and stopping before the total passes `maxBytes` (links still cover
 * whatever is not attached).
 * @param {{ url: string, filename: string }[]} files
 */
export function buildAttachments(files, maxBytes = 15 * 1024 * 1024) {
  const attachments = [];
  let total = 0;
  for (const f of files) {
    const local = localUploadPath(f.url);
    if (!local) continue;
    const size = fs.statSync(local).size;
    if (total + size > maxBytes) continue;
    total += size;
    attachments.push({ filename: f.filename, path: local });
  }
  return attachments;
}
