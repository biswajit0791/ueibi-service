import { prisma } from '../lib/prisma.js';
import { emitDependencyEvent, emitToUser } from '../lib/socket.js';
import { pushNotification } from '../controllers/taskActivity.controller.js';
import { hasRole, MANAGER_OR_ELEVATED_ROLES, ELEVATED_ROLES } from '../lib/roles.js';

/**
 * Task Dependency Service
 *
 * Implements full enterprise workflow:
 * Phase 2: Cross-Department Approval
 * Phase 3: Pre-Dependency Workflow (Blocks Parent until VERIFIED)
 * Phase 4: Post-Dependency Workflow (Executes after Parent Done)
 * Phase 5: Downline Assignment & Progress Tracking
 * Phase 6: Strict Validation & FSM
 * Phase 7: Real-Time Socket.IO Synchronization
 * Phase 8: Immutable Dependency Audit History
 * Phase 9: Security & Tenant Isolation
 */

// Helper to write an immutable dependency audit record
export async function logDependencyAudit({
  tenantId,
  dependencyId,
  taskId,
  goalId = null,
  performedById,
  action,
  previousStatus = null,
  newStatus = null,
  details = null,
  meta = null,
}) {
  return prisma.dependencyAuditLog.create({
    data: {
      tenantId,
      dependencyId,
      taskId,
      goalId,
      performedById,
      action,
      previousStatus,
      newStatus,
      details,
      meta: meta || undefined,
    },
  });
}

/**
 * Recursively find all downline subordinates of a manager in a tenant.
 */
export async function getManagerDownlines(managerId, tenantId) {
  const users = await prisma.tenantUser.findMany({
    where: {
      tenantId,
      isDeleted: false,
      status: { in: ['ACTIVE', 'INVITED'] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      department: true,
      managerId: true,
      officeLocation: true,
      designation: true,
    },
  });

  const childrenOf = new Map();
  for (const u of users) {
    if (u.managerId) {
      if (!childrenOf.has(u.managerId)) childrenOf.set(u.managerId, []);
      childrenOf.get(u.managerId).push(u);
    }
  }

  const downlines = [];
  const queue = [managerId];
  const visited = new Set([managerId]);

  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = childrenOf.get(currentId) || [];
    for (const child of children) {
      if (!visited.has(child.id)) {
        visited.add(child.id);
        downlines.push(child);
        queue.push(child.id);
      }
    }
  }

  return downlines;
}

/**
 * Create a new task dependency.
 */
export async function createDependency({
  tenantId,
  requester,
  sourceTaskId,
  dependencyType = 'pre',
  targetManagerId,
  title,
  description,
  dueDate,
  weight = 10,
}) {
  // 1. Verify source task
  const sourceTask = await prisma.task.findFirst({
    where: { id: sourceTaskId, tenantId },
    include: {
      goal: { select: { id: true, title: true, ownerManagerId: true } },
    },
  });

  if (!sourceTask) {
    throw new Error('Source task not found in tenant.');
  }

  const isOwner = sourceTask.employeeId === requester.id;
  const isSuper = hasRole(requester.role, ELEVATED_ROLES);
  if (!isOwner && !isSuper) {
    throw new Error('Access forbidden: Only the task owner or elevated managers can raise a dependency.');
  }

  // 2. Verify target manager
  const targetManager = await prisma.tenantUser.findFirst({
    where: { id: targetManagerId, tenantId, isDeleted: false },
    select: { id: true, name: true, role: true, department: true, email: true },
  });

  if (!targetManager) {
    throw new Error('Target manager not found.');
  }

  if (!hasRole(targetManager.role, MANAGER_OR_ELEVATED_ROLES)) {
    throw new Error('Dependencies must be assigned to a Manager or elevated role.');
  }

  // 3. Pre-dependency due date validation
  if (dueDate) {
    const depDue = new Date(dueDate);
    if (sourceTask.dueDate && dependencyType === 'pre') {
      const parentDue = new Date(sourceTask.dueDate);
      if (depDue > parentDue) {
        throw new Error('Pre-requisite dependency due date cannot be later than the main task due date.');
      }
    }
  }

  // 4. Cross-department check
  const requesterDept = requester.department || null;
  const targetDept = targetManager.department || null;
  const isCrossDept = Boolean(requesterDept && targetDept && requesterDept.toLowerCase() !== targetDept.toLowerCase());

  let deptHeadId = null;
  let deptHeadApprovalReqd = false;
  let initialStatus = 'PENDING_APPROVAL';

  if (isCrossDept) {
    const deptRecord = await prisma.department.findFirst({
      where: {
        tenantId,
        name: { equals: targetDept, mode: 'insensitive' },
        isActive: true,
      },
      select: { id: true, headId: true, alternateHeadId: true },
    });

    if (deptRecord?.headId && deptRecord.headId !== requester.id && deptRecord.headId !== targetManagerId) {
      deptHeadId = deptRecord.headId;
      deptHeadApprovalReqd = true;
      initialStatus = 'DEPT_HEAD_REVIEWING';
    }
  }

  // 5. Database transaction: create TaskDependency + Companion Task
  return prisma.$transaction(async (tx) => {
    // Companion task
    const companionTask = await tx.task.create({
      data: {
        tenantId,
        title: `[Dependency] ${title}`,
        description: description || `Dependency for task: ${sourceTask.title}`,
        priority: sourceTask.priority || 'medium',
        status: 'pending_approval',
        startDate: new Date(),
        dueDate: dueDate ? new Date(dueDate) : sourceTask.dueDate,
        isPrivate: false,
        isStandalone: true,
        weight: Math.min(100, Math.max(1, Number(weight) || 10)),
        employeeId: targetManagerId,
        isDependencyOf: sourceTaskId,
      },
    });

    // TaskDependency record
    const dep = await tx.taskDependency.create({
      data: {
        tenantId,
        sourceTaskId,
        companionTaskId: companionTask.id,
        dependencyType,
        requesterId: requester.id,
        targetManagerId,
        requesterDepartment: requesterDept,
        targetDepartment: targetDept,
        isCrossDepartment: isCrossDept,
        deptHeadId,
        deptHeadApprovalReqd,
        title,
        description,
        dueDate: dueDate ? new Date(dueDate) : null,
        weight: Number(weight) || 10,
        status: initialStatus,
      },
      include: {
        requester: { select: { id: true, name: true, email: true, department: true } },
        targetManager: { select: { id: true, name: true, email: true, department: true } },
      },
    });

    // Update source task to pending_on_others (or blocked) and legacy JSON
    await tx.task.update({
      where: { id: sourceTaskId },
      data: {
        status: 'pending_on_others',
        dependency: {
          id: dep.id,
          type: dependencyType,
          concernedPersonId: targetManagerId,
          concernedPersonName: targetManager.name,
          title,
          dueDate: dueDate || null,
          status: initialStatus.toLowerCase(),
          depTaskId: companionTask.id,
          isCrossDept,
        },
      },
    });

    // Audit log
    await tx.dependencyAuditLog.create({
      data: {
        tenantId,
        dependencyId: dep.id,
        taskId: sourceTaskId,
        goalId: sourceTask.goalId,
        performedById: requester.id,
        action: 'CREATED',
        previousStatus: null,
        newStatus: initialStatus,
        details: `Created ${dependencyType.toUpperCase()} dependency: "${title}" assigned to ${targetManager.name} (${targetDept || 'General'}).`,
      },
    });

    // Notifications & Socket.IO
    const notifyTarget = deptHeadApprovalReqd ? deptHeadId : targetManagerId;
    await pushNotification({
      tenantId,
      recipientId: notifyTarget,
      type: 'task_update',
      title: 'New Task Dependency Request',
      body: `"${requester.name}" requested dependency "${title}" for task "${sourceTask.title}".`,
      entityType: 'task',
      entityId: companionTask.id,
    });

    emitDependencyEvent(
      tenantId,
      deptHeadApprovalReqd ? 'dependency:approval-requested' : 'dependency:created',
      dep,
      [targetManagerId, deptHeadId, requester.id].filter(Boolean)
    );

    return dep;
  });
}

/**
 * Approve a dependency.
 * Supports downline employee assignments.
 */
export async function approveDependency({
  tenantId,
  user,
  dependencyId,
  downlineEmployeeIds = [],
  notes = null,
}) {
  const dep = await prisma.taskDependency.findFirst({
    where: { id: dependencyId, tenantId },
    include: {
      sourceTask: { select: { id: true, title: true, goalId: true, employeeId: true } },
      companionTask: true,
      requester: { select: { id: true, name: true, email: true } },
      targetManager: { select: { id: true, name: true, email: true } },
    },
  });

  if (!dep) throw new Error('Dependency record not found.');

  // Authorization check
  const isTargetManager = dep.targetManagerId === user.id;
  const isDeptHead = dep.deptHeadId === user.id;
  const isSuper = hasRole(user.role, ELEVATED_ROLES);

  if (!isTargetManager && !isDeptHead && !isSuper) {
    throw new Error('Access forbidden: Only the assigned manager, department head, or elevated admins can approve.');
  }

  if (dep.requesterId === user.id && !isSuper) {
    throw new Error('Security violation: Requesters cannot approve their own dependency requests.');
  }

  // Validate eligible downline employees if supplied
  let validDownlineIds = [];
  if (Array.isArray(downlineEmployeeIds) && downlineEmployeeIds.length > 0) {
    const eligibleSubordinates = await getManagerDownlines(dep.targetManagerId, tenantId);
    const eligibleSet = new Set(eligibleSubordinates.map((s) => s.id));
    validDownlineIds = downlineEmployeeIds.filter((id) => eligibleSet.has(id));
  }

  return prisma.$transaction(async (tx) => {
    // 1. Update dependency status
    const updatedDep = await tx.taskDependency.update({
      where: { id: dependencyId },
      data: {
        status: 'APPROVED',
        approvedById: user.id,
        approvedAt: new Date(),
        approvalNotes: notes || null,
      },
      include: {
        requester: { select: { id: true, name: true } },
        targetManager: { select: { id: true, name: true } },
      },
    });

    // 2. Update companion task -> active 'todo'
    if (dep.companionTaskId) {
      await tx.task.update({
        where: { id: dep.companionTaskId },
        data: {
          status: 'todo',
          assigneeIds: validDownlineIds.length > 0 ? validDownlineIds : [dep.targetManagerId],
        },
      });
    }

    // 3. Update parent task legacy JSON
    await tx.task.update({
      where: { id: dep.sourceTaskId },
      data: {
        dependency: {
          id: dep.id,
          type: dep.dependencyType,
          concernedPersonId: dep.targetManagerId,
          concernedPersonName: dep.targetManager.name,
          title: dep.title,
          dueDate: dep.dueDate,
          status: 'approved',
          depTaskId: dep.companionTaskId,
        },
      },
    });

    // 4. Audit Log
    await tx.dependencyAuditLog.create({
      data: {
        tenantId,
        dependencyId,
        taskId: dep.sourceTaskId,
        goalId: dep.sourceTask?.goalId,
        performedById: user.id,
        action: 'APPROVED',
        previousStatus: dep.status,
        newStatus: 'APPROVED',
        details: `Approved by ${user.name}. ${validDownlineIds.length > 0 ? `Delegated to ${validDownlineIds.length} downline assignees.` : ''}`,
        meta: { downlineEmployeeIds: validDownlineIds, notes },
      },
    });

    const depAuditChanges = [
      {
        field: 'dependency_status',
        label: 'Dependency Approval Status',
        oldValue: 'Pending Approval',
        newValue: 'Approved',
      },
    ];
    if (validDownlineIds.length > 0) {
      depAuditChanges.push({
        field: 'downline_assigned',
        label: 'Downline Delegation',
        oldValue: 'Manager',
        newValue: `${validDownlineIds.length} assignee(s)`,
      });
    }

    await tx.taskAuditLog.create({
      data: {
        taskId: dep.sourceTaskId,
        performedById: user.id,
        action: 'approved',
        details: `Dependency "${dep.title}" was approved by ${user.name}.`,
        previousValue: { changes: depAuditChanges },
      },
    });

    if (dep.companionTaskId) {
      await tx.taskAuditLog.create({
        data: {
          taskId: dep.companionTaskId,
          performedById: user.id,
          action: 'approved',
          details: `Dependency task approved by ${user.name}. Status set to Assigned.`,
          previousValue: { changes: depAuditChanges },
        },
      });
    }

    // 5. Notify Requester and Downline Employees
    await pushNotification({
      tenantId,
      recipientId: dep.requesterId,
      type: 'dep_approved',
      title: 'Dependency Approved',
      body: `Dependency "${dep.title}" was approved by ${user.name}.`,
      entityType: 'task',
      entityId: dep.companionTaskId,
    });

    for (const empId of validDownlineIds) {
      await pushNotification({
        tenantId,
        recipientId: empId,
        type: 'task_update',
        title: 'New Dependency Assignment',
        body: `You were assigned dependency task "${dep.title}" by ${user.name}.`,
        entityType: 'task',
        entityId: dep.companionTaskId,
      });
    }

    // Real-time broadcast
    emitDependencyEvent(tenantId, 'dependency:approved', updatedDep, [
      dep.requesterId,
      dep.targetManagerId,
      ...validDownlineIds,
    ]);

    return updatedDep;
  });
}

/**
 * Reject a dependency request with mandatory reason.
 * Preserves full history and companion record without deleting data.
 */
export async function rejectDependency({
  tenantId,
  user,
  dependencyId,
  reason,
}) {
  if (!reason || !reason.trim()) {
    throw new Error('A rejection reason is required.');
  }

  const dep = await prisma.taskDependency.findFirst({
    where: { id: dependencyId, tenantId },
    include: {
      sourceTask: { select: { id: true, title: true, goalId: true } },
      targetManager: { select: { id: true, name: true } },
    },
  });

  if (!dep) throw new Error('Dependency record not found.');

  const isTargetManager = dep.targetManagerId === user.id;
  const isDeptHead = dep.deptHeadId === user.id;
  const isSuper = hasRole(user.role, ELEVATED_ROLES);

  if (!isTargetManager && !isDeptHead && !isSuper) {
    throw new Error('Access forbidden: Only assigned manager or elevated admins can reject.');
  }

  return prisma.$transaction(async (tx) => {
    const updatedDep = await tx.taskDependency.update({
      where: { id: dependencyId },
      data: {
        status: 'REJECTED',
        rejectedById: user.id,
        rejectedAt: new Date(),
        rejectionReason: reason.trim(),
      },
    });

    // Update companion task to rejected
    if (dep.companionTaskId) {
      await tx.task.update({
        where: { id: dep.companionTaskId },
        data: { status: 'rejected' },
      });
    }

    // Update parent task legacy JSON
    await tx.task.update({
      where: { id: dep.sourceTaskId },
      data: {
        dependency: {
          id: dep.id,
          type: dep.dependencyType,
          concernedPersonId: dep.targetManagerId,
          title: dep.title,
          status: 'rejected',
          rejectionReason: reason.trim(),
        },
      },
    });

    // Immutable Audit Log
    await tx.dependencyAuditLog.create({
      data: {
        tenantId,
        dependencyId,
        taskId: dep.sourceTaskId,
        goalId: dep.sourceTask?.goalId,
        performedById: user.id,
        action: 'REJECTED',
        previousStatus: dep.status,
        newStatus: 'REJECTED',
        details: `Rejected by ${user.name}: "${reason.trim()}"`,
        meta: { reason: reason.trim() },
      },
    });

    const rejectChanges = [
      {
        field: 'dependency_status',
        label: 'Dependency Approval Status',
        oldValue: 'Pending Approval',
        newValue: 'Rejected',
      },
      {
        field: 'rejection_reason',
        label: 'Rejection Reason',
        oldValue: 'None',
        newValue: reason.trim(),
      },
    ];

    await tx.taskAuditLog.create({
      data: {
        taskId: dep.sourceTaskId,
        performedById: user.id,
        action: 'rejected',
        details: `Dependency "${dep.title}" declined by ${user.name}: "${reason.trim()}".`,
        previousValue: { changes: rejectChanges },
      },
    });

    if (dep.companionTaskId) {
      await tx.taskAuditLog.create({
        data: {
          taskId: dep.companionTaskId,
          performedById: user.id,
          action: 'rejected',
          details: `Dependency task declined by ${user.name}: "${reason.trim()}".`,
          previousValue: { changes: rejectChanges },
        },
      });
    }

    // Notify Requester
    await pushNotification({
      tenantId,
      recipientId: dep.requesterId,
      type: 'task_update',
      title: 'Dependency Request Declined',
      body: `"${dep.title}" was declined by ${user.name}: "${reason.trim()}". Parent task remains on hold.`,
      entityType: 'task',
      entityId: dep.sourceTaskId,
    });

    emitDependencyEvent(tenantId, 'dependency:rejected', updatedDep, [
      dep.requesterId,
      dep.targetManagerId,
    ]);

    return updatedDep;
  });
}

/**
 * Submit deliverable for verification when companion task is completed.
 */
export async function submitDeliverable({
  tenantId,
  user,
  dependencyId,
  deliverableNotes,
}) {
  const dep = await prisma.taskDependency.findFirst({
    where: { id: dependencyId, tenantId },
    include: {
      sourceTask: { select: { id: true, title: true, goalId: true } },
    },
  });

  if (!dep) throw new Error('Dependency record not found.');

  return prisma.$transaction(async (tx) => {
    const updatedDep = await tx.taskDependency.update({
      where: { id: dependencyId },
      data: {
        status: 'PENDING_VERIFICATION',
        deliverableNotes: deliverableNotes || 'Work completed and submitted for signoff.',
      },
    });

    // Mark companion task as done
    if (dep.companionTaskId) {
      await tx.task.update({
        where: { id: dep.companionTaskId },
        data: { status: 'done', progress: 100 },
      });
    }

    // Audit log
    await tx.dependencyAuditLog.create({
      data: {
        tenantId,
        dependencyId,
        taskId: dep.sourceTaskId,
        goalId: dep.sourceTask?.goalId,
        performedById: user.id,
        action: 'COMPLETION_SUBMITTED',
        previousStatus: dep.status,
        newStatus: 'PENDING_VERIFICATION',
        details: `Deliverable submitted by ${user.name}: ${deliverableNotes || 'No extra notes.'}`,
      },
    });

    // Notify Requester to verify
    await pushNotification({
      tenantId,
      recipientId: dep.requesterId,
      type: 'task_update',
      title: 'Dependency Deliverable Awaiting Verification',
      body: `Deliverable for "${dep.title}" was submitted. Please verify to unblock your task.`,
      entityType: 'task',
      entityId: dep.sourceTaskId,
    });

    emitDependencyEvent(tenantId, 'dependency:verification-requested', updatedDep, [
      dep.requesterId,
      dep.targetManagerId,
    ]);

    return updatedDep;
  });
}

/**
 * Verify a completed dependency.
 * Successfully unblocks the parent task once all pre-dependencies are verified!
 */
export async function verifyDependency({
  tenantId,
  user,
  dependencyId,
  verificationNotes = null,
}) {
  const dep = await prisma.taskDependency.findFirst({
    where: { id: dependencyId, tenantId },
    include: {
      sourceTask: { select: { id: true, title: true, goalId: true, employeeId: true } },
    },
  });

  if (!dep) throw new Error('Dependency record not found.');

  const isOwner = dep.requesterId === user.id;
  const isSuper = hasRole(user.role, ELEVATED_ROLES);
  if (!isOwner && !isSuper) {
    throw new Error('Access forbidden: Only the task owner or elevated managers can verify this deliverable.');
  }

  return prisma.$transaction(async (tx) => {
    // 1. Mark verified
    const updatedDep = await tx.taskDependency.update({
      where: { id: dependencyId },
      data: {
        status: 'VERIFIED',
        verifiedById: user.id,
        verifiedAt: new Date(),
        verificationNotes: verificationNotes || null,
      },
    });

    // 2. Check if all PRE-dependencies on the source task are now VERIFIED
    const remainingUnverified = await tx.taskDependency.findFirst({
      where: {
        tenantId,
        sourceTaskId: dep.sourceTaskId,
        dependencyType: 'pre',
        status: { not: 'VERIFIED' },
      },
    });

    let parentUnblocked = false;
    if (!remainingUnverified) {
      // Unblock parent task
      parentUnblocked = true;
      await tx.task.update({
        where: { id: dep.sourceTaskId },
        data: {
          status: 'todo', // Parent task is now ready to begin!
          dependency: {
            id: dep.id,
            status: 'completed',
            verified: true,
            verifiedAt: new Date().toISOString(),
          },
        },
      });
    }

    // 3. Audit Log
    await tx.dependencyAuditLog.create({
      data: {
        tenantId,
        dependencyId,
        taskId: dep.sourceTaskId,
        goalId: dep.sourceTask?.goalId,
        performedById: user.id,
        action: 'VERIFIED',
        previousStatus: dep.status,
        newStatus: 'VERIFIED',
        details: `Verified & accepted by ${user.name}. ${parentUnblocked ? 'Parent task has been UNBLOCKED!' : 'Other dependencies still pending.'}`,
        meta: { parentUnblocked, verificationNotes },
      },
    });

    await tx.taskAuditLog.create({
      data: {
        taskId: dep.sourceTaskId,
        performedById: user.id,
        action: 'verified',
        details: `Dependency "${dep.title}" verified and accepted by ${user.name}. ${parentUnblocked ? 'Parent task UNBLOCKED.' : ''}`,
        previousValue: {
          changes: [
            {
              field: 'verification_status',
              label: 'Verification Status',
              oldValue: 'Pending Verification',
              newValue: 'Verified & Accepted',
            },
            ...(parentUnblocked ? [{
              field: 'status',
              label: 'Task Status',
              oldValue: 'Blocked',
              newValue: 'Assigned (Unblocked)',
            }] : []),
          ],
        },
      },
    });

    // 4. Notify Target Manager
    await pushNotification({
      tenantId,
      recipientId: dep.targetManagerId,
      type: 'task_update',
      title: 'Dependency Deliverable Verified',
      body: `"${user.name}" verified and accepted deliverable for "${dep.title}".`,
      entityType: 'task',
      entityId: dep.sourceTaskId,
    });

    emitDependencyEvent(tenantId, 'dependency:verified', updatedDep, [
      dep.requesterId,
      dep.targetManagerId,
    ]);

    if (parentUnblocked) {
      emitDependencyEvent(tenantId, 'dependency:unlocked', {
        taskId: dep.sourceTaskId,
        status: 'todo',
      }, [dep.requesterId]);
    }

    return { dependency: updatedDep, parentUnblocked };
  });
}

/**
 * Request rework on a deliverable.
 */
export async function requestRework({
  tenantId,
  user,
  dependencyId,
  reworkReason,
}) {
  if (!reworkReason || !reworkReason.trim()) {
    throw new Error('A reason for requesting rework is required.');
  }

  const dep = await prisma.taskDependency.findFirst({
    where: { id: dependencyId, tenantId },
    include: {
      sourceTask: { select: { id: true, title: true, goalId: true } },
    },
  });

  if (!dep) throw new Error('Dependency record not found.');

  const isOwner = dep.requesterId === user.id;
  const isSuper = hasRole(user.role, ELEVATED_ROLES);
  if (!isOwner && !isSuper) {
    throw new Error('Access forbidden: Only the task owner or elevated managers can request rework.');
  }

  return prisma.$transaction(async (tx) => {
    const updatedDep = await tx.taskDependency.update({
      where: { id: dependencyId },
      data: {
        status: 'REWORK_REQUESTED',
        reworkRequestedById: user.id,
        reworkRequestedAt: new Date(),
        reworkReason: reworkReason.trim(),
        reworkCount: { increment: 1 },
      },
    });

    // Move companion task back to in_progress
    if (dep.companionTaskId) {
      await tx.task.update({
        where: { id: dep.companionTaskId },
        data: { status: 'in_progress', progress: 50 },
      });
    }

    // Audit log
    await tx.dependencyAuditLog.create({
      data: {
        tenantId,
        dependencyId,
        taskId: dep.sourceTaskId,
        goalId: dep.sourceTask?.goalId,
        performedById: user.id,
        action: 'REWORK_REQUESTED',
        previousStatus: dep.status,
        newStatus: 'REWORK_REQUESTED',
        details: `Rework requested by ${user.name}: "${reworkReason.trim()}"`,
        meta: { reworkReason: reworkReason.trim() },
      },
    });

    // Notify Target Manager
    await pushNotification({
      tenantId,
      recipientId: dep.targetManagerId,
      type: 'task_update',
      title: 'Rework Requested on Dependency',
      body: `"${user.name}" requested rework on "${dep.title}": "${reworkReason.trim()}".`,
      entityType: 'task',
      entityId: dep.companionTaskId,
    });

    emitDependencyEvent(tenantId, 'dependency:rework-requested', updatedDep, [
      dep.requesterId,
      dep.targetManagerId,
    ]);

    return updatedDep;
  });
}

/**
 * Hard backend guard: checks whether a task has any active, unverified pre-dependencies.
 * Used before allowing status transitions to in_progress or done.
 */
export async function assertTaskDependenciesResolved(taskId, tenantId) {
  const blockingPreDep = await prisma.taskDependency.findFirst({
    where: {
      tenantId,
      sourceTaskId: taskId,
      dependencyType: 'pre',
      status: { notIn: ['VERIFIED', 'CANCELLED'] },
    },
    select: {
      id: true,
      title: true,
      status: true,
      targetManager: { select: { name: true } },
    },
  });

  if (blockingPreDep) {
    throw new Error(
      `Task is blocked: Pre-requisite dependency "${blockingPreDep.title}" (assigned to ${blockingPreDep.targetManager?.name}) is currently ${blockingPreDep.status} and must be VERIFIED before this task can start or complete.`
    );
  }
}

/**
 * Query pending approval requests for a user (target manager or dept head).
 */
export async function getPendingApprovals(tenantId, userId) {
  return prisma.taskDependency.findMany({
    where: {
      tenantId,
      OR: [
        { targetManagerId: userId, status: 'PENDING_APPROVAL' },
        { deptHeadId: userId, status: 'DEPT_HEAD_REVIEWING' },
      ],
    },
    include: {
      requester: { select: { id: true, name: true, email: true, department: true } },
      targetManager: { select: { id: true, name: true, email: true, department: true } },
      sourceTask: { select: { id: true, title: true, priority: true, dueDate: true, goalId: true } },
      companionTask: { select: { id: true, status: true, dueDate: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Query all dependencies for a task.
 */
export async function getTaskDependencies(taskId, tenantId) {
  return prisma.taskDependency.findMany({
    where: { sourceTaskId: taskId, tenantId },
    include: {
      requester: { select: { id: true, name: true } },
      targetManager: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      rejectedBy: { select: { id: true, name: true } },
      verifiedBy: { select: { id: true, name: true } },
      companionTask: { select: { id: true, status: true, progress: true, dueDate: true, assigneeIds: true } },
      auditLogs: {
        include: { performedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

