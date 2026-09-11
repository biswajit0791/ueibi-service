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

/** Elevated roles plus MANAGER — used where line managers also have write access. */
export const MANAGER_OR_ELEVATED_ROLES = [...ELEVATED_ROLES, 'MANAGER'];

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
