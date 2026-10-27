import { prisma } from '../lib/prisma.js';
import { emitToTenant } from '../lib/socket.js';
import { taskIdParamSchema, managerTaskRatingSchema } from '../validations/task.schema.js';
import { goalRatingGate } from '../lib/goalRating.js';
import { SUPER_ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { goalService } from '../services/goal.service.js';

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
    if (!task.goal || task.isStandalone || task.isPrivate) {
      return res.status(400).json({ error: 'Only tasks linked to a goal can be rated' });
    }
    const userRole = String(req.user.role || '').toUpperCase();
    const isElevated = ['MANAGER', 'HR', 'ADMIN', 'SUPER_ADMIN', 'CMD', 'DIRECTOR', 'LEADERSHIP'].includes(userRole);
    const isGoalOwnerOrManager = Boolean(
      (task.goal.ownerManagerId && task.goal.ownerManagerId === req.user.id) ||
      (task.goal.ownerId && task.goal.ownerId === req.user.id) ||
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
      where: { goalId: task.goal.id, tenantId: req.tenantId },
      select: { status: true },
    });
    const gate = goalRatingGate(goalTasks);
    if (!gate.ready) {
      return res.status(409).json({
        error: `Tasks can be rated only after the goal is completed. ${gate.remaining} of ${gate.total} task(s) are still open.`,
      });
    }

    const assignment = task.goal.assignments.find((row) => row.employeeId === task.employeeId);
    const reviewStatus = String(assignment?.status || task.goal.status || '').toUpperCase();
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
      if (!task.goal.ownerManagerId) {
        await tx.goal.update({
          where: { id: task.goal.id },
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

    if (weightChanged) {
      await goalService.recalculateProgress(task.goal.id, task.employeeId).catch((err) => {
        console.warn('[taskRating] Notice recalculating goal progress:', err?.message || err);
      });
      emitToTenant(req.tenantId, 'task_weightage_updated', { taskId: task.id });
    }
    emitToTenant(req.tenantId, 'task_manager_rating_updated', { taskId: task.id, task: updated });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}
