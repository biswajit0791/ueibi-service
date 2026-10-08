/**
 * @file exitClearance.service.js
 * @description Who must clear what when an employee exits.
 *
 * Each exit owns one ExitClearance row per required clearance, created when
 * the exit is initiated:
 *
 *   it         IT department head (alternate head may act)
 *   hr         any HR / Admin
 *   finance    any Finance user (or HR / Admin)
 *   manager    the exiting employee's reporting manager (or HR / Admin)
 *   dept_head  head of the employee's own department — only when that
 *              department exists in the master list and is not IT itself
 *
 * Approvers are resolved at read time, so assigning a department head later
 * applies to clearances that are still pending. HR / Admin may clear IT or a
 * department-head item in the head's place, but must record a reason.
 *
 * Exits that pre-date the rows are backfilled with exactly the four
 * clearances they were started with — no new requirement is added to an exit
 * already in flight.
 */
import { prisma } from '../lib/prisma.js';

export const CLEARANCE_LEADERSHIP_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

// Department names (case-insensitive) treated as the IT department.
const IT_DEPARTMENT_NAMES = ['it', 'information technology'];

// The four clearances that existed before rows did; each still mirrors into
// the ExitDetails boolean columns of the same prefix.
export const LEGACY_KEYS = ['it', 'hr', 'finance', 'manager'];

const BASE_CLEARANCES = [
  { key: 'it', label: 'IT Department', sortOrder: 0 },
  { key: 'hr', label: 'Human Resources', sortOrder: 1 },
  { key: 'finance', label: 'Finance & Accounts', sortOrder: 2 },
  { key: 'manager', label: 'Reporting Manager', sortOrder: 3 },
];

const lower = (s) => String(s || '').trim().toLowerCase();
const isItDepartment = (name) => IT_DEPARTMENT_NAMES.includes(lower(name));

function parseRemarks(raw) {
  try {
    const obj = JSON.parse(raw || '{}');
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

/**
 * Rows for a newly initiated exit. Call inside the transaction that creates
 * the ExitDetails row.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ id: string, tenantId: string }} exit
 * @param {{ department?: string|null }} employee
 */
export async function createInitialClearances(tx, exit, employee) {
  const departments = await tx.department.findMany({
    where: { tenantId: exit.tenantId, isActive: true },
    select: { name: true },
  });
  const itDept = departments.find((d) => isItDepartment(d.name));
  const ownDept = employee.department
    ? departments.find((d) => lower(d.name) === lower(employee.department))
    : null;

  const rows = BASE_CLEARANCES.map((c) => ({
    ...c,
    departmentName: c.key === 'it' ? (itDept?.name || 'IT') : null,
  }));
  // The IT head already signs off for IT staff; a second item would make the
  // same person approve twice.
  if (ownDept && !isItDepartment(ownDept.name)) {
    rows.push({ key: 'dept_head', label: `${ownDept.name} Department Head`, departmentName: ownDept.name, sortOrder: 4 });
  }

  await tx.exitClearance.createMany({
    data: rows.map((r) => ({ ...r, tenantId: exit.tenantId, exitId: exit.id })),
    skipDuplicates: true,
  });
}

/**
 * Make sure every exit has clearance rows, building them for exits created
 * before the rows existed. Returns the exits with `clearances` populated.
 * Safe under concurrency: the (exitId, key) unique index absorbs a race.
 *
 * @param {Array<object>} exits - ExitDetails rows, with or without `clearances`
 */
export async function ensureClearanceRows(exits) {
  const missing = exits.filter((e) => !e.clearances || e.clearances.length === 0);
  if (missing.length === 0) return exits;

  for (const exit of missing) {
    const cd = parseRemarks(exit.feedbackRemarks).clearances || {};
    const data = BASE_CLEARANCES.map((c) => {
      const cleared = !!exit[`${c.key}Cleared`];
      return {
        ...c,
        tenantId: exit.tenantId,
        exitId: exit.id,
        departmentName: c.key === 'it' ? 'IT' : null,
        status: cleared ? 'CLEARED' : 'PENDING',
        remarks: cd[c.key]?.remarks || null,
        fileUrl: cd[c.key]?.fileUrl || null,
        fileName: cd[c.key]?.fileName || null,
        actedByName: cleared ? (exit[`${c.key}ClearedBy`] || null) : null,
        actedAt: cleared ? (exit[`${c.key}ClearedAt`] || null) : null,
      };
    });
    await prisma.exitClearance.createMany({ data, skipDuplicates: true });
  }

  const rows = await prisma.exitClearance.findMany({
    where: { exitId: { in: missing.map((e) => e.id) } },
    orderBy: { sortOrder: 'asc' },
  });
  return exits.map((e) =>
    missing.includes(e) ? { ...e, clearances: rows.filter((r) => r.exitId === e.id) } : e
  );
}

/**
 * Everything needed to resolve approvers for a tenant's exits in one pass.
 * @param {string} tenantId
 * @param {Array<{ user?: { managerId?: string|null } }>} exits
 */
export async function loadApproverContext(tenantId, exits = []) {
  const departments = await prisma.department.findMany({
    where: { tenantId, isActive: true },
    select: { name: true, headId: true, alternateHeadId: true },
  });
  const ids = new Set();
  departments.forEach((d) => { if (d.headId) ids.add(d.headId); if (d.alternateHeadId) ids.add(d.alternateHeadId); });
  exits.forEach((e) => { if (e.user?.managerId) ids.add(e.user.managerId); });

  const people = ids.size
    ? await prisma.tenantUser.findMany({
        where: { tenantId, id: { in: [...ids] }, isDeleted: false, status: { not: 'EXITED' } },
        select: { id: true, name: true },
      })
    : [];

  return {
    deptByName: new Map(departments.map((d) => [lower(d.name), d])),
    personById: new Map(people.map((p) => [p.id, p])),
  };
}

/**
 * Designated approvers for one clearance. `unassigned` explains why nobody is
 * designated (HR / Admin can then still act on the employee's behalf).
 */
export function resolveApprovers(clearance, exitUser, ctx) {
  const people = (ids) => ids.map((id) => ctx.personById.get(id)).filter(Boolean);

  switch (clearance.key) {
    case 'hr':
      return { ids: [], names: ['HR team'], unassigned: null };
    case 'finance':
      return { ids: [], names: ['Finance team'], unassigned: null };
    case 'manager': {
      const found = people([exitUser?.managerId].filter(Boolean));
      return {
        ids: found.map((p) => p.id),
        names: found.map((p) => p.name),
        unassigned: found.length ? null : 'No reporting manager assigned',
      };
    }
    case 'it':
    case 'dept_head': {
      const dept = clearance.key === 'it'
        ? [...ctx.deptByName.values()].find((d) => isItDepartment(d.name))
        : ctx.deptByName.get(lower(clearance.departmentName));
      if (!dept) {
        return {
          ids: [], names: [],
          unassigned: clearance.key === 'it'
            ? 'No IT department set up in Master Data'
            : `${clearance.departmentName || 'Department'} not found in Master Data`,
        };
      }
      const found = people([dept.headId, dept.alternateHeadId].filter(Boolean));
      return {
        ids: found.map((p) => p.id),
        names: found.map((p) => p.name),
        unassigned: found.length ? null : `No head assigned for ${dept.name}`,
      };
    }
    default:
      return { ids: [], names: [], unassigned: 'Unknown clearance' };
  }
}

/**
 * May `user` clear or revoke this clearance, and would it be on someone
 * else's behalf (which requires a reason)?
 * @returns {{ allowed: boolean, onBehalf: boolean }}
 */
export function permissionFor(user, clearance, approvers) {
  const role = String(user?.role || '').toUpperCase();
  const isLeadership = CLEARANCE_LEADERSHIP_ROLES.includes(role);
  const isDesignated = approvers.ids.includes(user?.id);

  switch (clearance.key) {
    case 'hr':
      return { allowed: isLeadership, onBehalf: false };
    case 'finance':
      return { allowed: isLeadership || role === 'FINANCE', onBehalf: false };
    case 'manager':
      return { allowed: isDesignated || isLeadership, onBehalf: false };
    case 'it':
    case 'dept_head':
      if (isDesignated) return { allowed: true, onBehalf: false };
      return { allowed: isLeadership, onBehalf: isLeadership };
    default:
      return { allowed: false, onBehalf: false };
  }
}

/**
 * Is this clearance assigned to `user` (as opposed to something they could do
 * as HR/Admin)? Drives "waiting on you" counts and the clearance inbox.
 */
export function isAssignedTo(user, clearance, approvers) {
  const role = String(user?.role || '').toUpperCase();
  if (clearance.key === 'hr') return CLEARANCE_LEADERSHIP_ROLES.includes(role);
  if (clearance.key === 'finance') return role === 'FINANCE';
  return approvers.ids.includes(user?.id);
}

/**
 * The clearance as the API returns it. Carries both naming styles the
 * existing clients read (`by`/`at` and `clearedBy`/`clearedAt`).
 */
export function presentClearance(row, exit, user, ctx) {
  const approvers = resolveApprovers(row, exit.user, ctx);
  const perm = exit.exitStatus === 'COMPLETED'
    ? { allowed: false, onBehalf: false }
    : permissionFor(user, row, approvers);
  const cleared = row.status === 'CLEARED';
  return {
    id: row.id,
    key: row.key,
    dept: row.label,
    label: row.label,
    departmentName: row.departmentName,
    cleared,
    by: cleared ? row.actedByName : null,
    at: cleared ? row.actedAt : null,
    clearedBy: cleared ? row.actedByName : null,
    clearedAt: cleared ? row.actedAt : null,
    remarks: row.remarks || '',
    fileUrl: row.fileUrl || null,
    fileName: row.fileName || null,
    clearedOnBehalf: cleared && row.onBehalf,
    onBehalfReason: cleared && row.onBehalf ? row.onBehalfReason : null,
    approverNames: approvers.names,
    unassigned: approvers.unassigned,
    canAct: perm.allowed,
    requiresReason: perm.allowed && perm.onBehalf,
    assignedToMe: exit.exitStatus !== 'COMPLETED' && isAssignedTo(user, row, approvers),
  };
}

export function progressOf(clearances) {
  const total = clearances.length;
  const completed = clearances.filter((c) => c.cleared).length;
  return { total, completed, percentage: total ? Math.round((completed / total) * 100) : 0 };
}
