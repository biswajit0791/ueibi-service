import { prisma } from '../lib/prisma.js';
import { emitToTenant, emitToUser } from '../lib/socket.js';

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
// Employee self-created flow:   DRAFT → PENDING_MANAGER_REVIEW → PENDING_HR_REVIEW → COMPLETED
// Manager + MANAGER_APPROVAL:  PENDING_APPROVAL → ACTIVE → (tasks) → PENDING_MANAGER_REVIEW → PENDING_HR_REVIEW → COMPLETED
// Manager + AUTO_APPROVE:      ACTIVE → (tasks) → PENDING_MANAGER_REVIEW → PENDING_HR_REVIEW → COMPLETED
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
   * Check if managerId is an ancestor / direct manager of targetId.
   */
  async isSubordinate(managerId, targetId, tenantId) {
    if (managerId === targetId) return true;
    let current = await prisma.tenantUser.findFirst({
      where: { id: targetId, tenantId },
    });
    while (current && current.managerId) {
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
   * Recalculates goal progress from its linked tasks.
   */
  async recalculateProgress(goalId) {
    if (!goalId) return 0;

    const tasks = await prisma.task.findMany({
      where: { goalId },
    });

    if (tasks.length === 0) {
      await prisma.goal.update({
        where: { id: goalId },
        data: { progress: 0, milestones: 0, completedMilestones: 0 },
      });
      return 0;
    }

    const totalWeight = tasks.reduce((sum, t) => sum + Number(t.weight || 1), 0);
    const earned = tasks.reduce((sum, t) => sum + (Number(t.progress || 0) * Number(t.weight || 1)), 0);
    const overallProgress = totalWeight > 0 ? Math.min(100, Math.round(earned / totalWeight)) : 0;
    const completedTasksCount = tasks.filter(t => t.status === 'done' || t.progress === 100).length;

    await prisma.goal.update({
      where: { id: goalId },
      data: {
        progress: overallProgress,
        milestones: tasks.length,
        completedMilestones: completedTasksCount,
      },
    });

    return overallProgress;
  }

  // ─── WORKFLOW ACTION: Activate/Approve a PENDING_APPROVAL goal ─────────────
  /**
   * Transitions a manager-created goal from PENDING_APPROVAL → ACTIVE.
   *
   * Who can call this:
   *  - The goal-owner's direct reporting manager
   *  - HR / SUPER_ADMIN / ADMIN
   *
   * Flow: MANAGER + MANAGER_APPROVAL mode
   *   Goal created → PENDING_APPROVAL → [this action] → ACTIVE
   */
  async activateGoal({ tenantId, goalId, user, comment }) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      include: {
        employee: {
          select: { id: true, name: true, email: true, managerId: true },
        },
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

    // Authorization: must be the assignee's reporting manager OR elevated role
    const isDirectManager = goal.employee.managerId === user.id;
    const isElevated = ['SUPER_ADMIN', 'HR', 'ADMIN'].includes(user.role);

    if (!isDirectManager && !isElevated) {
      throw {
        status: 403,
        message: 'Access forbidden: only the reporting manager (or HR/Admin) can activate this goal',
      };
    }

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: { status: GOAL_STATUS.ACTIVE },
      include: {
        employee: true,
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
      action: 'GOAL_ACTIVATED',
      details: `${user.name} activated goal "${goal.title}". Goal is now ACTIVE — tasks are workable.${comment ? ` Note: "${comment}"` : ''}`,
      previousValue: { status: goal.status },
    });

    // Notify the goal owner (assignee)
    await this.notify({
      tenantId,
      recipientId: goal.employeeId,
      type: 'goal_update',
      title: `Goal Activated: "${goal.title}"`,
      body: `Your goal has been approved and is now ACTIVE. You can now work on your tasks.`,
      entityType: 'goal',
      entityId: goal.id,
    });

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
        tasks: true,
      },
    });

    if (!goal) {
      throw { status: 404, message: 'Goal not found' };
    }

    const isAssignee = goal.employeeId === user.id;
    const isElevated = ['SUPER_ADMIN', 'HR', 'ADMIN'].includes(user.role);

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

    const allowedStatuses = [
      GOAL_STATUS.DRAFT,
      GOAL_STATUS.ACTIVE,
      GOAL_STATUS.READY_FOR_SUBMISSION,
      GOAL_STATUS.CHANGES_REQUESTED,
      GOAL_STATUS.IN_PROGRESS,
      GOAL_STATUS.REJECTED,
    ];
    if (!allowedStatuses.includes(goal.status)) {
      throw { status: 400, message: `Goal cannot be submitted from current status: "${goal.status}"` };
    }

    // Validate tasks exist and are all completed
    const tasks = goal.tasks || [];
    if (tasks.length === 0) {
      throw { status: 400, message: 'Cannot submit goal: at least one task/milestone must be added to this goal.' };
    }

    const incompleteTasks = tasks.filter(t => t.status !== 'done' && (t.progress || 0) < 100);
    if (incompleteTasks.length > 0) {
      throw {
        status: 400,
        message: `Cannot submit goal: ${incompleteTasks.length} task(s) are still incomplete. Complete all required tasks before submitting.`,
      };
    }

    const hasManager = Boolean(goal.employee.managerId);
    const newStatus = hasManager ? GOAL_STATUS.PENDING_MANAGER_REVIEW : GOAL_STATUS.PENDING_HR_REVIEW;

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: { status: newStatus, progress: 100 },
      include: {
        employee: true,
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
      previousValue: { status: goal.status },
    });

    // Notify Manager or HR
    if (hasManager) {
      await this.notify({
        tenantId,
        recipientId: goal.employee.managerId,
        type: 'goal_update',
        title: `Goal Submitted for Review: "${goal.title}"`,
        body: `${goal.employee.name} has completed all tasks and submitted "${goal.title}" for your review.`,
        entityType: 'goal',
        entityId: goal.id,
      });
    } else {
      const hrUsers = await prisma.tenantUser.findMany({
        where: { tenantId, role: { in: ['HR', 'SUPER_ADMIN', 'ADMIN'] } },
        select: { id: true },
      });
      for (const hr of hrUsers) {
        await this.notify({
          tenantId,
          recipientId: hr.id,
          type: 'goal_update',
          title: `Goal Submitted for HR Review: "${goal.title}"`,
          body: `${goal.employee.name} submitted "${goal.title}" for final review.`,
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
  async managerReview({ tenantId, goalId, user, action, comment, rating }) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      include: { employee: true, tasks: true },
    });

    if (!goal) {
      throw { status: 404, message: 'Goal not found' };
    }

    const isDirectManager = goal.employee.managerId === user.id;
    const isElevated = ['SUPER_ADMIN', 'HR', 'ADMIN'].includes(user.role);

    if (!isDirectManager && !isElevated) {
      throw { status: 403, message: 'Access forbidden: you are not the reporting manager for this employee' };
    }

    if (goal.status !== GOAL_STATUS.PENDING_MANAGER_REVIEW && goal.status !== 'submitted') {
      throw { status: 400, message: `Goal is not currently awaiting manager review (Status: ${goal.status})` };
    }

    const isApprove = action === 'APPROVE';
    const newStatus = isApprove ? GOAL_STATUS.PENDING_HR_REVIEW : GOAL_STATUS.CHANGES_REQUESTED;

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: {
        status: newStatus,
        specialNotes: comment ? `Manager Note: ${comment}` : goal.specialNotes,
      },
      include: {
        employee: true,
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

    // Notify Employee
    await this.notify({
      tenantId,
      recipientId: goal.employeeId,
      type: 'goal_update',
      title: isApprove ? `Manager Approved: "${goal.title}"` : `Revisions Requested: "${goal.title}"`,
      body: isApprove
        ? `Manager ${user.name} approved your goal. It is now awaiting final HR sign-off.`
        : `Manager ${user.name} requested revisions: "${comment || 'Please update tasks'}"`,
      entityType: 'goal',
      entityId: goal.id,
    });

    // If Manager Approved → notify HR
    if (isApprove) {
      const hrUsers = await prisma.tenantUser.findMany({
        where: { tenantId, role: { in: ['HR', 'SUPER_ADMIN', 'ADMIN'] } },
        select: { id: true },
      });
      for (const hr of hrUsers) {
        await this.notify({
          tenantId,
          recipientId: hr.id,
          type: 'goal_update',
          title: `Action Required: HR Final Approval for "${goal.title}"`,
          body: `Manager ${user.name} approved ${goal.employee.name}'s goal. Please provide final sign-off.`,
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
  async hrReview({ tenantId, goalId, user, action, comment, rating }) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      include: { employee: true, tasks: true },
    });

    if (!goal) {
      throw { status: 404, message: 'Goal not found' };
    }

    const isHR = ['HR', 'SUPER_ADMIN', 'ADMIN', 'LEADERSHIP', 'OWNER'].includes(user.role);
    if (!isHR) {
      throw { status: 403, message: 'Access forbidden: HR authorization required for final sign-off' };
    }

    if (
      goal.status !== GOAL_STATUS.PENDING_HR_REVIEW &&
      goal.status !== GOAL_STATUS.PENDING_MANAGER_REVIEW &&
      goal.status !== 'submitted'
    ) {
      throw { status: 400, message: `Goal is not currently in a reviewable state (Status: ${goal.status})` };
    }

    const isApprove = action === 'APPROVE';
    const newStatus = isApprove ? GOAL_STATUS.COMPLETED : GOAL_STATUS.CHANGES_REQUESTED;

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: {
        status: newStatus,
        progress: isApprove ? 100 : goal.progress,
        specialNotes: comment ? `HR Note: ${comment}` : goal.specialNotes,
      },
      include: {
        employee: true,
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
        ? `HR Partner ${user.name} approved and finalized goal as COMPLETED.${comment ? ` Remarks: "${comment}"` : ''}`
        : `HR Partner ${user.name} requested changes. Reason: "${comment}"`,
      previousValue: { status: goal.status },
    });

    // Notify Employee
    await this.notify({
      tenantId,
      recipientId: goal.employeeId,
      type: 'goal_update',
      title: isApprove ? `Goal Completed: "${goal.title}"` : `HR Requested Changes: "${goal.title}"`,
      body: isApprove
        ? `Congratulations! HR Partner ${user.name} officially approved and marked your goal "${goal.title}" as COMPLETED.`
        : `HR Partner ${user.name} requested changes: "${comment}"`,
      entityType: 'goal',
      entityId: goal.id,
    });

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
        tasks: true,
      },
    });

    if (!goal) {
      throw { status: 404, message: 'Goal not found' };
    }

    const isAssignee = goal.employeeId === user.id;
    const isElevated = ['SUPER_ADMIN', 'HR', 'ADMIN'].includes(user.role);

    if (!isAssignee && !isElevated) {
      throw { status: 403, message: 'Access forbidden: only the goal assignee can resubmit this goal' };
    }

    if (goal.status !== GOAL_STATUS.CHANGES_REQUESTED && goal.status !== GOAL_STATUS.REJECTED) {
      throw { status: 400, message: `Goal is not in a revision state (Status: ${goal.status})` };
    }

    const hasManager = Boolean(goal.employee.managerId);
    const newStatus = hasManager ? GOAL_STATUS.PENDING_MANAGER_REVIEW : GOAL_STATUS.PENDING_HR_REVIEW;

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: { status: newStatus },
      include: {
        employee: true,
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
    if (hasManager) {
      await this.notify({
        tenantId,
        recipientId: goal.employee.managerId,
        type: 'goal_update',
        title: `Goal Resubmitted: "${goal.title}"`,
        body: `${goal.employee.name} has updated and resubmitted "${goal.title}" for your review.`,
        entityType: 'goal',
        entityId: goal.id,
      });
    }

    emitToTenant(tenantId, 'goal_updated', { action: 'update', goalId: goal.id, goal: updated });

    return updated;
  }
}

export const goalService = new GoalService();
