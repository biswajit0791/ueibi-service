import { env } from '../config/env.js';
import { ADMIN_COOKIE_NAME, signAdminSession, verifyAdminSession, parseCookies } from '../lib/adminAuth.js';

const cookieOptions = {
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: env.nodeEnv === 'production' ? 'none' : 'lax',
  maxAge: env.adminSessionTtlMs,
  path: '/',
};

export function login(req, res) {
  const { password } = req.body || {};
  if (password !== env.appPassword) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const expiry = Date.now() + env.adminSessionTtlMs;
  res.cookie(ADMIN_COOKIE_NAME, signAdminSession(expiry), cookieOptions);
  res.json({ authenticated: true });
}

export function verify(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const authenticated = verifyAdminSession(cookies[ADMIN_COOKIE_NAME]);
  if (!authenticated) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true });
}

export function logout(req, res) {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
}
