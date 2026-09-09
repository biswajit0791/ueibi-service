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

  /**
   * Submits a goal for manager review.
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
    const isElevated = ['SUPER_ADMIN', 'HR', 'ADMIN', 'CMD', 'DIRECTOR', 'LEADERSHIP', 'OWNER'].includes(user.role);

    if (!isAssignee && !isElevated) {
      throw { status: 403, message: 'Access forbidden: only the goal assignee can submit this goal for review' };
    }

    const targetEmpId = userAssignment?.employeeId || goal.employeeId || goal.assignments?.[0]?.employeeId || user.id;
    const currentStatus = (userAssignment ? userAssignment.status : goal.status) || 'DRAFT';
    const allowedStatuses = ['DRAFT', 'READY_FOR_SUBMISSION', 'CHANGES_REQUESTED', 'IN_PROGRESS', 'REJECTED'];
    if (!allowedStatuses.includes(String(currentStatus).toUpperCase())) {
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
    const newStatus = hasManager ? 'PENDING_MANAGER_REVIEW' : 'PENDING_HR_REVIEW';

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

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: {
        status: newStatus,
        progress: 100,
      },
      include: {
        employee: true,
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true } },
          },
        },
        tasks: true,
        auditLogs: { orderBy: { createdAt: 'desc' }, include: { performedBy: { select: { id: true, name: true, role: true } } } },
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
          body: `${user.name} submitted "${goal.title}" for final review.`,
          entityType: 'goal',
          entityId: goal.id,
        });
      }
    }

    emitToTenant(tenantId, 'goal_updated', {
      action: 'update',
      goalId: goal.id,
      goal: updated,
    });

    return updated;
  }

  /**
   * Manager reviews a goal (Approve or Request Changes).
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

    const isDirectManager = targetUser?.managerId === user.id;
    const isElevated = ['SUPER_ADMIN', 'ADMIN', 'HR', 'LEADERSHIP', 'OWNER', 'CMD', 'DIRECTOR'].includes(user.role);

    if (!isDirectManager && !isElevated) {
      throw { status: 403, message: 'Access forbidden: you are not the reporting manager for this employee' };
    }

    const isApprove = action === 'APPROVE';
    const newStatus = isApprove ? 'PENDING_HR_REVIEW' : 'CHANGES_REQUESTED';

    // Update assignment status independently
    if (targetEmpId) {
      try {
        await prisma.goalAssignment.updateMany({
          where: { goalId, employeeId: targetEmpId },
          data: { status: newStatus },
        });
      } catch (err) {
        console.warn('[GoalService] Notice updating goal assignment on manager review:', err.message);
      }
    }

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: {
        status: newStatus,
        specialNotes: comment ? `Manager Note: ${comment}` : goal.specialNotes,
      },
      include: {
        employee: true,
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true } },
          },
        },
        tasks: true,
        auditLogs: { orderBy: { createdAt: 'desc' }, include: { performedBy: { select: { id: true, name: true, role: true } } } },
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
    if (targetEmpId) {
      await this.notify({
        tenantId,
        recipientId: targetEmpId,
        type: 'goal_update',
        title: isApprove ? `Manager Approved: "${goal.title}"` : `Revisions Requested: "${goal.title}"`,
        body: isApprove
          ? `Manager ${user.name} approved your goal. It is now awaiting final HR sign-off.`
          : `Manager ${user.name} requested revisions: "${comment || 'Please update tasks'}"`,
        entityType: 'goal',
        entityId: goal.id,
      });
    }

    // If Manager Approved, notify HR
    if (isApprove) {
      const hrUsers = await prisma.tenantUser.findMany({
        where: { tenantId, role: { in: ['HR', 'SUPER_ADMIN', 'ADMIN', 'CMD', 'DIRECTOR'] } },
        select: { id: true },
      });
      for (const hr of hrUsers) {
        await this.notify({
          tenantId,
          recipientId: hr.id,
          type: 'goal_update',
          title: `Action Required: HR Final Approval for "${goal.title}"`,
          body: `Manager ${user.name} approved ${targetUser?.name || 'employee'}'s goal. Please provide final sign-off.`,
          entityType: 'goal',
          entityId: goal.id,
        });
      }
    }

    emitToTenant(tenantId, 'goal_updated', {
      action: 'update',
      goalId: goal.id,
      goal: updated,
    });

    return updated;
  }

  /**
   * HR final review for a goal (Approve -> COMPLETED, or Request Changes).
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

    const isHR = ['HR', 'SUPER_ADMIN', 'ADMIN', 'LEADERSHIP', 'OWNER', 'CMD', 'DIRECTOR'].includes(user.role);
    if (!isHR) {
      throw { status: 403, message: 'Access forbidden: HR authorization required for final sign-off' };
    }

    const targetEmpId = targetEmployeeId || goal.employeeId || goal.assignments?.[0]?.employeeId;
    const isApprove = action === 'APPROVE';
    const newStatus = isApprove ? 'COMPLETED' : 'CHANGES_REQUESTED';

    // Update assignment status independently
    if (targetEmpId) {
      try {
        await prisma.goalAssignment.updateMany({
          where: { goalId, employeeId: targetEmpId },
          data: {
            status: newStatus,
            progress: isApprove ? 100 : undefined,
          },
        });
      } catch (err) {
        console.warn('[GoalService] Notice updating goal assignment on HR review:', err.message);
      }
    }

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: {
        status: newStatus,
        progress: isApprove ? 100 : goal.progress,
        specialNotes: comment ? `HR Note: ${comment}` : goal.specialNotes,
      },
      include: {
        employee: true,
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true } },
          },
        },
        tasks: true,
        auditLogs: { orderBy: { createdAt: 'desc' }, include: { performedBy: { select: { id: true, name: true, role: true } } } },
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
    if (targetEmpId) {
      await this.notify({
        tenantId,
        recipientId: targetEmpId,
        type: 'goal_update',
        title: isApprove ? `Goal Completed: "${goal.title}"` : `HR Requested Changes: "${goal.title}"`,
        body: isApprove
          ? `Congratulations! HR Partner ${user.name} officially approved and marked your goal "${goal.title}" as COMPLETED.`
          : `HR Partner ${user.name} requested changes: "${comment}"`,
        entityType: 'goal',
        entityId: goal.id,
      });
    }

    emitToTenant(tenantId, 'goal_updated', {
      action: 'update',
      goalId: goal.id,
      goal: updated,
    });

    return updated;
  }

  /**
   * Resubmits a goal after revisions are made.
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
    const isElevated = ['SUPER_ADMIN', 'HR', 'ADMIN', 'CMD', 'DIRECTOR', 'LEADERSHIP', 'OWNER'].includes(user.role);

    if (!isAssignee && !isElevated) {
      throw { status: 403, message: 'Access forbidden: only the goal assignee can resubmit this goal' };
    }

    const targetUser = userAssignment?.employee || goal.employee;
    const hasManager = Boolean(targetUser?.managerId);
    const newStatus = hasManager ? 'PENDING_MANAGER_REVIEW' : 'PENDING_HR_REVIEW';

    // Update assignment status independently
    try {
      await prisma.goalAssignment.updateMany({
        where: { goalId, employeeId: user.id },
        data: { status: newStatus },
      });
    } catch (err) {
      console.warn('[GoalService] Notice updating goal assignment on resubmit:', err.message);
    }

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: {
        status: newStatus,
      },
      include: {
        employee: true,
        assignments: {
          include: {
            employee: { select: { id: true, name: true, email: true, department: true, designation: true } },
          },
        },
        tasks: true,
        auditLogs: { orderBy: { createdAt: 'desc' }, include: { performedBy: { select: { id: true, name: true, role: true } } } },
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

    emitToTenant(tenantId, 'goal_updated', {
      action: 'update',
      goalId: goal.id,
      goal: updated,
    });

    return updated;
  }
}

export const goalService = new GoalService();
