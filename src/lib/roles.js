/**
 * roles.js
 *
 * Single source of truth for role groupings used in authorization checks.
 *
 * Previously every controller hand-rolled its own array of "elevated" roles,
 * and many of those arrays referenced strings that are NOT in the Prisma
 * `UserRole` enum (LEADERSHIP, OWNER, DIRECTOR) — dead branches that silently
 * did nothing. These constants only contain real `UserRole` values.
 *
 * Real UserRole values: SUPER_ADMIN, ADMIN, CMD, HR, FINANCE, MANAGER,
 * EMPLOYEE, STUDENT, MENTOR
 */

/** Roles that can administer people-ops data org-wide within their tenant. */
export const ELEVATED_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR'];

/** Roles allowed to perform HR-style sign-off / final approval actions. */
export const HR_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CMD', 'HR'];

/**
 * Roles that are considered "super elevated" — HR cannot assign goals to these
 * users. Only SUPER_ADMIN / ADMIN may do so.
 */
export const SUPER_ELEVATED_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CMD'];

/** Elevated roles plus MANAGER — used where line managers also have write access. */
export const MANAGER_OR_ELEVATED_ROLES = [...ELEVATED_ROLES, 'MANAGER'];

/**
 * Platform-level roles: the operator of the product, not a member of any
 * customer company.
 *
 * PLATFORM_OWNER is deliberately absent from every group above. It is NOT a
 * higher SUPER_ADMIN — it holds no company-level permission at all, cannot
 * approve a goal, read an employee record or open a tenant's data. SUPER_ADMIN
 * remains the top of the hierarchy inside a company. Adding PLATFORM_OWNER to
 * ELEVATED_ROLES would silently grant it HR powers in whichever tenant row it
 * happens to live in, which is exactly what this separation avoids.
 */
export const PLATFORM_ROLES = ['PLATFORM_OWNER'];

/** True for the platform operator — see PLATFORM_ROLES. */
export function isPlatformOwner(role) {
  return hasRole(role, PLATFORM_ROLES);
}

/**
 * Normalise a role string and test membership against one of the groups above.
 * @param {string|undefined|null} role
 * @param {string[]} group
 */
export function hasRole(role, group) {
  return group.includes(String(role || '').toUpperCase());
}

export function isElevated(role) {
  return hasRole(role, ELEVATED_ROLES);
}

export {
  DASHBOARD_VISIBILITY,
  DASHBOARD_ALLOWED_ROLES,
  getVisibleDashboards,
  canViewDashboard,
} from './dashboardPermissions.js';
