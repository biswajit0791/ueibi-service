import { verifyToken } from '../lib/jwt.js';
import { parseCookies } from '../lib/adminAuth.js';
import { prisma } from '../lib/prisma.js';

export async function requireAuth(req, res, next) {
  try {
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

    // Re-check the user against the DB on every request so that de-provisioned
    // accounts (soft-deleted, EXITED, or role-changed) cannot keep using a
    // still-valid JWT. Values from the DB win over the token payload.
    const user = await prisma.tenantUser.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, role: true, name: true, tenantId: true, status: true, isDeleted: true },
    });

    if (!user || user.isDeleted) {
      return res.status(401).json({ error: 'Account is no longer active' });
    }
    if (user.status === 'EXITED') {
      return res.status(403).json({ error: 'Access forbidden: this account is inactive/exited' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tenantId: user.tenantId,
    };
    req.tenantId = user.tenantId;

    next();
  } catch (err) {
    next(err);
  }
}

