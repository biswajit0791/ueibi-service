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
 *              Has two independent sub-steps: Pre-Handover and Post-Handover.
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

// Department names (case-insensitive) treated as the Product department.
const PRODUCT_DEPARTMENT_NAMES = ['product', 'product department', 'product engineering', 'product management'];

// The four clearances that existed before rows did; each still mirrors into
// the ExitDetails boolean columns of the same prefix.
export const LEGACY_KEYS = ['it', 'hr', 'finance', 'manager'];

/**
 * Enterprise Exit Clearance Sequence:
 * 1. Reporting Manager -> 2. IT Department -> 3. HR -> 4. Finance -> 5. Product Department
 */
export const CLEARANCE_SEQUENCE = [
  { key: 'manager', label: 'Reporting Manager', sortOrder: 1, stepNumber: 1 },
  { key: 'it', label: 'IT Department', sortOrder: 2, stepNumber: 2 },
  { key: 'hr', label: 'HR', sortOrder: 3, stepNumber: 3 },
  { key: 'finance', label: 'Finance', sortOrder: 4, stepNumber: 4 },
  { key: 'product', label: 'Product Department', sortOrder: 5, stepNumber: 5 },
];

export const BASE_CLEARANCES = CLEARANCE_SEQUENCE;
export const SEQUENCE_ORDER = ['manager', 'it', 'hr', 'finance', 'product'];

/**
 * Sub-steps under Reporting Manager clearance:
 * Pre-Handover and Post-Handover are tracked and marked completed independently.
 */
export const MANAGER_SUB_STEPS = [
  {
    key: 'pre_handover',
    label: 'Pre-Handover',
    subStepNumber: '1.1',
    description: 'Handover plan, knowledge transfer sessions, project task allocations, and transition roadmap.',
  },
  {
    key: 'post_handover',
    label: 'Post-Handover',
    subStepNumber: '1.2',
    description: 'Final deliverable handovers, codebase & repository access transfers, client transition, and sign-off.',
  },
];

const lower = (s) => String(s || '').trim().toLowerCase();
const isItDepartment = (name) => IT_DEPARTMENT_NAMES.includes(lower(name));
const isProductDepartment = (name) => PRODUCT_DEPARTMENT_NAMES.includes(lower(name));

function parseRemarks(raw) {
  try {
    const obj = JSON.parse(raw || '{}');
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

/**
 * Resolves Pre-Handover and Post-Handover sub-steps for a reporting manager clearance.
 *
 * @param {object} row - ExitClearance row
 * @param {object} exit - ExitDetails object
 */
export function resolveManagerSubSteps(row, exit) {
  const cd = parseRemarks(exit?.feedbackRemarks).clearances || {};
  const mgrData = cd.manager || {};
  const storedSubs = mgrData.subSteps || {};

  const hasStoredPre = storedSubs.pre_handover !== undefined || storedSubs.preHandover !== undefined;
  const hasStoredPost = storedSubs.post_handover !== undefined || storedSubs.postHandover !== undefined;

  let preData;
  let postData;

  if (hasStoredPre || hasStoredPost) {
    preData = storedSubs.pre_handover || storedSubs.preHandover || {};
    postData = storedSubs.post_handover || storedSubs.postHandover || {};
  } else {
    const isCleared = row?.status === 'CLEARED' || !!exit?.managerCleared;
    preData = {
      cleared: isCleared,
      remarks: isCleared ? (row?.remarks || mgrData.remarks || '') : '',
      fileUrl: isCleared ? (row?.fileUrl || mgrData.fileUrl || null) : null,
      fileName: isCleared ? (row?.fileName || mgrData.fileName || null) : null,
      clearedBy: isCleared ? (row?.actedByName || mgrData.clearedBy || exit?.managerClearedBy || null) : null,
      clearedAt: isCleared ? (row?.actedAt || mgrData.clearedAt || exit?.managerClearedAt || null) : null,
    };
    postData = {
      cleared: isCleared,
      remarks: isCleared ? (row?.remarks || mgrData.remarks || '') : '',
      fileUrl: isCleared ? (row?.fileUrl || mgrData.fileUrl || null) : null,
      fileName: isCleared ? (row?.fileName || mgrData.fileName || null) : null,
      clearedBy: isCleared ? (row?.actedByName || mgrData.clearedBy || exit?.managerClearedBy || null) : null,
      clearedAt: isCleared ? (row?.actedAt || mgrData.clearedAt || exit?.managerClearedAt || null) : null,
    };
  }

  const preCleared = !!preData.cleared;
  const postCleared = !!postData.cleared;

  const subSteps = [
    {
      key: 'pre_handover',
      label: 'Pre-Handover',
      subStepNumber: '1.1',
      description: 'Handover plan, knowledge transfer sessions, project task allocations, and transition roadmap.',
      cleared: preCleared,
      by: preCleared ? (preData.clearedBy || preData.by || preData.actedByName || null) : null,
      at: preCleared ? (preData.clearedAt || preData.at || preData.actedAt || null) : null,
      remarks: preData.remarks || '',
      fileUrl: preData.fileUrl || null,
      fileName: preData.fileName || null,
      onBehalf: !!preData.onBehalf,
      onBehalfReason: preData.onBehalfReason || null,
    },
    {
      key: 'post_handover',
      label: 'Post-Handover',
      subStepNumber: '1.2',
      description: 'Final deliverable handovers, codebase & repository access transfers, client transition, and sign-off.',
      cleared: postCleared,
      by: postCleared ? (postData.clearedBy || postData.by || postData.actedByName || null) : null,
      at: postCleared ? (postData.clearedAt || postData.at || postData.actedAt || null) : null,
      remarks: postData.remarks || '',
      fileUrl: postData.fileUrl || null,
      fileName: postData.fileName || null,
      onBehalf: !!postData.onBehalf,
      onBehalfReason: postData.onBehalfReason || null,
    },
  ];

  const completedCount = (preCleared ? 1 : 0) + (postCleared ? 1 : 0);
  const isFullyCleared = preCleared && postCleared;
  const pendingSubStepLabels = subSteps.filter((s) => !s.cleared).map((s) => s.label);

  return {
    subSteps,
    subStepsProgress: {
      total: 2,
      completed: completedCount,
      percentage: completedCount * 50,
    },
    isFullyCleared,
    pendingSubStepLabels,
  };
}

/**
 * Rows for a newly initiated exit following the 5-step clearance sequence:
 * 1. Reporting Manager -> 2. IT Department -> 3. HR -> 4. Finance -> 5. Product Department
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
  const productDept = departments.find((d) => isProductDepartment(d.name));

  const rows = BASE_CLEARANCES.map((c) => ({
    key: c.key,
    label: c.label,
    sortOrder: c.sortOrder,
    departmentName: c.key === 'it' 
      ? (itDept?.name || 'IT') 
      : c.key === 'product'
      ? (productDept?.name || 'Product')
      : null,
  }));

  await tx.exitClearance.createMany({
    data: rows.map((r) => ({ ...r, tenantId: exit.tenantId, exitId: exit.id })),
    skipDuplicates: true,
  });
}

/**
 * Make sure every exit has clearance rows, backfilling rows for exits created
 * before the rows or sequence existed. Ensures the 5-step sequence is established.
 *
 * @param {Array<object>} exits - ExitDetails rows, with or without `clearances`
 */
export async function ensureClearanceRows(exits) {
  if (!exits || exits.length === 0) return exits;

  for (const exit of exits) {
    const existing = exit.clearances || [];
    const existingKeys = new Set(existing.map((c) => c.key));

    const missingBase = BASE_CLEARANCES.filter((c) => !existingKeys.has(c.key));
    if (missingBase.length > 0) {
      const cd = parseRemarks(exit.feedbackRemarks).clearances || {};
      const newRows = missingBase.map((c) => {
        let cleared = !!exit[`${c.key}Cleared`];
        if (c.key === 'manager' && cd.manager?.subSteps) {
          const preCleared = !!cd.manager.subSteps.pre_handover?.cleared;
          const postCleared = !!cd.manager.subSteps.post_handover?.cleared;
          cleared = preCleared && postCleared;
        }
        return {
          key: c.key,
          label: c.label,
          sortOrder: c.sortOrder,
          tenantId: exit.tenantId,
          exitId: exit.id,
          departmentName: c.key === 'it' ? 'IT' : c.key === 'product' ? 'Product' : null,
          status: cleared ? 'CLEARED' : 'PENDING',
          remarks: cd[c.key]?.remarks || null,
          fileUrl: cd[c.key]?.fileUrl || null,
          fileName: cd[c.key]?.fileName || null,
          actedByName: cleared ? (exit[`${c.key}ClearedBy`] || null) : null,
          actedAt: cleared ? (exit[`${c.key}ClearedAt`] || null) : null,
        };
      });
      await prisma.exitClearance.createMany({ data: newRows, skipDuplicates: true });
    }

    // Synchronize sortOrder and label to adhere strictly to the sequence:
    // 1. Manager -> 2. IT -> 3. HR -> 4. Finance -> 5. Product
    for (const base of BASE_CLEARANCES) {
      const match = existing.find((c) => c.key === base.key);
      if (match && (match.sortOrder !== base.sortOrder || match.label !== base.label)) {
        await prisma.exitClearance.updateMany({
          where: { exitId: exit.id, key: base.key },
          data: { sortOrder: base.sortOrder, label: base.label },
        });
      }
    }
  }

  const exitIds = exits.map((e) => e.id);
  const rows = await prisma.exitClearance.findMany({
    where: { exitId: { in: exitIds } },
    orderBy: { sortOrder: 'asc' },
  });

  return exits.map((e) => {
    const exitRows = rows.filter((r) => r.exitId === e.id);
    exitRows.sort((a, b) => {
      const idxA = SEQUENCE_ORDER.indexOf(a.key);
      const idxB = SEQUENCE_ORDER.indexOf(b.key);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      return a.sortOrder - b.sortOrder;
    });
    return { ...e, clearances: exitRows };
  });
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
 * Designated approvers for one clearance.
 */
export function resolveApprovers(clearance, exitUser, ctx) {
  const people = (ids) => ids.map((id) => ctx.personById.get(id)).filter(Boolean);

  switch (clearance.key) {
    case 'manager': {
      const found = people([exitUser?.managerId].filter(Boolean));
      return {
        ids: found.map((p) => p.id),
        names: found.map((p) => p.name),
        unassigned: found.length ? null : 'No reporting manager assigned',
      };
    }
    case 'it': {
      const dept = [...ctx.deptByName.values()].find((d) => isItDepartment(d.name));
      if (!dept) {
        return {
          ids: [], names: [],
          unassigned: 'No IT department set up in Master Data',
        };
      }
      const found = people([dept.headId, dept.alternateHeadId].filter(Boolean));
      return {
        ids: found.map((p) => p.id),
        names: found.map((p) => p.name),
        unassigned: found.length ? null : `No head assigned for ${dept.name}`,
      };
    }
    case 'hr':
      return { ids: [], names: ['HR team'], unassigned: null };
    case 'finance':
      return { ids: [], names: ['Finance team'], unassigned: null };
    case 'product': {
      const dept = [...ctx.deptByName.values()].find((d) => isProductDepartment(d.name));
      if (!dept) {
        return {
          ids: [], names: [],
          unassigned: 'No Product department set up in Master Data',
        };
      }
      const found = people([dept.headId, dept.alternateHeadId].filter(Boolean));
      return {
        ids: found.map((p) => p.id),
        names: found.map((p) => p.name),
        unassigned: found.length ? null : `No head assigned for ${dept.name}`,
      };
    }
    case 'dept_head': {
      const dept = ctx.deptByName.get(lower(clearance.departmentName));
      if (!dept) {
        return {
          ids: [], names: [],
          unassigned: `${clearance.departmentName || 'Department'} not found in Master Data`,
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
 */
export function permissionFor(user, clearance, approvers) {
  const role = String(user?.role || '').toUpperCase();
  const isLeadership = CLEARANCE_LEADERSHIP_ROLES.includes(role);
  const isDesignated = approvers.ids.includes(user?.id);

  switch (clearance.key) {
    case 'manager':
      return { allowed: isDesignated || isLeadership, onBehalf: false };
    case 'it':
      if (isDesignated) return { allowed: true, onBehalf: false };
      return { allowed: isLeadership, onBehalf: isLeadership };
    case 'hr':
      return { allowed: isLeadership, onBehalf: false };
    case 'finance':
      return { allowed: isLeadership || role === 'FINANCE', onBehalf: false };
    case 'product':
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
 * The clearance as the API returns it, enriched with sequence step order and readiness.
 */
export function presentClearance(row, exit, user, ctx) {
  const approvers = resolveApprovers(row, exit.user, ctx);
  const perm = exit.exitStatus === 'COMPLETED'
    ? { allowed: false, onBehalf: false }
    : permissionFor(user, row, approvers);

  let subSteps = null;
  let subStepsProgress = null;
  let isFullyCleared = row.status === 'CLEARED';

  if (row.key === 'manager') {
    const resolved = resolveManagerSubSteps(row, exit);
    subSteps = resolved.subSteps.map((s) => ({
      ...s,
      canAct: perm.allowed && exit.exitStatus !== 'COMPLETED',
    }));
    subStepsProgress = resolved.subStepsProgress;
    isFullyCleared = resolved.isFullyCleared;
  }

  const cleared = isFullyCleared;

  // Sequence verification: 1. Manager -> 2. IT -> 3. HR -> 4. Finance -> 5. Product
  const targetSeqIdx = SEQUENCE_ORDER.indexOf(row.key);
  let isSequenceBlocked = false;
  let waitingOnPredecessor = null;

  if (targetSeqIdx > 0 && !cleared) {
    const predKeys = SEQUENCE_ORDER.slice(0, targetSeqIdx);
    const pendingPredecessor = (exit.clearances || [])
      .filter((c) => {
        if (!predKeys.includes(c.key)) return false;
        if (c.key === 'manager') {
          const res = resolveManagerSubSteps(c, exit);
          return !res.isFullyCleared;
        }
        return c.status !== 'CLEARED';
      })
      .sort((a, b) => SEQUENCE_ORDER.indexOf(a.key) - SEQUENCE_ORDER.indexOf(b.key))[0];

    if (pendingPredecessor) {
      isSequenceBlocked = true;
      if (pendingPredecessor.key === 'manager') {
        const res = resolveManagerSubSteps(pendingPredecessor, exit);
        const pendingSubs = res.pendingSubStepLabels;
        waitingOnPredecessor = pendingSubs.length > 0
          ? `Reporting Manager (${pendingSubs.join(' & ')} pending)`
          : pendingPredecessor.label;
      } else {
        waitingOnPredecessor = pendingPredecessor.label;
      }
    }
  }

  const stepNumber = targetSeqIdx >= 0 ? targetSeqIdx + 1 : row.sortOrder;

  return {
    id: row.id,
    key: row.key,
    dept: row.label,
    label: row.label,
    departmentName: row.departmentName,
    stepNumber,
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
    isSequenceBlocked,
    waitingOnPredecessor,
    canAct: perm.allowed && !isSequenceBlocked,
    requiresReason: perm.allowed && perm.onBehalf,
    assignedToMe: exit.exitStatus !== 'COMPLETED' && isAssignedTo(user, row, approvers),
    subSteps,
    subStepsProgress,
  };
}

export function progressOf(clearances) {
  const total = clearances.length;
  const completed = clearances.filter((c) => c.cleared).length;
  return { total, completed, percentage: total ? Math.round((completed / total) * 100) : 0 };
}
