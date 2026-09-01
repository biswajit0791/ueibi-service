import { verifyToken } from '../lib/jwt.js';
import { parseCookies } from '../lib/adminAuth.js';

export function requireAuth(req, res, next) {
  let token = null;

  // Check Authorization Header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // Check Cookie Header
  if (!token && req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies['ueibi_session'];
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }

  req.user = {
    id: decoded.userId,
    email: decoded.email,
    role: decoded.role,
    name: decoded.name,
    tenantId: decoded.tenantId,
  };
  req.tenantId = decoded.tenantId;

  next();
}

