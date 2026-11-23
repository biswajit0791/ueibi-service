import { canViewDashboard } from '../lib/dashboardPermissions.js';
import { hasCapability } from '../lib/capabilities.js';
import { isPlatformOwner, isPlatformUser } from '../lib/roles.js';
import { hasPlatformMenuPermission } from '../services/platformPermissions.service.js';

/**
 * Platform-operator only. Deliberately NOT expressed as authorize('PLATFORM_OWNER',
 * 'SUPER_ADMIN', ...) — no company role may reach a platform endpoint, however
 * elevated it is inside its own tenant.
 */
export function requirePlatformOwner(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!isPlatformOwner(req.user.role)) {
    return res.status(403).json({ error: 'Access forbidden: platform owner authorization required' });
  }
  next();
}

/**
 * Individual Platform Owner Menu Access Control.
 * Root PLATFORM_OWNER always passes.
 * PLATFORM_SALES (Internal Team) passes only if the specific menuKey is enabled in their permissions.
 */
export function requirePlatformMenu(menuKey) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const role = String(req.user.role || '').toUpperCase();
    if (role === 'PLATFORM_OWNER') {
      return next();
    }
    if (!isPlatformUser(role)) {
      return res.status(403).json({ error: 'Access forbidden: platform staff authorization required' });
    }

    try {
      const allowed = await hasPlatformMenuPermission(req.user.id, role, menuKey);
      if (!allowed) {
        return res.status(403).json({
          error: `Access forbidden: you do not have permission to access ${menuKey}`,
          code: 'PLATFORM_PERMISSION_DENIED',
          menuKey,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Platform owner or platform Sales/BD. For the deal-making endpoints Sales
 * shares with the owner (viewing companies and coupons, starting/renewing a
 * subscription with a coupon, drafting an invoice). Everything else in the
 * console stays behind requirePlatformOwner.
 */
export function requirePlatformStaff(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!isPlatformUser(req.user.role)) {
    return res.status(403).json({ error: 'Access forbidden: platform staff authorization required' });
  }
  next();
}

export function authorize(...allowedRoles) {
  const flattened = allowedRoles.flat(Infinity).map(r => String(r || '').toUpperCase());
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userRole = String(req.user.role || '').toUpperCase();
    if (!flattened.includes(userRole)) {
      return res.status(403).json({ error: 'Access forbidden: insufficient permissions' });
    }
    next();
  };
}

export const requireRole = authorize;

/**
 * Role OR capability — strictly ADDITIVE.
 *
 * Everyone the role list already allowed still passes; holding one of the named
 * capabilities is an additional way in. Use this wherever a sub-login credential
 * should unlock an endpoint that was previously role-gated, so a recruiter can
 * do their job without being handed an admin role.
 *
 * @param {string[]} allowedRoles
 * @param {string[]} allowedCapabilities
 */
export function authorizeRoleOrCapability(allowedRoles, allowedCapabilities = []) {
  const roles = allowedRoles.flat(Infinity).map((r) => String(r || '').toUpperCase());
  const caps = allowedCapabilities.flat(Infinity);
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userRole = String(req.user.role || '').toUpperCase();
    if (roles.includes(userRole)) return next();
    if (caps.some((c) => hasCapability(req.user, c))) return next();

    return res.status(403).json({
      error: 'Access forbidden: insufficient permissions',
      requiredCapabilities: caps,
    });
  };
}

/**
 * Middleware enforcing the Dashboard Visibility Matrix.
 * Returns 403 Forbidden if the authenticated user's role is not permitted to view targetDashboard.
 * @param {string} targetDashboard - 'SUPER_ADMIN' | 'ADMIN' | 'HR' | 'FINANCE' | 'MANAGER' | 'EMPLOYEE'
 */
export function authorizeDashboard(targetDashboard) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userRole = String(req.user.role || '').toUpperCase();
    if (!canViewDashboard(userRole, targetDashboard)) {
      return res.status(403).json({
        error: `Access forbidden: role '${userRole}' is not authorized to access ${targetDashboard} dashboard`,
      });
    }
    next();
  };
}

