import { prisma } from '../lib/prisma.js';
import { emitToTenant, emitToUser } from '../lib/socket.js';
import { ELEVATED_ROLES, HR_ROLES, hasRole } from '../lib/roles.js';

export const GOAL_CATEGORIES = [
  'Technical Skills',
  'Leadership & Management',
  'Communication & Collaboration',
  'Learning & Development',
  'Performance & Delivery',
  'Business Operations',
  'Compliance & Security',
  'Product Innovation',
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
    const empTasks = employeeId ? allGoalTasks.filter(t => !t.employeeId || t.employeeId === employeeId) : allGoalTasks;

    const totalWeight = empTasks.reduce((sum, t) => sum + Number(t.weight || 1), 0);
    const earned = empTasks.reduce((sum, t) => sum + (Number(t.progress || 0) * Number(t.weight || 1)), 0);
    const empProgress = totalWeight > 0 ? Math.min(100, Math.round(earned / totalWeight)) : 0;
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
    const earnedAll = allGoalTasks.reduce((sum, t) => sum + (Number(t.progress || 0) * Number(t.weight || 1)), 0);
    const overallProgress = totalAllWeight > 0 ? Math.min(100, Math.round(earnedAll / totalAllWeight)) : 0;
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

    // Authorization: Reporting manager, elevated role (HR/Admin/Leadership), goal creator, or Manager role
    const isElevated = hasRole(user.role, ELEVATED_ROLES);
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
    // A manager or elevated role is not caught by this: their own goals are
    // created as DRAFT and never reach PENDING_APPROVAL.
    const isOwnGoal = goal.employeeId === user.id
      || goal.assignments?.some((a) => a.employeeId === user.id);
    if (isOwnGoal) {
      throw {
        status: 403,
        code: 'SELF_APPROVAL_FORBIDDEN',
        message: 'You cannot approve your own goal. It needs a manager or HR to activate it.',
      };
    }

    const isAuthorized = isElevated || isDirectManager || isCreator || isAssignedBy || isManagerRole || isSubordinate;
    if (!isAuthorized) {
      throw {
        status: 403,
        message: 'Access forbidden: only a manager, the goal creator, or HR/Admin can activate this goal',
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

    if (!isAssignee && !isElevated) {
      throw { status: 403, message: 'Access forbidden: only the goal assignee can submit this goal for review' };
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
    const hasManager = Boolean(targetUser?.managerId);
    const tenantManagers = await prisma.tenantUser.findMany({
      where: { tenantId, role: 'MANAGER', status: 'ACTIVE', isDeleted: false },
      select: { id: true, name: true },
    });

    // AUTO_APPROVE goals skip manager review entirely — go straight to HR
    const isAutoApprove = goal.approvalMode === 'AUTO_APPROVE';
    const requiresManagerReview = !isAutoApprove && (
      hasManager || (tenantManagers.length > 0 && String(user.role || '').toUpperCase() !== 'MANAGER')
    );
    const newStatus = requiresManagerReview ? GOAL_STATUS.PENDING_MANAGER_REVIEW : GOAL_STATUS.PENDING_HR_REVIEW;

    // Update assignment status independently
    try {
      await prisma.goalAssignment.updateMany({
        where: { goalId, employeeId: targetEmpId },
        data: {
          status: newStatus,
          progress: 100,
        },
      });
    } catch (err) {
      console.warn('[GoalService] Notice updating goal assignment on submit:', err.message);
    }

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
    if (hasManager && targetUser.managerId) {
      await this.notify({
        tenantId,
        recipientId: targetUser.managerId,
        type: 'goal_update',
        title: `Goal Submitted for Review: "${goal.title}"`,
        body: `${user.name} has completed all tasks and submitted "${goal.title}" for your review.`,
        entityType: 'goal',
        entityId: goal.id,
      });
    } else if (requiresManagerReview && tenantManagers.length > 0) {
      for (const mgr of tenantManagers) {
        if (mgr.id === user.id) continue;
        await this.notify({
          tenantId,
          recipientId: mgr.id,
          type: 'goal_update',
          title: `Goal Submitted for Manager Review: "${goal.title}"`,
          body: `${user.name} has completed tasks and submitted "${goal.title}" for manager review.`,
          entityType: 'goal',
          entityId: goal.id,
        });
      }
    } else {
      const hrUsers = await prisma.tenantUser.findMany({
        where: { tenantId, role: { in: HR_ROLES } },
        select: { id: true },
      });
      for (const hr of hrUsers) {
        await this.notify({
          tenantId,
          recipientId: hr.id,
          type: 'goal_update',
          title: `Goal Submitted for HR Review: "${goal.title}"`,
          body: `${user.name} submitted "${goal.title}" for final review.`,
          entityType: 'goal',
          entityId: goal.id,
        });
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

    const targetEmpId = targetEmployeeId || goal.employeeId || goal.assignments?.[0]?.employeeId;
    const targetUser = goal.assignments?.find(a => a.employeeId === targetEmpId)?.employee || goal.employee;

    const isElevated = hasRole(user.role, ELEVATED_ROLES);
    const createdByCaller = (goal.createdById && goal.createdById === user.id)
      || (!goal.createdById && goal.createdBy && goal.createdBy === user.name);
    const isAssignedByCaller = goal.assignments?.some(a => a.assignedById === user.id) || createdByCaller;
    // A line manager anywhere up the reporting chain of the target employee may review.
    const isReportingManager = (targetEmpId && targetEmpId !== user.id)
      ? await this.isSubordinate(user.id, targetEmpId, tenantId)
      : false;
    const isManagerInTenant = String(user.role || '').toUpperCase() === 'MANAGER' && user.id !== targetEmpId;

    const isAuthorizedManager = isElevated || isReportingManager || isAssignedByCaller || isManagerInTenant;

    if (!isAuthorizedManager) {
      throw { status: 403, message: 'Access forbidden: you are not authorized to review this goal as manager' };
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
    const reviewedEmpIds = this.resolveReviewTargets(goal, targetEmployeeId, reviewable, 'manager review');
    const newStatus = isApprove ? GOAL_STATUS.PENDING_HR_REVIEW : GOAL_STATUS.CHANGES_REQUESTED;

    if (reviewedEmpIds.length > 0) {
      try {
        await prisma.goalAssignment.updateMany({
          where: { goalId, employeeId: { in: reviewedEmpIds } },
          data: { status: newStatus },
        });
      } catch (err) {
        console.warn('[GoalService] Notice updating goal assignment on manager review:', err.message);
      }
    }

    const parentData = await this.rolledUpParentData(goalId, newStatus, goal.progress);

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: {
        ...parentData,
        specialNotes: comment ? `Manager Note: ${comment}` : goal.specialNotes,
      },
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
        ? `Manager ${user.name} approved goal.${comment ? ` Remark: "${comment}"` : ''}${rating ? ` Rating: ${rating}/5` : ''}`
        : `Manager ${user.name} requested changes. Reason: "${comment}"`,
      previousValue: { status: goal.status },
    });

    // Notify every assignee whose submission was actually reviewed.
    for (const empId of reviewedEmpIds) {
      await this.notify({
        tenantId,
        recipientId: empId,
        type: 'goal_update',
        title: isApprove ? `Manager Approved: "${goal.title}"` : `Revisions Requested: "${goal.title}"`,
        body: isApprove
          ? `Manager ${user.name} approved your goal. It is now awaiting final HR sign-off.`
          : `Manager ${user.name} requested revisions: "${comment || 'Please update tasks'}"`,
        entityType: 'goal',
        entityId: goal.id,
      });
    }

    // If Manager Approved → notify HR
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
          title: `Action Required: HR Final Approval for "${goal.title}"`,
          body: `Manager ${user.name} approved ${reviewedNames}. Please provide final sign-off.`,
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

    const reviewedEmpIds = this.resolveReviewTargets(goal, targetEmployeeId, HR_REVIEWABLE, 'HR sign-off');
    const isApprove = action === 'APPROVE';
    const newStatus = isApprove ? GOAL_STATUS.COMPLETED : GOAL_STATUS.CHANGES_REQUESTED;

    if (reviewedEmpIds.length > 0) {
      try {
        await prisma.goalAssignment.updateMany({
          where: { goalId, employeeId: { in: reviewedEmpIds } },
          data: isApprove ? { status: newStatus, progress: 100 } : { status: newStatus },
        });
      } catch (err) {
        console.warn('[GoalService] Notice updating goal assignment on HR review:', err.message);
      }
    }

    // The goal only becomes COMPLETED once every assignee is signed off; an
    // assignee who has not submitted yet keeps it in review.
    const parentData = await this.rolledUpParentData(goalId, newStatus, isApprove ? 100 : goal.progress);

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: {
        ...parentData,
        specialNotes: comment ? `HR Note: ${comment}` : goal.specialNotes,
      },
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
      action: isApprove ? 'HR_APPROVED' : 'HR_CHANGES_REQUESTED',
      details: isApprove
        ? `HR Partner ${user.name} signed off ${reviewedEmpIds.length} assignee(s).${comment ? ` Remarks: "${comment}"` : ''}`
        : `HR Partner ${user.name} requested changes from ${reviewedEmpIds.length} assignee(s). Reason: "${comment}"`,
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
      : (hasManager ? GOAL_STATUS.PENDING_MANAGER_REVIEW : GOAL_STATUS.PENDING_HR_REVIEW);

    // Update assignment status independently
    try {
      await prisma.goalAssignment.updateMany({
        where: { goalId, employeeId: user.id },
        data: { status: newStatus },
      });
    } catch (err) {
      console.warn('[GoalService] Notice updating goal assignment on resubmit:', err.message);
    }

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
