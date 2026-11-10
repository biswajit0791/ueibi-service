import { prisma } from '../lib/prisma.js';

/**
 * auditDiff.service.js
 *
 * Enterprise Field-Level Audit Logging Engine
 * Compares before and after values for Goals and Tasks, resolves user identities,
 * formats human-readable values, and groups multiple field updates into a single structured record.
 */

export function formatDate(val) {
  if (!val) return 'Not set';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(val) {
  if (!val) return 'Not set';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function humanizeStatus(status) {
  if (!status) return 'Not set';
  const map = {
    todo: 'Assigned',
    in_progress: 'In Progress',
    done: 'Done',
    completed: 'Completed',
    active: 'Active',
    pending_approval: 'Pending Approval',
    pending_on_others: 'Pending On Others',
    blocked: 'Blocked',
    on_hold: 'On Hold',
    rejected: 'Rejected',
    changes_requested: 'Changes Requested',
    draft: 'Draft',
    archived: 'Archived',
  };
  const key = String(status).toLowerCase().trim();
  return map[key] || status.replace(/_/g, ' ').toUpperCase();
}

export function humanizePriority(priority) {
  if (!priority) return 'Medium';
  const p = String(priority).toLowerCase();
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/**
 * Resolves a map of user IDs to names for human-readable audit logging.
 */
export async function buildUserMap(userIds = [], tenantId) {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const users = await prisma.tenantUser.findMany({
    where: { id: { in: uniqueIds }, ...(tenantId ? { tenantId } : {}) },
    select: { id: true, name: true, designation: true },
  });

  const map = new Map();
  users.forEach((u) => {
    map.set(u.id, u.name + (u.designation ? ` (${u.designation})` : ''));
  });
  return map;
}

/**
 * Compare two date values (YYYY-MM-DD or ISO) to see if they meaningfully changed.
 */
function areDatesDifferent(d1, d2) {
  if (!d1 && !d2) return false;
  if (!d1 || !d2) return true;
  const iso1 = new Date(d1).toISOString().slice(0, 10);
  const iso2 = new Date(d2).toISOString().slice(0, 10);
  return iso1 !== iso2;
}

/**
 * Compute field-level differences for a Task update.
 */
export async function diffTaskChanges(existing, updates, actor, tenantId) {
  const changes = [];

  // Need user lookup for employeeId / assigneeIds
  const candidateUserIds = [
    existing.employeeId,
    updates.employeeId,
    ...(Array.isArray(existing.assigneeIds) ? existing.assigneeIds : []),
    ...(Array.isArray(updates.assigneeIds) ? updates.assigneeIds : []),
  ].filter(Boolean);

  const userMap = await buildUserMap(candidateUserIds, tenantId);
  const nameOf = (id) => userMap.get(id) || (id ? 'Employee' : 'Unassigned');

  // 1. Task Title
  if (updates.title !== undefined) {
    const oldTitle = (existing.title || '').trim();
    const newTitle = (updates.title || '').trim();
    if (oldTitle !== newTitle && newTitle.length > 0) {
      changes.push({
        field: 'title',
        label: 'Task Title',
        oldValue: oldTitle || 'Untitled',
        newValue: newTitle,
      });
    }
  }

  // 2. Task Description
  if (updates.description !== undefined) {
    const oldDesc = (existing.description || '').trim();
    const newDesc = (updates.description || '').trim();
    if (oldDesc !== newDesc) {
      changes.push({
        field: 'description',
        label: 'Task Description',
        oldValue: oldDesc ? (oldDesc.length > 60 ? oldDesc.slice(0, 57) + '...' : oldDesc) : 'None',
        newValue: newDesc ? (newDesc.length > 60 ? newDesc.slice(0, 57) + '...' : newDesc) : 'Cleared',
      });
    }
  }

  // 3. Impact Weight
  if (updates.weight !== undefined) {
    const oldWeight = Number(existing.weight || 0);
    const newWeight = Number(updates.weight || 0);
    if (oldWeight !== newWeight) {
      changes.push({
        field: 'weight',
        label: 'Impact Weight',
        oldValue: `${oldWeight}%`,
        newValue: `${newWeight}%`,
      });
    }
  }

  // 4. Task Status
  if (updates.status !== undefined) {
    const oldStatus = String(existing.status || '').toLowerCase();
    const newStatus = String(updates.status || '').toLowerCase();
    if (oldStatus !== newStatus && newStatus.length > 0) {
      changes.push({
        field: 'status',
        label: 'Task Status',
        oldValue: humanizeStatus(oldStatus),
        newValue: humanizeStatus(newStatus),
      });
    }
  }

  // 5. Priority
  if (updates.priority !== undefined) {
    const oldP = String(existing.priority || '').toLowerCase();
    const newP = String(updates.priority || '').toLowerCase();
    if (oldP !== newP && newP.length > 0) {
      changes.push({
        field: 'priority',
        label: 'Priority',
        oldValue: humanizePriority(oldP),
        newValue: humanizePriority(newP),
      });
    }
  }

  // 6. Progress
  if (updates.progress !== undefined) {
    const oldProg = Number(existing.progress || 0);
    const newProg = Number(updates.progress || 0);
    if (oldProg !== newProg) {
      changes.push({
        field: 'progress',
        label: 'Task Progress',
        oldValue: `${oldProg}%`,
        newValue: `${newProg}%`,
      });
    }
  }

  // 7. Assignee
  if (updates.employeeId !== undefined && updates.employeeId !== existing.employeeId) {
    changes.push({
      field: 'employeeId',
      label: 'Assignee',
      oldValue: nameOf(existing.employeeId),
      newValue: nameOf(updates.employeeId),
    });
  }

  // 8. Start Date
  if (updates.startDate !== undefined && areDatesDifferent(existing.startDate, updates.startDate)) {
    changes.push({
      field: 'startDate',
      label: 'Planned Start Date',
      oldValue: formatDate(existing.startDate),
      newValue: formatDate(updates.startDate),
    });
  }

  // 9. Due Date
  if (updates.dueDate !== undefined && areDatesDifferent(existing.dueDate, updates.dueDate)) {
    changes.push({
      field: 'dueDate',
      label: 'Due Date',
      oldValue: formatDate(existing.dueDate),
      newValue: formatDate(updates.dueDate),
    });
  }

  // 10. Actual Start Date
  if (updates.actualStartDate !== undefined && areDatesDifferent(existing.actualStartDate, updates.actualStartDate)) {
    changes.push({
      field: 'actualStartDate',
      label: 'Actual Start Date',
      oldValue: formatDate(existing.actualStartDate),
      newValue: formatDate(updates.actualStartDate),
    });
  }

  // 11. Actual Completion Date
  if (updates.actualCompletionDate !== undefined && areDatesDifferent(existing.actualCompletionDate, updates.actualCompletionDate)) {
    changes.push({
      field: 'actualCompletionDate',
      label: 'Actual Completion Date',
      oldValue: formatDate(existing.actualCompletionDate),
      newValue: formatDate(updates.actualCompletionDate),
    });
  }

  // 12. Dependency changes
  if (updates.dependency !== undefined) {
    const oldDep = existing.dependency;
    const newDep = updates.dependency;
    if (!oldDep && newDep) {
      changes.push({
        field: 'dependency',
        label: 'Task Dependency',
        oldValue: 'None',
        newValue: `${newDep.title || 'Untitled'} (${(newDep.type || 'PRE').toUpperCase()}) - ${humanizeStatus(newDep.status || 'pending_approval')}`,
      });
    } else if (oldDep && !newDep) {
      changes.push({
        field: 'dependency',
        label: 'Task Dependency',
        oldValue: `${oldDep.title || 'Untitled'} (${(oldDep.type || 'PRE').toUpperCase()})`,
        newValue: 'Removed',
      });
    } else if (oldDep && newDep) {
      if (oldDep.status !== newDep.status) {
        changes.push({
          field: 'dependency_status',
          label: 'Dependency Approval Status',
          oldValue: humanizeStatus(oldDep.status),
          newValue: humanizeStatus(newDep.status),
        });
      }
      if (oldDep.title !== newDep.title && newDep.title) {
        changes.push({
          field: 'dependency_title',
          label: 'Dependency Title',
          oldValue: oldDep.title || 'Untitled',
          newValue: newDep.title,
        });
      }
    }
  }

  // Determine primary action vocabulary
  let action = 'edited';
  if (changes.some((c) => c.field === 'status')) {
    action = 'status_changed';
  } else if (changes.some((c) => c.field === 'employeeId')) {
    action = 'assigned';
  } else if (changes.some((c) => c.field === 'dependency')) {
    action = 'dependency_created';
  } else if (changes.some((c) => c.field === 'dependency_status')) {
    const statusChange = changes.find((c) => c.field === 'dependency_status');
    if (statusChange?.newValue?.toLowerCase()?.includes('approved')) action = 'approved';
    else if (statusChange?.newValue?.toLowerCase()?.includes('rejected')) action = 'rejected';
  }

  // Formulate human-readable details summary
  let details = '';
  if (changes.length === 0) {
    details = 'Task details updated (no field values changed).';
  } else if (changes.length === 1) {
    const c = changes[0];
    details = `${c.label} changed from "${c.oldValue}" to "${c.newValue}".`;
  } else {
    const labels = changes.map((c) => c.label).join(', ');
    details = `Updated ${changes.length} fields: ${labels}.`;
  }

  return {
    changes,
    details,
    action,
  };
}

/**
 * Compute field-level differences for a Goal update.
 */
export async function diffGoalChanges(existing, updates, actor, tenantId) {
  const changes = [];

  const candidateUserIds = [
    existing.employeeId,
    updates.employeeId,
    existing.ownerManagerId,
    updates.ownerManagerId,
  ].filter(Boolean);

  const userMap = await buildUserMap(candidateUserIds, tenantId);
  const nameOf = (id) => userMap.get(id) || (id ? 'User' : 'Unassigned');

  // 1. Goal Title
  if (updates.title !== undefined) {
    const oldTitle = (existing.title || '').trim();
    const newTitle = (updates.title || '').trim();
    if (oldTitle !== newTitle && newTitle.length > 0) {
      changes.push({
        field: 'title',
        label: 'Goal Title',
        oldValue: oldTitle || 'Untitled',
        newValue: newTitle,
      });
    }
  }

  // 2. Goal Description
  if (updates.description !== undefined) {
    const oldDesc = (existing.description || '').trim();
    const newDesc = (updates.description || '').trim();
    if (oldDesc !== newDesc) {
      changes.push({
        field: 'description',
        label: 'Goal Description',
        oldValue: oldDesc ? (oldDesc.length > 60 ? oldDesc.slice(0, 57) + '...' : oldDesc) : 'None',
        newValue: newDesc ? (newDesc.length > 60 ? newDesc.slice(0, 57) + '...' : newDesc) : 'Cleared',
      });
    }
  }

  // 3. Goal Category
  if (updates.category !== undefined && updates.category !== existing.category) {
    changes.push({
      field: 'category',
      label: 'Goal Category',
      oldValue: existing.category || 'General',
      newValue: updates.category || 'General',
    });
  }

  // 4. Goal Owner
  if (updates.ownerManagerId !== undefined && updates.ownerManagerId !== existing.ownerManagerId) {
    changes.push({
      field: 'ownerManagerId',
      label: 'Goal Owner',
      oldValue: nameOf(existing.ownerManagerId),
      newValue: nameOf(updates.ownerManagerId),
    });
  }

  // 5. Priority
  if (updates.priority !== undefined) {
    const oldP = String(existing.priority || '').toLowerCase();
    const newP = String(updates.priority || '').toLowerCase();
    if (oldP !== newP && newP.length > 0) {
      changes.push({
        field: 'priority',
        label: 'Priority',
        oldValue: humanizePriority(oldP),
        newValue: humanizePriority(newP),
      });
    }
  }

  // 6. Goal Status
  if (updates.status !== undefined) {
    const oldStatus = String(existing.status || '').toLowerCase();
    const newStatus = String(updates.status || '').toLowerCase();
    if (oldStatus !== newStatus && newStatus.length > 0) {
      changes.push({
        field: 'status',
        label: 'Goal Status',
        oldValue: humanizeStatus(oldStatus),
        newValue: humanizeStatus(newStatus),
      });
    }
  }

  // 7. Progress
  if (updates.progress !== undefined) {
    const oldProg = Number(existing.progress || 0);
    const newProg = Number(updates.progress || 0);
    if (oldProg !== newProg) {
      changes.push({
        field: 'progress',
        label: 'Goal Progress',
        oldValue: `${oldProg}%`,
        newValue: `${newProg}%`,
      });
    }
  }

  // 8. Target Date / End Date
  const effectiveNewDate = updates.endDate || updates.dueDate;
  const effectiveOldDate = existing.endDate || existing.dueDate;
  if (effectiveNewDate !== undefined && areDatesDifferent(effectiveOldDate, effectiveNewDate)) {
    changes.push({
      field: 'targetDate',
      label: 'Target Date',
      oldValue: formatDate(effectiveOldDate),
      newValue: formatDate(effectiveNewDate),
    });
  }

  // Formulate details
  let action = 'GOAL_UPDATED';
  let details = '';
  if (changes.length === 0) {
    details = 'Goal details updated (no field values changed).';
  } else if (changes.length === 1) {
    const c = changes[0];
    details = `${c.label} changed from "${c.oldValue}" to "${c.newValue}".`;
  } else {
    const labels = changes.map((c) => c.label).join(', ');
    details = `Updated ${changes.length} fields: ${labels}.`;
  }

  return {
    changes,
    details,
    action,
  };
}

