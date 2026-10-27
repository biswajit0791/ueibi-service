import { prisma } from '../lib/prisma.js';
import { emitToTenant } from '../lib/socket.js';
import { taskIdParamSchema, managerTaskRatingSchema } from '../validations/task.schema.js';
import { goalRatingGate } from '../lib/goalRating.js';
import { SUPER_ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { goalService } from '../services/goal.service.js';
import { loadTaskForUser } from '../services/taskAccess.service.js';
import { taskTiming } from '../lib/taskTiming.js';

const RATEABLE_GOAL_STATUSES = new Set([
  'PENDING_MANAGER_REVIEW',
  'SUBMITTED',
  'ACTIVE',
  'UNDER_REVIEW',
  'COMPLETED',
]);

export async function rateGoalTask(req, res, next) {
  try {
    const parsedParams = taskIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid task ID parameter' });
    }
    const parsedBody = managerTaskRatingSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedBody.error.issues });
    }

    const task = await prisma.task.findFirst({
      where: { id: parsedParams.data.id, tenantId: req.tenantId },
      include: {
        goal: {
          include: {
            assignments: { select: { employeeId: true, status: true } },
          },
        },
      },
    });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // A dependency task has no goal of its own; it is rated against the goal
    // of the task it unblocks, by that goal's owner, once that goal is done.
    let ratingGoal = task.goal;
    let goalAssigneeId = task.employeeId;
    if (!ratingGoal && task.isDependencyOf && !task.isPrivate) {
      const parent = await prisma.task.findFirst({
        where: { id: task.isDependencyOf, tenantId: req.tenantId },
        include: { goal: { include: { assignments: { select: { employeeId: true, status: true } } } } },
      });
      ratingGoal = parent?.goal || null;
      goalAssigneeId = parent?.employeeId;
    } else if (task.isStandalone) {
      ratingGoal = null;
    }
    if (!ratingGoal || task.isPrivate) {
      return res.status(400).json({ error: 'Only tasks linked to a goal (or dependencies of one) can be rated' });
    }
    const userRole = String(req.user.role || '').toUpperCase();
    const isElevated = ['MANAGER', 'HR', 'ADMIN', 'SUPER_ADMIN', 'CMD', 'DIRECTOR', 'LEADERSHIP'].includes(userRole);
    const isGoalOwnerOrManager = Boolean(
      (ratingGoal.ownerManagerId && ratingGoal.ownerManagerId === req.user.id) ||
      (ratingGoal.ownerId && ratingGoal.ownerId === req.user.id) ||
      isElevated
    );
    if (!isGoalOwnerOrManager) {
      return res.status(403).json({ error: 'Only a manager, goal owner, or HR can rate tasks' });
    }
    if (task.employeeId === req.user.id) {
      return res.status(403).json({ error: 'You cannot rate your own task' });
    }
    const taskStatus = String(task.status || '').toLowerCase();
    if (!['done', 'completed'].includes(taskStatus) && Number(task.progress) < 100) {
      return res.status(409).json({ error: 'A task can only be rated after it is completed' });
    }

    const goalTasks = await prisma.task.findMany({
      where: { goalId: ratingGoal.id, tenantId: req.tenantId },
      select: { status: true },
    });
    const gate = goalRatingGate(goalTasks);
    if (!gate.ready) {
      return res.status(409).json({
        error: `Tasks can be rated only after the goal is completed. ${gate.remaining} of ${gate.total} task(s) are still open.`,
      });
    }

    const assignment = ratingGoal.assignments.find((row) => row.employeeId === goalAssigneeId);
    const reviewStatus = String(assignment?.status || ratingGoal.status || '').toUpperCase();
    if (!RATEABLE_GOAL_STATUSES.has(reviewStatus)) {
      return res.status(409).json({
        error: 'Task ratings are available for completed tasks while the goal is active or under manager review',
      });
    }

    const { rating, notes, finalWeight, weightReason } = parsedBody.data;

    // The final weightage travels with the rating so the manager judges both
    // in one step. Same rules as PATCH /tasks/:id/final-weight: never above
    // the planned weight, and HR / Finance work is weighed only by Admin+.
    const settingWeight = finalWeight !== undefined;
    const planned = Number(task.weight || 0);
    if (settingWeight) {
      if (finalWeight !== null && finalWeight > planned) {
        return res.status(400).json({
          error: `The final weightage cannot exceed this task's planned weight of ${planned}%.`,
          plannedWeight: planned,
        });
      }
      const target = await prisma.tenantUser.findUnique({
        where: { id: task.employeeId },
        select: { role: true },
      });
      const targetRole = String(target?.role || '').toUpperCase();
      if ((targetRole === 'HR' || targetRole === 'FINANCE') && !hasRole(req.user.role, SUPER_ELEVATED_ROLES)) {
        return res.status(403).json({
          error: `Final weightage for ${targetRole} personnel can only be managed and approved by Admin or Super Admin.`,
        });
      }
    }
    // An unchanged figure is not a new adjustment — keep who made it and when.
    const weightChanged = settingWeight && finalWeight !== (task.managerFinalWeight ?? null);

    const updated = await prisma.$transaction(async (tx) => {
      // If legacy goal had no ownerManagerId, backfill it so future checks align
      if (!ratingGoal.ownerManagerId) {
        await tx.goal.update({
          where: { id: ratingGoal.id },
          data: { ownerManagerId: req.user.id },
        });
      }

      const ratedTask = await tx.task.update({
        where: { id: task.id },
        data: {
          managerRating: rating,
          managerRatingNotes: notes || null,
          managerRatedById: req.user.id,
          managerRatedAt: new Date(),
          ...(weightChanged ? {
            managerFinalWeight: finalWeight,
            weightAdjustedById: finalWeight === null ? null : req.user.id,
            weightAdjustedAt: finalWeight === null ? null : new Date(),
            weightAdjustReason: finalWeight === null ? null : (weightReason || null),
          } : {}),
        },
        include: {
          managerRatedBy: { select: { id: true, name: true } },
          weightAdjustedBy: { select: { id: true, name: true } },
        },
      });

      if (weightChanged) {
        await tx.taskAuditLog.create({
          data: {
            taskId: task.id,
            performedById: req.user.id,
            action: 'edited',
            details: finalWeight === null
              ? `Final weightage cleared — the planned ${planned}% stands again.`
              : `Final weightage set to ${finalWeight}% (planned ${planned}%)${weightReason ? `. Reason: "${weightReason}"` : ''}.`,
            previousValue: { managerFinalWeight: task.managerFinalWeight },
          },
        });
      }

      await tx.taskAuditLog.create({
        data: {
          taskId: task.id,
          performedById: req.user.id,
          action: 'manager_rated',
          details: `Goal owner rated task ${rating}/5${notes ? `: ${notes}` : ''}`,
          previousValue: {
            managerRating: task.managerRating,
            managerRatingNotes: task.managerRatingNotes,
          },
        },
      });

      return ratedTask;
    });

    // A dependency's weightage is outside its parent goal's progress.
    if (weightChanged && task.goalId) {
      await goalService.recalculateProgress(task.goalId, task.employeeId).catch((err) => {
        console.warn('[taskRating] Notice recalculating goal progress:', err?.message || err);
      });
    }
    if (weightChanged) emitToTenant(req.tenantId, 'task_weightage_updated', { taskId: task.id });
    emitToTenant(req.tenantId, 'task_manager_rating_updated', { taskId: task.id, task: updated });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─── GET /tasks/:id ─────────────────────────────────────────────────────────
/**
 * One task with its timing, for a panel that shows a task it does not already
 * hold — e.g. a dependency task's rating, shown on the parent task's card.
 * Access is loadTaskForUser, which covers the parent task's owner/manager.
 */
export async function getTask(req, res, next) {
  try {
    const parsedParams = taskIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid task ID parameter' });
    }
    const task = await loadTaskForUser(parsedParams.data.id, req.user, req.tenantId);
    // The assignee sees only the actual weightage of their own task.
    const own = task.employeeId === req.user.id;
    res.json({
      ...task,
      ...(own ? { managerFinalWeight: null, weightAdjustReason: null } : {}),
      timing: taskTiming(task),
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}
