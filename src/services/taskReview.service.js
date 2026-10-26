/**
 * taskReview.service.js
 *
 * Per-task completion review. A finished goal task is submitted by its
 * assignee and approved (or sent back) by the goal owner, task by task:
 *
 *   complete → [submit] → SUBMITTED → [approve] → APPROVED
 *                                   → [reject]  → REJECTED → [submit] → …
 *
 * Two shortcuts:
 *  - A task the GOAL OWNER completes is APPROVED on the spot. The owner is the
 *    approver, so asking them to submit to themselves would be a dead step.
 *  - Once every task on a goal is APPROVED, the goal (and every assignment on
 *    it) moves to COMPLETED by itself. There is no goal-level "submit".
 *
 * Only goal work is reviewed: private and standalone tasks carry no weight on
 * the goal and are left alone.
 */
import { prisma } from '../lib/prisma.js';
import { emitToTenant } from '../lib/socket.js';
import { ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { isWorkComplete } from '../lib/taskTiming.js';
import { goalService, rollUpGoalStatus, rollUpGoalProgress } from './goal.service.js';

export const REVIEW_STATUS = {
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

/** Goal statuses in which the goal has not been activated yet. */
export const GOAL_NOT_ACTIVE_STATUSES = ['PENDING_APPROVAL', 'DRAFT'];

export function isGoalActive(goal) {
  if (!goal) return true; // a task with no goal has nothing to wait for
  return !GOAL_NOT_ACTIVE_STATUSES.includes(String(goal.status || '').toUpperCase());
}

export function isReviewedTask(task) {
  return Boolean(task?.goalId) && !task.isStandalone && !task.isPrivate;
}

export function isGoalOwner(goal, userId) {
  return Boolean(goal && userId && (goal.ownerManagerId === userId || goal.ownerId === userId));
}

/**
 * Review fields to write alongside a task status/progress change.
 *
 * Becoming complete: APPROVED straight away when the goal owner did it,
 * otherwise a clean slate waiting for the assignee to submit.
 * Leaving complete: any earlier review no longer describes the work.
 */
export function reviewFieldsForTransition({ existing, next, goal, actorId, now = new Date() }) {
  if (!isReviewedTask({ ...existing, ...next })) return {};
  const after = {
    status: next.status !== undefined ? next.status : existing.status,
    progress: next.progress !== undefined ? next.progress : existing.progress,
  };
  const wasComplete = isWorkComplete(existing);
  const willBeComplete = isWorkComplete(after);

  if (willBeComplete && !wasComplete) {
    if (isGoalOwner(goal, actorId)) {
      return {
        reviewStatus: REVIEW_STATUS.APPROVED,
        reviewedById: actorId,
        reviewedAt: now,
        reviewComment: null,
      };
    }
    return clearedReview();
  }
  if (!willBeComplete && existing.reviewStatus) return clearedReview();
  return {};
}

function clearedReview() {
  return {
    reviewStatus: null,
    reviewSubmittedAt: null,
    reviewedById: null,
    reviewedAt: null,
    reviewComment: null,
  };
}

/**
 * May this user approve / send back this task? The goal owner, an elevated
 * role, or a manager up the assignee's reporting chain — never the assignee
 * on their own work unless they own the goal.
 */
export async function canReviewTask({ task, goal, user, tenantId }) {
  if (isGoalOwner(goal, user.id)) return true;
  if (task.employeeId === user.id) return false;
  if (hasRole(user.role, ELEVATED_ROLES)) return true;
  return goalService.isSubordinate(user.id, task.employeeId, tenantId);
}

/**
 * Completes every assignment whose tasks are all APPROVED, and the goal itself
 * once all of its reviewed tasks are. `actor` is whoever made the last
 * approval. Returns the updated goal when it just
 * completed, otherwise null.
 */
export async function completeGoalIfAllApproved({ goalId, tenantId, actor }) {
  if (!goalId) return null;
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, tenantId },
    include: { assignments: true, tasks: true },
  });
  if (!goal || !isGoalActive(goal)) return null;
  if (String(goal.status || '').toUpperCase() === 'COMPLETED') return null;

  const reviewed = goal.tasks.filter(isReviewedTask);
  if (reviewed.length === 0) return null;
  const approved = (t) => t.reviewStatus === REVIEW_STATUS.APPROVED;
  const allApproved = reviewed.every(approved);

  // An assignee with no tasks of their own is done when the goal is.
  const finishedAssignees = goal.assignments
    .filter((a) => String(a.status || '').toUpperCase() !== 'COMPLETED')
    .filter((a) => {
      const own = reviewed.filter((t) => t.employeeId === a.employeeId);
      return own.length > 0 ? own.every(approved) : allApproved;
    })
    .map((a) => a.employeeId);

  if (finishedAssignees.length > 0) {
    await prisma.goalAssignment.updateMany({
      where: { goalId, employeeId: { in: finishedAssignees } },
      data: { status: 'COMPLETED', progress: 100 },
    });
  }

  const rows = await prisma.goalAssignment.findMany({
    where: { goalId }, select: { status: true, progress: true },
  });
  const status = rows.length > 0
    ? rollUpGoalStatus(rows, goal.status)
    : (allApproved ? 'COMPLETED' : goal.status);
  if (String(status).toUpperCase() !== 'COMPLETED') {
    if (finishedAssignees.length > 0) {
      emitToTenant(tenantId, 'goal_updated', { action: 'update', goalId });
    }
    return null;
  }

  const updated = await prisma.goal.update({
    where: { id: goalId },
    data: {
      status: 'COMPLETED',
      progress: rows.length > 0 ? rollUpGoalProgress(rows, 100) : 100,
      closedAt: new Date(),
      closedById: actor.id,
    },
  });

  await goalService.logAudit({
    goalId,
    performedById: actor.id,
    action: 'GOAL_COMPLETED',
    details: `Every task on "${goal.title}" is approved — goal completed (last approval by ${actor.name}).`,
    previousValue: { status: goal.status },
  });

  const recipients = new Set(goal.assignments.map((a) => a.employeeId));
  if (goal.employeeId) recipients.add(goal.employeeId);
  if (goal.ownerManagerId) recipients.add(goal.ownerManagerId);
  for (const recipientId of recipients) {
    if (recipientId === actor.id) continue;
    await goalService.notify({
      tenantId,
      recipientId,
      type: 'goal_update',
      title: `Goal Completed: "${goal.title}"`,
      body: 'All tasks on this goal have been completed and approved by the goal owner.',
      entityType: 'goal',
      entityId: goalId,
    });
  }

  emitToTenant(tenantId, 'goal_updated', { action: 'update', goalId, goal: updated });
  return updated;
}
