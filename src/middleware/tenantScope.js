import { isPlatformOwner } from '../lib/roles.js';

export function requireTenant(req, res, next) {
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Tenant context is missing from request' });
  }
  // The platform operator is not a member of any company, so company features
  // simply do not apply to them. Every tenant-scoped route already passes
  // through here, which makes this the one place to state that — rather than
  // relying on their tenant happening to be empty.
  //
  // Platform routes deliberately do NOT use requireTenant, and /auth/me is
  // guarded by requireAuth alone, so sign-in and session refresh are unaffected.
  if (isPlatformOwner(req.user?.role)) {
    return res.status(403).json({
      error: 'Access forbidden: the platform owner is not a member of any company',
    });
  }
  next();
}
