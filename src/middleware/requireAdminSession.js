import { ADMIN_COOKIE_NAME, parseCookies, verifyAdminSession } from '../lib/adminAuth.js';

export function requireAdminSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!verifyAdminSession(token)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}
