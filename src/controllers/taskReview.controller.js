/**
 * taskReview.controller.js
 *
 * Per-task completion review: the assignee submits a finished goal task, the
 * goal owner (or a manager above the assignee) approves it or sends it back.
 * See services/taskReview.service.js for the rules.
 */
import { prisma } from '../lib/prisma.js';
import { emitToTenant } from '../lib/socket.js';
import { isWorkComplete } from '../lib/taskTiming.js';
import { taskIdParamSchema } from '../validations/task.schema.js';
import { loadTaskForUser } from '../services/taskAccess.service.js';
import { logTaskAudit, pushNotification } from './taskActivity.controller.js';
import {
  REVIEW_STATUS, isGoalActive, isReviewedTask, canReviewTask, completeGoalIfAllApproved,
} from '../services/taskReview.service.js';

const REVIEWER_INCLUDE = { reviewedBy: { select: { id: true, name: true } } };

async function loadReviewContext(req) {
  const parsed = taskIdParamSchema.safeParse(req.params);
  if (!parsed.success) throw { status: 400, message: 'Invalid task ID parameter' };
  const task = await loadTaskForUser(parsed.data.id, req.user, req.tenantId);
  if (!isReviewedTask(task)) {
    throw { status: 400, message: 'Only tasks that count towards a goal go through approval' };
  }
  const goal = await prisma.goal.findFirst({ where: { id: task.goalId, tenantId: req.tenantId } });
  if (!goal) throw { status: 404, message: 'Goal not found' };
  if (!isGoalActive(goal)) {
    throw { status: 409, message: 'This goal has not been activated yet' };
  }
  return { task, goal };
}

async function finishReview(req, task, { action, details, notify }) {
  await logTaskAudit({ taskId: task.id, performedById: req.user.id, action, details });
  if (notify) {
    await pushNotification({
      tenantId: req.tenantId, type: 'task_update', entityType: 'task', entityId: task.id, ...notify,
    }).catch(() => null);
  }
  emitToTenant(req.tenantId, 'task_updated', { action: 'update', task, goalId: task.goalId });
}

// ─── POST /api/tasks/:id/review/submit ─────────────────────────────────────
export async function submitTaskForReview(req, res, next) {
  try {
    const { task, goal } = await loadReviewContext(req);
    if (task.employeeId !== req.user.id && !(task.assigneeIds || []).includes(req.user.id)) {
      return res.status(403).json({ error: 'Only the person assigned to this task can submit it' });
    }
    if (!isWorkComplete(task)) {
      return res.status(409).json({ error: 'Complete the task before submitting it for approval' });
    }
    if (task.reviewStatus === REVIEW_STATUS.SUBMITTED || task.reviewStatus === REVIEW_STATUS.APPROVED) {
      return res.status(409).json({ error: `This task is already ${task.reviewStatus.toLowerCase()}` });
    }

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        reviewStatus: REVIEW_STATUS.SUBMITTED,
        reviewSubmittedAt: new Date(),
        reviewedById: null,
        reviewedAt: null,
      },
      include: REVIEWER_INCLUDE,
    });

    let reviewerId = goal.ownerManagerId;
    if (!reviewerId || reviewerId === req.user.id) {
      const me = await prisma.tenantUser.findUnique({ where: { id: req.user.id }, select: { managerId: true } });
      reviewerId = me?.managerId || null;
    }
    await finishReview(req, updated, {
      action: 'review_submitted',
      details: `${req.user.name} submitted the task for approval.`,
      notify: reviewerId && reviewerId !== req.user.id ? {
        recipientId: reviewerId,
        title: `Task submitted for approval: "${task.title}"`,
        body: `${req.user.name} completed "${task.title}" on goal "${goal.title}" and submitted it for your approval.`,
      } : null,
    });
    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── POST /api/tasks/:id/review/approve | /reject ──────────────────────────
async function decide(req, res, next, approve) {
  try {
    const { task, goal } = await loadReviewContext(req);
    if (!(await canReviewTask({ task, goal, user: req.user, tenantId: req.tenantId }))) {
      return res.status(403).json({ error: 'Only the goal owner or a manager above the assignee can review this task' });
    }
    if (!isWorkComplete(task)) {
      return res.status(409).json({ error: 'This task is not complete yet' });
    }
    if (task.reviewStatus === REVIEW_STATUS.APPROVED) {
      return res.status(409).json({ error: 'This task is already approved' });
    }
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (!approve && task.reviewStatus !== REVIEW_STATUS.SUBMITTED) {
      return res.status(409).json({ error: 'Only a submitted task can be sent back' });
    }
    if (!approve && !comment) {
      return res.status(400).json({ error: 'Say what needs to change before sending the task back' });
    }

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        reviewStatus: approve ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.REJECTED,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        reviewComment: comment || null,
      },
      include: REVIEWER_INCLUDE,
    });

    await finishReview(req, updated, {
      action: approve ? 'review_approved' : 'review_rejected',
      details: approve
        ? `${req.user.name} approved the task.${comment ? ` Note: "${comment}"` : ''}`
        : `${req.user.name} sent the task back: "${comment}"`,
      notify: task.employeeId !== req.user.id ? {
        recipientId: task.employeeId,
        title: approve ? `Task approved: "${task.title}"` : `Changes requested: "${task.title}"`,
        body: approve
          ? `${req.user.name} approved your task "${task.title}".`
          : `${req.user.name} sent "${task.title}" back: "${comment}"`,
      } : null,
    });

    const completedGoal = approve
      ? await completeGoalIfAllApproved({ goalId: goal.id, tenantId: req.tenantId, actor: req.user })
      : null;
    res.json({ ...updated, goalCompleted: Boolean(completedGoal) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

export const approveTaskReview = (req, res, next) => decide(req, res, next, true);
export const rejectTaskReview = (req, res, next) => decide(req, res, next, false);
