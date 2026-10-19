import { prisma } from '../lib/prisma.js';
import { emitToTenant, emitToUser } from '../lib/socket.js';
import { ELEVATED_ROLES, HR_ROLES, MANAGER_OR_ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { sendGoalSubmissionEmail, sendGoalReviewResultEmail } from './goalEscalation.service.js';

export const GOAL_CATEGORIES = [
  'Technical Skills',
  'Leadership & Management',
  'Communication & Collaboration',
  'Learning & Development',
  'Performance & Delivery',
  'Business Operations',
  'Compliance & Security',
  'Product Innovation',
  'Handover / Exit Tasks',
  'General',
];

export const GOAL_TYPES = [
  'General',
  'KPI',
  'OKR',
  'Development',
  'Performance',
  'Project Deliverable',
];

export const GOAL_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// ── Status constants ────────────────────────────────────────────────────────
// Employee self-created flow:               DRAFT → PENDING_MANAGER_REVIEW → PENDING_HR_REVIEW → COMPLETED
// Elevated/Manager + MANAGER_APPROVAL flow:  PENDING_APPROVAL → ACTIVE → (tasks) → PENDING_MANAGER_REVIEW → PENDING_HR_REVIEW → COMPLETED
// Elevated/Manager + AUTO_APPROVE flow:      ACTIVE → (tasks) → PENDING_MANAGER_REVIEW → PENDING_HR_REVIEW → COMPLETED
export const GOAL_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  PENDING_MANAGER_REVIEW: 'PENDING_MANAGER_REVIEW',
  PENDING_HR_REVIEW: 'PENDING_HR_REVIEW',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  COMPLETED: 'COMPLETED',
  // Legacy aliases (preserved for backward compat with existing records)
  REJECTED: 'rejected',
  SUBMITTED: 'submitted',
  READY_FOR_SUBMISSION: 'READY_FOR_SUBMISSION',
  IN_PROGRESS: 'in_progress',
};

// ── Multi-assignee roll-up ──────────────────────────────────────────────────
// A goal can carry several GoalAssignment rows, one per assignee, each with its
// own tasks and its own position in the workflow. Goal.status is a summary of
// those rows — never a copy of whichever row was touched last. Writing one
// assignee's new status straight onto the parent is what used to mark a goal
// COMPLETED while a co-assignee was still sitting in PENDING_HR_REVIEW.
const STATUS_RANK = {
  CHANGES_REQUESTED: 0,
  REJECTED: 0,
  DRAFT: 1,
  PENDING_APPROVAL: 2,
  ACTIVE: 3,
  IN_PROGRESS: 3,
  ASSIGNED: 3,
  ACKNOWLEDGED: 3,
  READY_FOR_SUBMISSION: 4,
  SUBMITTED: 5,
  UNDER_REVIEW: 5,
  PENDING_MANAGER_REVIEW: 5,
  PENDING_HR_REVIEW: 6,
  COMPLETED: 7,
};

// Legacy records store some of these lower-cased ('rejected', 'in_progress'),
// so rank on the upper-cased form. Anything unrecognised ranks as DRAFT, which
// holds the parent back rather than letting it race ahead to COMPLETED.
const rankOf = (status) => {
  const key = String(status || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, key) ? STATUS_RANK[key] : STATUS_RANK.DRAFT;
};

/**
 * The parent status of a goal is its least-advanced assignment: the goal is
 * COMPLETED only once every assignee is, and one assignee with changes
 * requested holds the whole goal back. Goals with no assignment rows (the
 * legacy single-employee shape) keep the status passed in.
 */
export function rollUpGoalStatus(assignments, fallbackStatus) {
  const rows = (assignments || []).filter((a) => a && a.status);
  if (rows.length === 0) return fallbackStatus;
  return rows.reduce((lowest, a) => (rankOf(a.status) < rankOf(lowest.status) ? a : lowest), rows[0]).status;
}

/** Parent progress is the mean of the assignees' progress, for the same reason. */
export function rollUpGoalProgress(assignments, fallbackProgress) {
  const rows = (assignments || []).filter(Boolean);
  if (rows.length === 0) return fallbackProgress;
  return Math.round(rows.reduce((sum, a) => sum + (Number(a.progress) || 0), 0) / rows.length);
}

const isOneOf = (status, allowed) => allowed.includes(String(status || '').trim().toUpperCase());

/** Awaiting a manager's post-submission review. */
const MANAGER_REVIEWABLE = ['PENDING_MANAGER_REVIEW', 'SUBMITTED'];
/** Awaiting HR's final sign-off. HR can also act on a goal still sitting with a manager. */
const HR_REVIEWABLE = ['PENDING_HR_REVIEW', 'PENDING_MANAGER_REVIEW', 'SUBMITTED'];

// Statuses that allow employees to work on tasks
export const WORKABLE_STATUSES = new Set([
  'DRAFT',
  'ACTIVE',
  'READY_FOR_SUBMISSION',
  'CHANGES_REQUESTED',
  'in_progress',
  'rejected',
]);

export class GoalService {
  /**
   * Helper: Push notification and real-time Socket.IO event.
   */
  async notify({ tenantId, recipientId, type, title, body, entityType, entityId }) {
    if (!recipientId || recipientId === 'system' || !tenantId) return null;
    try {
      const notif = await prisma.notification.create({
        data: {
          tenantId,
          recipientId,
          type: type || 'goal_update',
          title,
          body: body || null,
          entityType: entityType || 'goal',
          entityId: entityId || null,
        },
      });
      emitToUser(tenantId, recipientId, 'notification', notif);
      return notif;
    } catch (err) {
      console.warn('[GoalService] Failed to push notification:', err.message);
      return null;
    }
  }

  /**
   * Helper: Log a Goal Audit event.
   */
  async logAudit({ goalId, performedById, action, details, previousValue }) {
    try {
      return await prisma.goalAuditLog.create({
        data: {
          goalId,
          performedById,
          action,
          details: details || null,
          previousValue: previousValue || undefined,
        },
      });
    } catch (err) {
      console.warn('[GoalService] Failed to create audit log:', err.message);
      return null;
    }
  }

  /**
   * Central authorization check for a single goal.
   *
   * Access is granted when the caller is:
   *  - an elevated role (SUPER_ADMIN / ADMIN / CMD / HR)
   *  - the goal's primary employee OR any assignee
   *  - the person who created the goal (matched by id, with a name fallback for
   *    legacy rows created before `createdById` existed)
   *  - a manager anywhere up the reporting chain of the primary employee or any
   *    assignee
   *
   * @param {{ id, employeeId, createdById, createdBy, assignments? }} goal
   * @returns {Promise<boolean>}
   */
  /**
   * Which assignees a review action applies to.
   *
   * The Approve buttons on the goal card are goal-level — they sign off the
   * goal, not one row of it — and send no targetEmployeeId. Acting on a single
   * arbitrary assignment there left co-assignees stranded in review while the
   * goal read COMPLETED, so with no explicit target every assignee currently
   * awaiting this stage is reviewed together. An explicit targetEmployeeId
   * still scopes the action to that one person.
   */
  resolveReviewTargets(goal, targetEmployeeId, reviewableStatuses, stageLabel) {
    const rows = goal.assignments || [];
    const explicit = targetEmployeeId && rows.some((a) => a.employeeId === targetEmployeeId)
      ? targetEmployeeId
      : null;

    if (explicit) {
      const row = rows.find((a) => a.employeeId === explicit);
      if (!isOneOf(row.status, reviewableStatuses)) {
        throw { status: 400, message: `Goal is not currently awaiting ${stageLabel} (Status: ${row.status})` };
      }
      return [explicit];
    }

    if (rows.length > 0) {
      const pending = rows.filter((a) => isOneOf(a.status, reviewableStatuses)).map((a) => a.employeeId);
      if (pending.length === 0) {
        const summary = rollUpGoalStatus(rows, goal.status);
        throw { status: 400, message: `Goal is not currently awaiting ${stageLabel} (Status: ${summary})` };
      }
      return pending;
    }

    // Legacy goal with no assignment rows: fall back to the single employee.
    if (!isOneOf(goal.status, reviewableStatuses)) {
      throw { status: 400, message: `Goal is not currently awaiting ${stageLabel} (Status: ${goal.status})` };
    }
    return [goal.employeeId].filter(Boolean);
  }

  /**
   * Re-reads the assignment rows after they have been mutated and rolls them up
   * onto the parent goal, so the parent always reflects every assignee.
   */
  async rolledUpParentData(goalId, fallbackStatus, fallbackProgress) {
    const rows = await prisma.goalAssignment.findMany({
      where: { goalId },
      select: { status: true, progress: true },
    });
    return {
      status: rollUpGoalStatus(rows, fallbackStatus),
      progress: rollUpGoalProgress(rows, fallbackProgress),
    };
  }

  async canAccessGoal(goal, user, tenantId) {
    if (!goal) return false;
    if (hasRole(user.role, ELEVATED_ROLES)) return true;

    if (goal.employeeId === user.id) return true;
    if (goal.ownerManagerId && goal.ownerManagerId === user.id) return true;
    if (goal.createdById && goal.createdById === user.id) return true;
    if (!goal.createdById && goal.createdBy && goal.createdBy === user.name) return true;

    let assignments = goal.assignments;
    if (!assignments) {
      assignments = await prisma.goalAssignment.findMany({
        where: { goalId: goal.id },
        select: { employeeId: true },
      });
    }
    if (assignments.some((a) => a.employeeId === user.id)) return true;

    const targets = new Set(assignments.map((a) => a.employeeId));
    if (goal.employeeId) targets.add(goal.employeeId);
    for (const targetId of targets) {
      if (await this.isSubordinate(user.id, targetId, tenantId)) return true;
    }

    // A line manager's reach.
    //
    // This used to stop at the managerId chain, while listGoals and createGoal
    // have always used a wider rule: subordinate, OR same department, OR the
    // person has no explicit manager. The result was a manager who could SEE a
    // goal in their list and APPROVE it, but got 403 trying to edit it — and
    // with 15 of 16 employees having no manager set, that was most goals.
    // Matching the rule the rest of the module already applies.
    if (String(user.role || '').toUpperCase() === 'MANAGER') {
      const caller = await prisma.tenantUser.findUnique({
        where: { id: user.id }, select: { department: true },
      });
      for (const targetId of targets) {
        const target = await prisma.tenantUser.findFirst({
          where: { id: targetId, tenantId },
          select: { role: true, department: true, managerId: true },
        });
        if (!target) continue;
        // Never a peer manager or anyone above — the same guard listGoals uses.
        if (hasRole(target.role, MANAGER_OR_ELEVATED_ROLES)) continue;
        const sameDept = caller?.department && target.department === caller.department;
        if (sameDept || !target.managerId) return true;
      }
    }

    return false;
  }

  /**
   * Check if managerId is an ancestor / direct manager of targetId.
   */
  async isSubordinate(managerId, targetId, tenantId) {
    if (managerId === targetId) return true;
    let current = await prisma.tenantUser.findFirst({
      where: { id: targetId, tenantId },
    });
    const visited = new Set([targetId]);
    while (current && current.managerId && !visited.has(current.managerId)) {
      visited.add(current.managerId);
      if (current.managerId === managerId) {
        return true;
      }
      current = await prisma.tenantUser.findFirst({
        where: { id: current.managerId, tenantId },
      });
    }
    return false;
  }

  /**
   * Recalculates goal progress from its linked tasks for a specific employee or across all tasks.
   * Automatically transitions status to READY_FOR_SUBMISSION when all tasks are complete, or IN_PROGRESS when tasks are underway.
   */
  async recalculateProgress(goalId, employeeId = null) {
    if (!goalId) return 0;

    const allGoalTasks = await prisma.task.findMany({ where: { goalId } });
    const empTasks = employeeId
      ? allGoalTasks.filter(t => !t.employeeId || t.employeeId === employeeId || (Array.isArray(t.assigneeIds) && t.assigneeIds.includes(employeeId)))
      : allGoalTasks;

    const calcEarned = (tasks) => tasks.reduce((sum, t) => {
      if (t.managerFinalWeight !== null && t.managerFinalWeight !== undefined) {
        return sum + Number(t.managerFinalWeight);
      }
      const w = Number(t.weight || 1);
      const p = Math.min(100, Math.max(0, Number(t.progress || 0)));
      return sum + ((w * p) / 100);
    }, 0);

    const totalWeight = empTasks.reduce((sum, t) => sum + Number(t.weight || 1), 0);
    const earned = calcEarned(empTasks);
    const empProgress = totalWeight > 0 ? Math.min(100, Math.round((earned / totalWeight) * 100)) : 0;
    const empCompletedCount = empTasks.filter(t => t.status === 'done' || t.progress === 100).length;

    // Update specific GoalAssignment if employeeId is specified
    if (employeeId) {
      try {
        const currentAssignment = await prisma.goalAssignment.findFirst({
          where: { goalId, employeeId },
        });

        let assignmentStatus = currentAssignment?.status || 'DRAFT';
        if (['DRAFT', 'IN_PROGRESS', 'READY_FOR_SUBMISSION'].includes(assignmentStatus)) {
          if (empTasks.length > 0 && (empCompletedCount === empTasks.length || empProgress === 100)) {
            assignmentStatus = 'READY_FOR_SUBMISSION';
          } else if (empProgress > 0) {
            assignmentStatus = 'IN_PROGRESS';
          } else if (empProgress === 0 && assignmentStatus === 'IN_PROGRESS') {
            assignmentStatus = 'DRAFT';
          }
        }

        await prisma.goalAssignment.updateMany({
          where: { goalId, employeeId },
          data: {
            progress: empProgress,
            status: assignmentStatus,
            milestones: empTasks.length,
            completedMilestones: empCompletedCount,
          },
        });
      } catch (err) {
        console.warn('[GoalService] Notice updating goal assignment progress:', err.message);
      }
    }

    // Recalculate overall goal progress across all tasks
    const totalAllWeight = allGoalTasks.reduce((sum, t) => sum + Number(t.weight || 1), 0);
    const earnedAll = calcEarned(allGoalTasks);
    const overallProgress = totalAllWeight > 0 ? Math.min(100, Math.round((earnedAll / totalAllWeight) * 100)) : 0;
    const allCompletedCount = allGoalTasks.filter(t => t.status === 'done' || t.progress === 100).length;

    const goal = await prisma.goal.findUnique({ where: { id: goalId } });
    if (goal) {
      let goalStatus = goal.status || 'DRAFT';
      if (['DRAFT', 'IN_PROGRESS', 'READY_FOR_SUBMISSION'].includes(goalStatus)) {
        if (allGoalTasks.length > 0 && (allCompletedCount === allGoalTasks.length || overallProgress === 100)) {
          goalStatus = 'READY_FOR_SUBMISSION';
        } else if (overallProgress > 0) {
          goalStatus = 'IN_PROGRESS';
        } else if (overallProgress === 0 && goalStatus === 'IN_PROGRESS') {
          goalStatus = 'DRAFT';
        }
      }

      await prisma.goal.update({
        where: { id: goalId },
        data: {
          progress: overallProgress,
          status: goalStatus,
          milestones: allGoalTasks.length,
          completedMilestones: allCompletedCount,
        },
      });
    }

    return overallProgress;
  }

  // ─── WORKFLOW ACTION: Activate/Approve a PENDING_APPROVAL goal ──────────────────
  /**
   * Transitions a goal created by an elevated role or manager from
   * PENDING_APPROVAL → ACTIVE.
   *
   * Who can call this:
   *  - The goal-owner's direct reporting manager
   *  - HR / SUPER_ADMIN / ADMIN / CMD (elevated roles)
   *  - The creator of the goal (assignedById match)
   *
   * Flow: Elevated role or Manager + MANAGER_APPROVAL mode
   *   Goal created → PENDING_APPROVAL → [this action] → ACTIVE
   */
  async activateGoal({ tenantId, goalId, user, comment }) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      include: {
        employee: {
          select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true },
        },
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
            assignedBy: { select: { id: true, name: true, role: true } },
          },
        },
        tasks: true,
      },
    });

    if (!goal) {
      throw { status: 404, message: 'Goal not found' };
    }

    if (goal.status !== GOAL_STATUS.PENDING_APPROVAL) {
      throw {
        status: 400,
        message: `Goal cannot be activated from current status: "${goal.status}". Only PENDING_APPROVAL goals can be activated.`,
      };
    }

    // Authorization: Goal Owner, Reporting manager, elevated role (HR/Admin/Leadership), goal creator, or Manager role
    const isElevated = hasRole(user.role, ELEVATED_ROLES);
    const isGoalOwner = Boolean(goal.ownerManagerId && goal.ownerManagerId === user.id);
    const isDirectManager =
      goal.employee?.managerId === user.id ||
      goal.assignments?.some((a) => a.employee?.managerId === user.id);
    const isCreator =
      (goal.createdById && goal.createdById === user.id) ||
      (!goal.createdById && goal.createdBy && goal.createdBy === user.name);
    const isAssignedBy = goal.assignments?.some((a) => a.assignedById === user.id);
    const isManagerRole = String(user.role || '').toUpperCase() === 'MANAGER';
    const isSubordinate = goal.employeeId ? await this.isSubordinate(user.id, goal.employeeId, tenantId) : false;

    // Nobody signs off their own goal.
    //
    // `isCreator` and `isAssignedBy` are here for the manager-assigned flow,
    // where the person who raised the goal is not the person who has to do it.
    // An employee proposing their own goal is BOTH, so without this check the
    // approval step would be one they could click for themselves — which is
    // the same as having no approval step at all.
    //
    // A regular employee proposing their own goal is prevented from self-approving.
    // Goal Owner, elevated roles (HR/Admin/Super Admin/CMD) and Managers activating team goals
    // or goals they created/manage are authorized.
    const isOwnGoal = goal.employeeId === user.id
      || goal.assignments?.some((a) => a.employeeId === user.id);
    if (isOwnGoal && !isElevated && !isGoalOwner && !(isManagerRole && (isCreator || isAssignedBy || (goal.assignments && goal.assignments.length > 1)))) {
      throw {
        status: 403,
        code: 'SELF_APPROVAL_FORBIDDEN',
        message: 'You cannot approve your own goal. It needs a manager or HR to activate it.',
      };
    }

    const isAuthorized = isElevated || isGoalOwner || isDirectManager || isCreator || isAssignedBy || isManagerRole || isSubordinate;
    if (!isAuthorized) {
      throw {
        status: 403,
        message: 'Access forbidden: only the goal owner, manager, or HR/Admin can activate this goal',
      };
    }

    // Atomically activate goal and all its assignments
    await prisma.goalAssignment.updateMany({
      where: { goalId },
      data: { status: GOAL_STATUS.ACTIVE },
    });

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: { status: GOAL_STATUS.ACTIVE },
      include: {
        employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
        createdByUser: { select: { id: true, name: true, role: true } },
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
            assignedBy: { select: { id: true, name: true, role: true } },
          },
        },
        tasks: {
          orderBy: { createdAt: 'asc' },
          include: {
            employee: { select: { id: true, name: true } },
          },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          include: { performedBy: { select: { id: true, name: true, role: true } } },
        },
      },
    });

    await this.logAudit({
      goalId,
      performedById: user.id,
      action: 'GOAL_ACTIVATED',
      details: `${user.name} activated goal "${goal.title}". Goal is now ACTIVE — tasks are workable.${comment ? ` Note: "${comment}"` : ''}`,
      previousValue: { status: goal.status },
    });

    // Notify all assignees
    const recipientIds = new Set();
    if (goal.employeeId) recipientIds.add(goal.employeeId);
    if (goal.assignments) {
      goal.assignments.forEach((a) => {
        if (a.employeeId) recipientIds.add(a.employeeId);
      });
    }

    for (const recipientId of recipientIds) {
      if (recipientId === user.id) continue;
      await this.notify({
        tenantId,
        recipientId,
        type: 'goal_update',
        title: `Goal Activated: "${goal.title}"`,
        body: `Your goal has been activated and is now ACTIVE. You can work on and complete tasks now.`,
        entityType: 'goal',
        entityId: goal.id,
      });
    }

    emitToTenant(tenantId, 'goal_updated', { action: 'update', goalId: goal.id, goal: updated });

    return updated;
  }

  // ─── WORKFLOW ACTION: Submit goal for manager/HR review ────────────────────
  /**
   * Employee submits completed goal for review.
   *
   * Allowed from:
   *  - DRAFT                (employee self-created → existing flow)
   *  - ACTIVE               (manager-created goal, tasks all done)
   *  - READY_FOR_SUBMISSION (legacy alias)
   *  - CHANGES_REQUESTED    (after corrections)
   *  - in_progress / rejected (legacy aliases)
   *
   * Result: PENDING_MANAGER_REVIEW (if has manager) or PENDING_HR_REVIEW
   */
  async submitGoal({ tenantId, goalId, user }) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      include: {
        employee: {
          select: { id: true, name: true, email: true, managerId: true },
        },
        assignments: {
          include: {
            employee: {
              select: { id: true, name: true, email: true, managerId: true },
            },
          },
        },
        tasks: true,
      },
    });

    if (!goal) {
      throw { status: 404, message: 'Goal not found' };
    }

    const userAssignment = goal.assignments?.find(a => a.employeeId === user.id);
    const isAssignee = goal.employeeId === user.id || Boolean(userAssignment);
    const isElevated = hasRole(user.role, ELEVATED_ROLES);
    const isGoalOwner = Boolean(
      (goal.ownerManagerId && goal.ownerManagerId === user.id) ||
      (goal.ownerId && goal.ownerId === user.id)
    );
    const isManagerRole = String(user.role || '').toUpperCase() === 'MANAGER';
    let isManagerOfAssignee = false;
    if (isManagerRole) {
      if (goal.employeeId && await this.isSubordinate(user.id, goal.employeeId, tenantId)) isManagerOfAssignee = true;
      if (userAssignment?.employeeId && await this.isSubordinate(user.id, userAssignment.employeeId, tenantId)) isManagerOfAssignee = true;
    }

    if (!isAssignee && !isElevated && !isGoalOwner && !isManagerRole && !isManagerOfAssignee) {
      throw { status: 403, message: 'Access forbidden: only the goal assignee, goal owner, or manager can submit this goal for review' };
    }

    // PENDING_APPROVAL goals cannot be submitted — must be activated first
    if (goal.status === GOAL_STATUS.PENDING_APPROVAL) {
      throw {
        status: 400,
        message: 'This goal is awaiting manager activation. It cannot be submitted until it becomes ACTIVE.',
      };
    }

    const targetEmpId = userAssignment?.employeeId || goal.employeeId || goal.assignments?.[0]?.employeeId || user.id;
    const currentStatus = (userAssignment ? userAssignment.status : goal.status) || 'DRAFT';
    const allowedStatuses = [
      GOAL_STATUS.DRAFT,
      GOAL_STATUS.ACTIVE,
      GOAL_STATUS.READY_FOR_SUBMISSION,
      GOAL_STATUS.CHANGES_REQUESTED,
      GOAL_STATUS.IN_PROGRESS,
      GOAL_STATUS.REJECTED,
      'DRAFT', 'ACTIVE', 'READY_FOR_SUBMISSION', 'CHANGES_REQUESTED', 'IN_PROGRESS', 'REJECTED'
    ];
    if (!allowedStatuses.includes(currentStatus)) {
      throw { status: 400, message: `Goal cannot be submitted from current status: "${currentStatus}"` };
    }

    // Validate that tasks exist for this target employee and are completed
    const myTasks = (goal.tasks || []).filter(t => !t.employeeId || t.employeeId === targetEmpId || t.employeeId === user.id);
    if (myTasks.length === 0) {
      throw { status: 400, message: 'Cannot submit goal: at least one task/milestone must be added to this goal.' };
    }

    const incompleteTasks = myTasks.filter(t => t.status !== 'done' && (Number(t.progress) || 0) < 100);
    if (incompleteTasks.length > 0) {
      throw {
        status: 400,
        message: `Cannot submit goal: ${incompleteTasks.length} task(s) are still incomplete. Complete all required tasks before submitting.`,
      };
    }

    const targetUser = userAssignment?.employee || goal.assignments?.find(a => a.employeeId === targetEmpId)?.employee || goal.employee;
    const tenantManagers = await prisma.tenantUser.findMany({
      where: { tenantId, role: 'MANAGER', status: 'ACTIVE', isDeleted: false },
      select: { id: true, name: true },
    });

    // All completed employee submissions route to Level 1: PENDING_MANAGER_REVIEW
    const newStatus = GOAL_STATUS.PENDING_MANAGER_REVIEW;

    await prisma.goalAssignment.updateMany({
      where: { goalId, employeeId: targetEmpId },
      data: {
        status: newStatus,
        progress: 100,
      },
    });

    // Only this assignee submitted. Roll the parent up rather than declaring the
    // whole goal submitted on their behalf.
    const parentData = await this.rolledUpParentData(goalId, newStatus, 100);

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: parentData,
      include: {
        employee: true,
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
            assignedBy: { select: { id: true, name: true, role: true } },
          },
        },
        tasks: true,
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          include: { performedBy: { select: { id: true, name: true, role: true } } },
        },
      },
    });

    await this.logAudit({
      goalId,
      performedById: user.id,
      action: 'GOAL_SUBMITTED',
      details: `${user.name} submitted goal for review.`,
      previousValue: { status: currentStatus },
    });

    // Notify Manager or HR
    const managerIdToNotify = targetUser?.managerId || goal.ownerManagerId;
    if (managerIdToNotify && managerIdToNotify !== user.id) {
      const managerUser = await prisma.tenantUser.findUnique({
        where: { id: managerIdToNotify },
        select: { id: true, name: true, email: true },
      });

      await this.notify({
        tenantId,
        recipientId: managerIdToNotify,
        type: 'goal_update',
        title: `Goal Submitted for Review: "${goal.title}"`,
        body: `${user.name} has completed all tasks and submitted "${goal.title}" for your review.`,
        entityType: 'goal',
        entityId: goal.id,
      });

      if (managerUser?.email) {
        sendGoalSubmissionEmail({
          tenantId,
          goal,
          submitterUser: user,
          managerUser,
        }).catch((err) => console.warn('[GoalService] Email notification notice:', err.message));
      }
    } else {
      const eligibleManagers = (tenantManagers || []).filter((m) => m.id !== user.id);
      if (eligibleManagers.length > 0 && String(user.role || '').toUpperCase() !== 'MANAGER') {
        for (const mgr of eligibleManagers) {
          await this.notify({
            tenantId,
            recipientId: mgr.id,
            type: 'goal_update',
            title: `Goal Submitted for Manager Review: "${goal.title}"`,
            body: `${user.name} has completed tasks and submitted "${goal.title}" for manager review.`,
            entityType: 'goal',
            entityId: goal.id,
          });

          const mgrUser = await prisma.tenantUser.findUnique({
            where: { id: mgr.id },
            select: { id: true, name: true, email: true },
          });
          if (mgrUser?.email) {
            sendGoalSubmissionEmail({
              tenantId,
              goal,
              submitterUser: user,
              managerUser: mgrUser,
            }).catch((err) => console.warn('[GoalService] Email notification notice:', err.message));
          }
        }
      } else {
        const hrUsers = await prisma.tenantUser.findMany({
          where: { tenantId, role: { in: HR_ROLES } },
          select: { id: true, name: true, email: true },
        });
        for (const hr of hrUsers) {
          await this.notify({
            tenantId,
            recipientId: hr.id,
            type: 'goal_update',
            title: `Goal Submitted for HR Review: "${goal.title}"`,
            body: `${user.name} submitted "${goal.title}" for review.`,
            entityType: 'goal',
            entityId: goal.id,
          });

          if (hr.email) {
            sendGoalSubmissionEmail({
              tenantId,
              goal,
              submitterUser: user,
              managerUser: hr,
            }).catch((err) => console.warn('[GoalService] Email notification notice:', err.message));
          }
        }
      }
    }

    emitToTenant(tenantId, 'goal_updated', { action: 'update', goalId: goal.id, goal: updated });

    return updated;
  }

  // ─── WORKFLOW ACTION: Manager reviews submitted goal ───────────────────────
  /**
   * Manager reviews a goal (Approve or Request Changes).
   * This is the POST-SUBMISSION review (not the initial activation).
   *
   * APPROVE → PENDING_HR_REVIEW
   * REJECT  → CHANGES_REQUESTED
   */
  async managerReview({ tenantId, goalId, user, action, comment, rating, targetEmployeeId = null }) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      include: {
        employee: true,
        assignments: {
          include: {
            employee: true,
          },
        },
        tasks: true,
      },
    });

    if (!goal) {
      throw { status: 404, message: 'Goal not found' };
    }

    const isApprove = action === 'APPROVE';

    // A manager can DECLINE a goal an employee has proposed, as well as reject
    // completed work. Approving is deliberately not widened the same way:
    // approving a PENDING_APPROVAL goal means activating it, which is
    // /activate-approve. Sending it to PENDING_HR_REVIEW from here would skip
    // the work entirely.
    const reviewable = isApprove
      ? MANAGER_REVIEWABLE
      : [...MANAGER_REVIEWABLE, GOAL_STATUS.PENDING_APPROVAL];

    const rawTargets = this.resolveReviewTargets(goal, targetEmployeeId, reviewable, 'manager review');

    const isElevated = hasRole(user.role, ELEVATED_ROLES);
    const isCallerManager = String(user.role || '').toUpperCase() === 'MANAGER';
    const createdByCaller = (goal.createdById && goal.createdById === user.id)
      || (!goal.createdById && goal.createdBy && goal.createdBy === user.name);

    // If caller is NOT elevated, they cannot self-approve their own assignment.
    // Filter caller out so managers can approve their downline assignees on shared team goals,
    // while their own assignment requires sign-off from their reporting manager or HR/Admin.
    let reviewedEmpIds = rawTargets;
    if (!isElevated && rawTargets.includes(user.id)) {
      if (rawTargets.length === 1 && rawTargets[0] === user.id) {
        throw { status: 403, message: 'You cannot review or approve your own goal submission. An elevated role (HR/Admin) or your reporting manager must review it.' };
      }
      reviewedEmpIds = rawTargets.filter((id) => id !== user.id);
    }

    if (reviewedEmpIds.length === 0) {
      throw { status: 400, message: 'No eligible submissions pending manager review.' };
    }

    // Check manager authorization for the employees being reviewed
    if (!isElevated && !createdByCaller) {
      let anyAuthorized = false;

      for (const targetEmpId of reviewedEmpIds) {
        const isAssignedByCaller = goal.assignments?.some((a) => a.employeeId === targetEmpId && a.assignedById === user.id);
        const isReportingManager = await this.isSubordinate(user.id, targetEmpId, tenantId);
        const isManagerReviewingOther = isCallerManager;

        if (isAssignedByCaller || isReportingManager || isManagerReviewingOther) {
          anyAuthorized = true;
          break;
        }
      }

      if (!anyAuthorized) {
        throw { status: 403, message: 'Access forbidden: you are not authorized to review this goal as manager' };
      }
    }
    const newStatus = isApprove ? GOAL_STATUS.COMPLETED : GOAL_STATUS.CHANGES_REQUESTED;

    if (isApprove) {
      const completedTasks = goal.tasks.filter((task) => {
        if (!reviewedEmpIds.includes(task.employeeId) || task.isStandalone || task.isPrivate) return false;
        // Nobody can rate their own task, so a self-review has nothing to rate.
        if (task.employeeId === user.id) return false;
        const taskStatus = String(task.status || '').toLowerCase();
        return ['done', 'completed'].includes(taskStatus) || Number(task.progress) >= 100;
      });
      const unratedTasks = completedTasks.filter((task) =>
        task.managerRating === null || task.managerRating === undefined
      );

      if (unratedTasks.length > 0) {
        throw {
          status: 409,
          message: `Rate all ${unratedTasks.length} completed task${unratedTasks.length === 1 ? '' : 's'} before approving.`,
        };
      }
    }

    if (isApprove && reviewedEmpIds.length > 0) {
      await prisma.task.updateMany({
        where: {
          goalId,
          employeeId: { in: reviewedEmpIds },
          progress: 100,
          status: { in: ['todo', 'in_progress', 'in_review', 'completed'] },
        },
        data: { status: 'done' },
      });
    }

    if (reviewedEmpIds.length > 0) {
      const assignmentUpdateData = isApprove
        ? { status: newStatus, progress: 100 }
        : { status: newStatus };
      if (rating !== undefined && rating !== null) {
        assignmentUpdateData.managerRating = Number(rating);
      }
      await prisma.goalAssignment.updateMany({
        where: { goalId, employeeId: { in: reviewedEmpIds } },
        data: assignmentUpdateData,
      });
    }

    const parentData = await this.rolledUpParentData(goalId, newStatus, isApprove ? 100 : goal.progress);

    const goalUpdateData = {
      ...parentData,
      specialNotes: comment ? `Manager Note: ${comment}` : goal.specialNotes,
    };
    if (isApprove) {
      goalUpdateData.closedAt = new Date();
      goalUpdateData.closedById = user.id;
    }
    if (rating !== undefined && rating !== null) {
      goalUpdateData.managerRating = Number(rating);
    }
    if (comment) {
      goalUpdateData.managerRatingNotes = comment;
    }

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: goalUpdateData,
      include: {
        employee: true,
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
          },
        },
        tasks: true,
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          include: { performedBy: { select: { id: true, name: true, role: true } } },
        },
      },
    });

    await this.logAudit({
      goalId,
      performedById: user.id,
      action: isApprove ? 'MANAGER_APPROVED' : 'CHANGES_REQUESTED',
      details: isApprove
        ? `Manager ${user.name} approved and completed goal.${comment ? ` Remark: "${comment}"` : ''}${rating ? ` Rating: ${rating}/5` : ''}`
        : `Manager ${user.name} requested changes. Reason: "${comment}"`,
      previousValue: { status: goal.status },
    });

    // Notify every assignee whose submission was actually reviewed.
    for (const empId of reviewedEmpIds) {
      await this.notify({
        tenantId,
        recipientId: empId,
        type: 'goal_update',
        title: isApprove ? `Goal Approved & Completed: "${goal.title}"` : `Revisions Requested: "${goal.title}"`,
        body: isApprove
          ? `Manager ${user.name} approved your goal and marked it COMPLETED.`
          : `Manager ${user.name} requested revisions: "${comment || 'Please update tasks'}"`,
        entityType: 'goal',
        entityId: goal.id,
      });

      const recipientUser = await prisma.tenantUser.findUnique({
        where: { id: empId },
        select: { id: true, name: true, email: true },
      });
      if (recipientUser?.email) {
        sendGoalReviewResultEmail({
          tenantId,
          goal,
          reviewerUser: user,
          action,
          comment,
          recipientUser,
          stage: 'manager',
        }).catch((err) => console.warn('[GoalService] Email notice:', err.message));
      }
    }

    // If Manager Approved → notify HR for supervisory governance oversight
    if (isApprove) {
      const nameFor = (id) =>
        goal.assignments?.find((a) => a.employeeId === id)?.employee?.name
        || (goal.employee?.id === id ? goal.employee?.name : null)
        || 'an employee';
      const reviewedNames = reviewedEmpIds.length === 1
        ? `${nameFor(reviewedEmpIds[0])}'s goal`
        : `${reviewedEmpIds.length} assignees' goal`;
      const hrUsers = await prisma.tenantUser.findMany({
        where: { tenantId, role: { in: HR_ROLES } },
        select: { id: true },
      });
      for (const hr of hrUsers) {
        await this.notify({
          tenantId,
          recipientId: hr.id,
          type: 'goal_update',
          title: `Goal Approved by Manager: "${goal.title}"`,
          body: `Manager ${user.name} approved ${reviewedNames}. Elevated roles have supervisory governance to review or request revisions if needed.`,
          entityType: 'goal',
          entityId: goal.id,
        });
      }
    }

    emitToTenant(tenantId, 'goal_updated', { action: 'update', goalId: goal.id, goal: updated });

    return updated;
  }

  // ─── WORKFLOW ACTION: HR final review ─────────────────────────────────────
  /**
   * HR final review for a goal.
   *
   * APPROVE → COMPLETED
   * REJECT  → CHANGES_REQUESTED
   */
  async hrReview({ tenantId, goalId, user, action, comment, rating, targetEmployeeId = null }) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      include: {
        employee: true,
        assignments: {
          include: {
            employee: true,
          },
        },
        tasks: true,
      },
    });

    if (!goal) {
      throw { status: 404, message: 'Goal not found' };
    }

    const isHR = hasRole(user.role, HR_ROLES);
    if (!isHR) {
      throw { status: 403, message: 'Access forbidden: HR authorization required for final sign-off' };
    }

    const isApprove = action === 'APPROVE';
    const reviewableStatuses = isApprove
      ? ['PENDING_HR_REVIEW', 'PENDING_MANAGER_REVIEW', 'SUBMITTED', 'ACTIVE']
      : ['PENDING_HR_REVIEW', 'PENDING_MANAGER_REVIEW', 'SUBMITTED', 'COMPLETED'];
    const reviewedEmpIds = this.resolveReviewTargets(goal, targetEmployeeId, reviewableStatuses, isApprove ? 'HR approval' : 'HR revision request');
    const newStatus = isApprove ? GOAL_STATUS.COMPLETED : GOAL_STATUS.CHANGES_REQUESTED;

    if (reviewedEmpIds.length > 0) {
      if (isApprove) {
        await prisma.task.updateMany({
          where: {
            goalId,
            employeeId: { in: reviewedEmpIds },
            progress: 100,
            status: { in: ['todo', 'in_progress', 'in_review', 'completed'] },
          },
          data: { status: 'done' },
        });
      }

      const assignmentData = isApprove ? { status: newStatus, progress: 100 } : { status: newStatus };
      if (isApprove && rating !== undefined && rating !== null) {
        assignmentData.finalScore = Number(rating);
      }
      await prisma.goalAssignment.updateMany({
        where: { goalId, employeeId: { in: reviewedEmpIds } },
        data: assignmentData,
      });
    }

    // The goal only becomes COMPLETED once every assignee is signed off; an
    // assignee who has not submitted yet keeps it in review.
    const parentData = await this.rolledUpParentData(goalId, newStatus, isApprove ? 100 : goal.progress);

    const goalUpdateData = {
      ...parentData,
      specialNotes: comment ? `HR Note: ${comment}` : goal.specialNotes,
    };
    if (isApprove) {
      goalUpdateData.closedAt = new Date();
      goalUpdateData.closedById = user.id;
    } else {
      goalUpdateData.closedAt = null;
      goalUpdateData.closedById = null;
    }

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: goalUpdateData,
      include: {
        employee: true,
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
          },
        },
        tasks: true,
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          include: { performedBy: { select: { id: true, name: true, role: true } } },
        },
      },
    });

    const isDirectManagerBypass = isApprove && (goal.status === GOAL_STATUS.PENDING_MANAGER_REVIEW || goal.status === 'SUBMITTED');
    await this.logAudit({
      goalId,
      performedById: user.id,
      action: isApprove ? 'HR_APPROVED' : 'HR_CHANGES_REQUESTED',
      details: isApprove
        ? `HR Partner ${user.name} approved ${reviewedEmpIds.length} assignee(s)${isDirectManagerBypass ? ' (Direct Approval - Bypassed Manager Review)' : ''}.${comment ? ` Remarks: "${comment}"` : ''}`
        : `HR Partner ${user.name} requested changes / vetoed ${reviewedEmpIds.length} assignee(s). Reason: "${comment}"`,
      previousValue: { status: goal.status },
    });

    // Notify every assignee HR just signed off — approving a shared goal from the
    // goal card clears all of them, so all of them hear about it.
    for (const empId of reviewedEmpIds) {
      await this.notify({
        tenantId,
        recipientId: empId,
        type: 'goal_update',
        title: isApprove ? `Goal Completed: "${goal.title}"` : `HR Requested Changes: "${goal.title}"`,
        body: isApprove
          ? `Congratulations! HR Partner ${user.name} officially approved and marked your goal "${goal.title}" as COMPLETED.`
          : `HR Partner ${user.name} requested changes: "${comment}"`,
        entityType: 'goal',
        entityId: goal.id,
      });

      const recipientUser = await prisma.tenantUser.findUnique({
        where: { id: empId },
        select: { id: true, name: true, email: true },
      });
      if (recipientUser?.email) {
        sendGoalReviewResultEmail({
          tenantId,
          goal,
          reviewerUser: user,
          action,
          comment,
          recipientUser,
          stage: 'hr',
        }).catch((err) => console.warn('[GoalService] Email notice:', err.message));
      }
    }

    emitToTenant(tenantId, 'goal_updated', { action: 'update', goalId: goal.id, goal: updated });

    return updated;
  }

  // ─── WORKFLOW ACTION: Resubmit after changes requested ────────────────────
  /**
   * Employee resubmits goal after corrections.
   *
   * Allowed from: CHANGES_REQUESTED | rejected (legacy alias)
   * Result: PENDING_MANAGER_REVIEW (if has manager) or PENDING_HR_REVIEW
   */
  async resubmitGoal({ tenantId, goalId, user, comment }) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      include: {
        employee: true,
        assignments: {
          include: {
            employee: true,
          },
        },
        tasks: true,
      },
    });

    if (!goal) {
      throw { status: 404, message: 'Goal not found' };
    }

    const userAssignment = goal.assignments?.find(a => a.employeeId === user.id);
    const isAssignee = goal.employeeId === user.id || Boolean(userAssignment);
    const isElevated = hasRole(user.role, ELEVATED_ROLES);

    if (!isAssignee && !isElevated) {
      throw { status: 403, message: 'Access forbidden: only the goal assignee can resubmit this goal' };
    }

    const targetAssignment = userAssignment;
    const currentStatus = targetAssignment?.status || goal.status;
    if (
      currentStatus !== GOAL_STATUS.CHANGES_REQUESTED &&
      currentStatus !== GOAL_STATUS.REJECTED &&
      currentStatus !== 'CHANGES_REQUESTED' &&
      currentStatus !== 'REJECTED'
    ) {
      throw { status: 400, message: `Goal is not in a revision state (Status: ${currentStatus})` };
    }

    const targetUser = userAssignment?.employee || goal.employee;
    const hasManager = Boolean(targetUser?.managerId);

    // A goal that was declined before it ever started is being RE-PROPOSED, so
    // it goes back to PENDING_APPROVAL for a manager to activate. Sending it to
    // PENDING_MANAGER_REVIEW — the review of finished work — would let an
    // employee walk an unapproved goal straight to HR sign-off with no work
    // done. "Never started" is read from the goal itself rather than trusted
    // from the request.
    const neverActivated = goal.approvalMode === 'MANAGER_APPROVAL'
      && Number(goal.progress || 0) === 0
      && !(goal.tasks || []).some((t) => String(t.status || 'todo') !== 'todo' || Number(t.progress || 0) > 0);

    const newStatus = neverActivated
      ? GOAL_STATUS.PENDING_APPROVAL
      : GOAL_STATUS.PENDING_MANAGER_REVIEW;

    await prisma.goalAssignment.updateMany({
      where: { goalId, employeeId: user.id },
      data: { status: newStatus },
    });

    const parentData = await this.rolledUpParentData(goalId, newStatus, goal.progress);

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: { status: parentData.status },
      include: {
        employee: true,
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true } },
          },
        },
        tasks: true,
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          include: { performedBy: { select: { id: true, name: true, role: true } } },
        },
      },
    });

    await this.logAudit({
      goalId,
      performedById: user.id,
      action: 'GOAL_RESUBMITTED',
      details: `${user.name} resubmitted goal after revising tasks.${comment ? ` Note: "${comment}"` : ''}`,
      previousValue: { status: goal.status },
    });

    // Notify Manager or HR
    if (hasManager && targetUser?.managerId) {
      await this.notify({
        tenantId,
        recipientId: targetUser.managerId,
        type: 'goal_update',
        title: `Goal Resubmitted: "${goal.title}"`,
        body: `${user.name} has updated and resubmitted "${goal.title}" for your review.`,
        entityType: 'goal',
        entityId: goal.id,
      });
    }

    emitToTenant(tenantId, 'goal_updated', { action: 'update', goalId: goal.id, goal: updated });

    return updated;
  }
}

export const goalService = new GoalService();
