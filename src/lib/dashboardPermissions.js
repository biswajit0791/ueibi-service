/**
 * dashboardPermissions.js
 *
 * Centralized source of truth for role hierarchy and dashboard visibility.
 * Enforces the authoritative Dashboard Visibility Matrix:
 *
 * Role          Can View
 * SUPER_ADMIN   SUPER_ADMIN, ADMIN, HR, FINANCE, MANAGER, EMPLOYEE
 * ADMIN         ADMIN, HR, FINANCE, MANAGER, EMPLOYEE (NOT SUPER_ADMIN)
 * HR            HR, FINANCE, MANAGER, EMPLOYEE (NOT ADMIN, NOT SUPER_ADMIN)
 * FINANCE       FINANCE, MANAGER, EMPLOYEE (NOT HR, NOT ADMIN, NOT SUPER_ADMIN)
 * MANAGER       MANAGER, EMPLOYEE (NOT HR, NOT FINANCE, NOT ADMIN, NOT SUPER_ADMIN)
 * EMPLOYEE      EMPLOYEE ONLY
 */

export const DASHBOARD_VISIBILITY = {
  SUPER_ADMIN: [
    'SUPER_ADMIN',
    'ADMIN',
    'HR',
    'FINANCE',
    'MANAGER',
    'EMPLOYEE',
  ],
  ADMIN: [
    'ADMIN',
    'HR',
    'FINANCE',
    'MANAGER',
    'EMPLOYEE',
  ],
  HR: [
    'HR',
    'FINANCE',
    'MANAGER',
    'EMPLOYEE',
  ],
  FINANCE: [
    'FINANCE',
    'MANAGER',
    'EMPLOYEE',
  ],
  MANAGER: [
    'MANAGER',
    'EMPLOYEE',
  ],
  EMPLOYEE: [
    'EMPLOYEE',
  ],
};

/**
 * Inverted mapping: which roles have permission to view a specific target dashboard.
 */
export const DASHBOARD_ALLOWED_ROLES = {
  SUPER_ADMIN: ['SUPER_ADMIN'],
  ADMIN: ['SUPER_ADMIN', 'ADMIN'],
  HR: ['SUPER_ADMIN', 'ADMIN', 'HR'],
  FINANCE: ['SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE'],
  MANAGER: ['SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE', 'MANAGER'],
  EMPLOYEE: ['SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE'],
};

/**
 * Normalizes role aliases to canonical dashboard role keys.
 * @param {string|undefined|null} role
 * @returns {string}
 */
export function normalizeRole(role) {
  const r = String(role || 'EMPLOYEE').toUpperCase();
  if (r === 'CMD' || r === 'DIRECTOR' || r === 'LEADERSHIP' || r === 'OWNER') return 'SUPER_ADMIN';
  if (r === 'STUDENT' || r === 'MENTOR') return 'EMPLOYEE';
  return r;
}

/**
 * Returns the list of dashboard keys that the given role is allowed to view.
 * @param {string|undefined|null} role
 * @returns {string[]}
 */
export function getVisibleDashboards(role) {
  const normalized = normalizeRole(role);
  return DASHBOARD_VISIBILITY[normalized] || ['EMPLOYEE'];
}

/**
 * Checks whether a given role can view the target dashboard or target user's board.
 * @param {string|undefined|null} role - The caller's role (e.g., 'HR')
 * @param {string} targetDashboard - The dashboard being accessed (e.g., 'ADMIN')
 * @returns {boolean}
 */
export function canViewDashboard(role, targetDashboard) {
  const caller = normalizeRole(role);
  const target = normalizeRole(targetDashboard);
  const visible = DASHBOARD_VISIBILITY[caller] || ['EMPLOYEE'];
  return visible.includes(target);
}

