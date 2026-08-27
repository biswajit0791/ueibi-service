import crypto from 'node:crypto';
import { env } from '../config/env.js';

export const ADMIN_COOKIE_NAME = env.adminSessionCookieName;

export function signAdminSession(expiry) {
  const signature = crypto
    .createHmac('sha256', env.appPassword)
    .update(String(expiry))
    .digest('hex');
  return `${expiry}.${signature}`;
}

export function verifyAdminSession(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expiryStr, signature] = parts;
  const expiry = parseInt(expiryStr, 10);
  if (Number.isNaN(expiry) || expiry < Date.now()) return false;

  const expectedSignature = crypto
    .createHmac('sha256', env.appPassword)
    .update(expiryStr)
    .digest('hex');

  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSignature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
  });
  return list;
}
