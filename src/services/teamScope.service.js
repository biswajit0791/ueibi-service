/**
 * Extracted from appraisal.controller.js's getDirectReports — the tenant-user
 * `where` clause deciding which employees a given user is allowed to see in a
 * "my team" listing. Elevated roles (HR/Admin/Super Admin/CMD) see everyone;
 * a manager sees their explicit reports, or (if they have none assigned) a
 * broad same-tenant fallback.
 *
 * Preserves the exact pre-existing behavior, including that `req.user`
 * (as built by requireAuth) never carries `department`, so the
 * `req.user.department` fallback condition below is always falsy — a known,
 * separate, out-of-scope issue, not something this extraction changes.
 */
import { ELEVATED_ROLES, hasRole } from '../lib/roles.js';

export function buildTeamScopeWhere(user, tenantId, { search, department, includeSelf = false } = {}) {
  const userRole = (user.role || '').toUpperCase();
  const isHrOrAdmin = hasRole(userRole, ELEVATED_ROLES);

  let where;
  if (isHrOrAdmin) {
    where = {
      tenantId,
      isDeleted: false,
      status: { in: ['ACTIVE', 'INVITED'] },
      ...(includeSelf ? {} : { id: { not: user.id } }),
    };
  } else {
    where = {
      tenantId,
      isDeleted: false,
      status: { in: ['ACTIVE', 'INVITED'] },
      ...(includeSelf ? {} : { id: { not: user.id } }),
      OR: [
        { managerId: user.id },
        { managerId: null },
        { role: { in: ['EMPLOYEE', 'STUDENT', 'MENTOR'] } },
        ...(user.department ? [{ department: user.department }] : []),
      ],
    };
  }

  if (department) {
    where.department = { equals: department, mode: 'insensitive' };
  }
  if (search && search.trim()) {
    const s = search.trim();
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { name: { contains: s, mode: 'insensitive' } },
          { email: { contains: s, mode: 'insensitive' } },
          { designation: { contains: s, mode: 'insensitive' } },
        ],
      },
    ];
  }

  return { where, isHrOrAdmin };
}

/**
 * The "explicit direct reports" shortcut getDirectReports uses before ever
 * falling back to buildTeamScopeWhere's broader heuristic — kept separate
 * since it has its own early-return semantics (only used for non-elevated
 * managers with real managerId-assigned reports).
 */
export function buildExplicitReportsWhere(user, tenantId, { search, department } = {}) {
  return {
    tenantId,
    managerId: user.id,
    isDeleted: false,
    status: { in: ['ACTIVE', 'INVITED'] },
    id: { not: user.id },
    ...(department ? { department: { equals: department, mode: 'insensitive' } } : {}),
    ...(search && search.trim() ? {
      OR: [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { email: { contains: search.trim(), mode: 'insensitive' } },
        { designation: { contains: search.trim(), mode: 'insensitive' } },
      ],
    } : {}),
  };
}
