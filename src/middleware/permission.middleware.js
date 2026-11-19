import { checkUserPermission, getEffectiveUserPermissions } from '../services/permission.service.js';

/**
 * Middleware: requirePermission
 * Validates authenticated user, active status, role ceiling, individual effective permission,
 * and data-level access scope.
 *
 * @param {string} permissionKey - e.g. 'employee.records.view', 'leave.request.approve'
 * @param {object} options - { resolveTarget: (req) => ({ targetUserId, targetDepartment }) }
 */
export function requirePermission(permissionKey, options = {}) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const tenantId = req.user.tenantId;
      const userId = req.user.userId || req.user.id;

      if (!tenantId || !userId) {
        return res.status(403).json({ error: 'Access forbidden: missing tenant or user context' });
      }

      // Resolve data context if provided
      let context = {};
      if (typeof options.resolveTarget === 'function') {
        try {
          context = options.resolveTarget(req) || {};
        } catch (targetErr) {
          console.warn('[requirePermission] Error resolving data context target:', targetErr.message);
        }
      } else {
        // Default target inference from params
        const targetUserId = req.params.employeeId || req.params.userId || req.body.employeeId || req.body.userId;
        const targetDepartment = req.params.department || req.body.department;
        if (targetUserId) context.targetUserId = targetUserId;
        if (targetDepartment) context.targetDepartment = targetDepartment;
      }

      const check = await checkUserPermission(tenantId, userId, permissionKey, context);

      if (!check.allowed) {
        return res.status(403).json({
          error: 'Access forbidden: insufficient permissions',
          permissionKey,
          reason: check.reason || 'You do not have the required permission or data scope for this action',
        });
      }

      next();
    } catch (err) {
      console.error('[requirePermission] Middleware error:', err);
      return res.status(500).json({ error: 'Internal server authorization error' });
    }
  };
}

/**
 * Express middleware to attach current user's effective permissions to req.effectivePermissions
 */
export async function attachUserPermissions(req, res, next) {
  if (req.user && req.user.tenantId && (req.user.userId || req.user.id)) {
    try {
      const data = await getEffectiveUserPermissions(req.user.tenantId, req.user.userId || req.user.id);
      req.userPermissions = data.effectivePermissions;
      req.userDataScope = data.dataScope;
    } catch (err) {
      // Non-fatal, continue
    }
  }
  next();
}
