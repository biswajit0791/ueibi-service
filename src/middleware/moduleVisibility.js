import { getCallerSidebarVisibility } from '../services/roleHierarchy.service.js';

/**
 * Middleware that checks dynamic sidebar module visibility for the caller's role.
 * If the module is explicitly disabled for the user's role in the tenant settings,
 * returns HTTP 403.
 *
 * SUPER_ADMIN is Root Authority and always bypasses module restrictions.
 *
 * @param {string} moduleKey - Key matching SIDEBAR_MENU_CATALOG (e.g. 'reports', 'employee_records', 'departments')
 */
export function checkModuleVisibility(moduleKey) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const role = String(user.role || '').toUpperCase();
      // SUPER_ADMIN is Root Authority and non-revocable
      if (role === 'SUPER_ADMIN') {
        return next();
      }

      const tenantId = req.tenantId || user.tenantId || req.tenant?.id;
      if (!tenantId) {
        return next();
      }

      const sidebarVis = await getCallerSidebarVisibility(tenantId, user);
      if (sidebarVis && sidebarVis[moduleKey] === false) {
        return res.status(403).json({
          error: `Access restricted: the '${moduleKey}' module has been disabled for your role by company administration.`,
          code: 'MODULE_VISIBILITY_RESTRICTED',
          module: moduleKey,
        });
      }

      return next();
    } catch (err) {
      console.error(`[MODULE_VISIBILITY] Error verifying access for module "${moduleKey}":`, err.message);
      return res.status(403).json({
        error: `Access verification failed for module '${moduleKey}'. Default deny applied.`,
        code: 'MODULE_VISIBILITY_CHECK_FAILED',
        module: moduleKey,
      });
    }
  };
}

