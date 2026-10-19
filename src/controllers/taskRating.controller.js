import { prisma } from '../lib/prisma.js';
import { emitToTenant } from '../lib/socket.js';
import { taskIdParamSchema, managerTaskRatingSchema } from '../validations/task.schema.js';

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

    const assignment = task.goal.assignments.find((row) => row.employeeId === task.employeeId);
    const reviewStatus = String(assignment?.status || task.goal.status || '').toUpperCase();
    if (!RATEABLE_GOAL_STATUSES.has(reviewStatus)) {
      return res.status(409).json({
        error: 'Task ratings are available for completed tasks while the goal is active or under manager review',
      });
    }

    const { rating, notes } = parsedBody.data;
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
        },
        include: {
          managerRatedBy: { select: { id: true, name: true } },
        },
      });

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

    emitToTenant(req.tenantId, 'task_manager_rating_updated', { taskId: task.id, task: updated });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}
