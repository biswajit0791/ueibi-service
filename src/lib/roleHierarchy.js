/**
 * roleHierarchy.js
 *
 * Single source of truth for role-creation permissions.
 *
 * Hierarchy (top → bottom):
 *   SUPER_ADMIN → ADMIN → HR → MANAGER → EMPLOYEE
 *
 * Rules:
 *  - SUPER_ADMIN  can create any role.
 *  - ADMIN        can create HR, MANAGER, EMPLOYEE.
 *  - HR           can create MANAGER, EMPLOYEE.
 *  - MANAGER      can create EMPLOYEE only.
 *  - EMPLOYEE     cannot create any user.
 *
 * Extra roles in the system (CMD, FINANCE, STUDENT, MENTOR) are only
 * creatable by SUPER_ADMIN; they are excluded from the normal hierarchy.
 */

/**
 * Map of creator role → array of roles it is permitted to assign.
 * This is the authoritative list — backend enforces it, frontend mirrors it.
 */
export const ROLE_CREATION_MAP = {
  SUPER_ADMIN: [
    'SUPER_ADMIN',
    'ADMIN',
    'CMD',
    'HR',
    'FINANCE',
    'MANAGER',
    'EMPLOYEE',
    'STUDENT',
    'MENTOR',
  ],
  ADMIN: ['HR', 'MANAGER', 'EMPLOYEE'],
  HR: ['MANAGER', 'EMPLOYEE'],
  MANAGER: ['EMPLOYEE'],
  EMPLOYEE: [],
  // Non-hierarchy roles get no creation rights by default
  CMD: [],
  FINANCE: [],
  STUDENT: [],
  MENTOR: [],
};

/**
 * Returns true when `creatorRole` is permitted to assign `targetRole`.
 *
 * @param {string} creatorRole - Role of the authenticated user making the request.
 * @param {string} targetRole  - Role being assigned to the new user.
 * @returns {boolean}
 */
export function canCreateRole(creatorRole, targetRole) {
  const allowed = ROLE_CREATION_MAP[creatorRole];
  if (!allowed) return false;
  return allowed.includes(targetRole);
}

/**
 * Returns the list of roles that `creatorRole` is permitted to assign.
 * Useful for building dynamic dropdowns on the frontend.
 *
 * @param {string} creatorRole
 * @returns {string[]}
 */
export function getAllowedRoles(creatorRole) {
  return ROLE_CREATION_MAP[creatorRole] ?? [];
}
