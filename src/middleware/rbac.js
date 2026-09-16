import { canViewDashboard } from '../lib/dashboardPermissions.js';

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

