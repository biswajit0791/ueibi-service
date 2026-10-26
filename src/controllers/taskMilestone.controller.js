/**
 * taskMilestone.controller.js
 *
 * Milestone-wise completion for critical tasks. Replaces the old SubTask
 * checklist for this use case: a milestone is dated, watched, and gated by an
 * employee-proposes / manager-approves workflow rather than a plain checkbox.
 *
 * Access to a milestone is always mediated through its parent task via
 * loadTaskForUser (services/taskAccess.service.js) — the same authority
 * task.controller.js and taskActivity.controller.js already use, so a
 * milestone is exactly as visible/editable as the task it belongs to, with
 * two additional role gates layered on top:
 *   - only MANAGER+ may create/edit/delete a milestone
 *   - only the task owner or milestone's assigned employee may update progress
 *     or propose a date
 */
import { prisma } from '../lib/prisma.js';
import { loadTaskForUser } from '../services/taskAccess.service.js';
import { visibleTaskWhere } from '../services/taskVisibility.service.js';
import { logTaskAudit, pushNotification } from './taskActivity.controller.js';
import { emitToUser, emitToTenant } from '../lib/socket.js';
import { sendMail } from '../lib/mailer.js';
import { env } from '../config/env.js';
import { MANAGER_OR_ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { getCompanySettings, findDisallowedWatcherEmails } from '../services/companySettings.service.js';
import { withDefaultMilestoneWatcher } from '../services/milestoneWatcher.service.js';
import {
  createMilestoneSchema, updateMilestoneSchema, MAX_MILESTONES_PER_TASK,
} from '../validations/taskMilestone.schema.js';
import {
  buildModernMilestoneEmailHtml,
} from '../services/milestoneEscalation.service.js';
import { goalWeightSummary } from '../services/goalWeight.service.js';
import { milestoneBlock } from '../lib/milestoneGate.js';
import { goalService } from '../services/goal.service.js';
import { timingUpdates } from '../lib/taskTiming.js';
import {
  REVIEW_STATUS, reviewFieldsForTransition, completeGoalIfAllApproved,
} from '../services/taskReview.service.js';

export const MILESTONE_INCLUDE = {
  proposedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true, designation: true, role: true } },
};

/** A milestone's own assignee may belong to a team that has no access to the
 *  parent task. Falls back to "assigned to a milestone on this task" so they
 *  can still see and work their milestone (and only that). */
async function loadTaskForMilestoneActor(taskId, user, tenantId) {
  try {
    return await loadTaskForUser(taskId, user, tenantId);
  } catch (err) {
    if (err?.status !== 403) throw err;
    const owned = await prisma.taskMilestone.findFirst({
      where: { taskId, assigneeId: user.id, tenantId },
      select: { id: true },
    });
    if (!owned) throw err;
    const task = await prisma.task.findFirst({ where: { id: taskId, tenantId } });
    if (!task) throw { status: 404, message: 'Task not found' };
    return task;
  }
}

async function loadMilestoneOrThrow(taskId, milestoneId) {
  const milestone = await prisma.taskMilestone.findFirst({
    where: { id: milestoneId, taskId },
  });
  if (!milestone) throw { status: 404, message: 'Milestone not found on this task' };
  return milestone;
}

/** Throws a 400 naming every watcher email whose domain isn't on the
 *  tenant's allowlist (its own registered domain, plus Company Settings). */
export async function assertWatcherEmailsAllowed(tenantId, emails) {
  if (!emails || emails.length === 0) return;
  const disallowed = await findDisallowedWatcherEmails(tenantId, emails);
  if (disallowed.length > 0) {
    throw {
      status: 400,
      message: `These watcher emails aren't on an allowed domain for this company: ${disallowed.join(', ')}. `
        + 'An admin can add more domains under Company Settings.',
    };
  }
}

/** Throws a 400 unless every id is an active member of this tenant. A milestone
 *  owner may belong to any team, so only tenancy is checked here. */
export async function assertMilestoneAssigneesValid(tenantId, assigneeIds) {
  const ids = [...new Set((assigneeIds || []).filter(Boolean))];
  if (ids.length === 0) return;
  const found = await prisma.tenantUser.count({
    where: { id: { in: ids }, tenantId, isDeleted: false, status: 'ACTIVE' },
  });
  if (found !== ids.length) {
    throw { status: 400, message: 'Milestone assignee must be an active member of this company' };
  }
}

/** Once every milestone on a task is APPROVED or DONE, the task itself may
 *  leave pending_approval and become workable. Mirrors the same idea as
 *  goalWeight.service.js's PENDING_APPROVAL gate, one level down. */
async function maybeUnlockTask(taskId) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || task.status !== 'pending_approval') return;

  const milestones = await prisma.taskMilestone.findMany({ where: { taskId } });
  if (milestones.length === 0) return;
  const allSettled = milestones.every((m) => m.status === 'APPROVED' || m.status === 'DONE');
  if (!allSettled) return;

  await prisma.task.update({ where: { id: taskId }, data: { status: 'todo' } });
  await logTaskAudit({
    taskId,
    performedById: task.employeeId,
    action: 'milestones_approved',
    details: 'All milestones approved — task unlocked and moved to To Do.',
  });
}

/**
 * Why work may not be recorded against a milestone of this task yet, or null.
 * Shared by updates and by creation with a starting progress, so a milestone
 * cannot be born already part-done to get round the gate.
 */
export async function milestoneWorkBlock({ goalId, isStandalone, tenantId, milestone }) {
  const goal = goalId && !isStandalone
    ? await prisma.goal.findUnique({ where: { id: goalId }, select: { status: true } })
    : null;
  const weightSummary = goal ? await goalWeightSummary(goalId) : null;
  const { milestoneRequireApproval } = await getCompanySettings(tenantId);
  return milestoneBlock({
    action: 'work', goal, weightSummary, milestone, requireApproval: milestoneRequireApproval,
  });
}

/** Task statuses that milestone work moves on to in_progress by itself. */
const MILESTONE_STARTABLE_STATUSES = ['todo', 'pending_approval', 'rejected', 'done'];

/**
 * The task follows its milestones: progress is their average, any milestone
 * work puts it In Progress, and the last milestone done completes it (and,
 * when the goal owner is the one finishing it, approves it as well).
 */
async function syncTaskFromMilestones(taskId, actor, tenantId) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  const milestones = await prisma.taskMilestone.findMany({ where: { taskId } });
  if (!task || milestones.length === 0) return;

  const pct = (m) => (m.status === 'DONE' ? 100 : Math.min(100, Math.max(0, Number(m.progress) || 0)));
  const allDone = milestones.every((m) => m.status === 'DONE');
  const anyWork = milestones.some((m) => pct(m) > 0);
  const average = Math.round(milestones.reduce((sum, m) => sum + pct(m), 0) / milestones.length);

  let status = task.status;
  if (allDone) status = 'done';
  else if (anyWork && MILESTONE_STARTABLE_STATUSES.includes(task.status)) status = 'in_progress';
  const progress = allDone ? 100 : Math.min(average, 99);
  if (status === task.status && progress === task.progress) return;

  const next = { status, progress };
  const goal = task.goalId
    ? await prisma.goal.findUnique({ where: { id: task.goalId }, select: { ownerManagerId: true } })
    : null;
  const reviewFields = reviewFieldsForTransition({ existing: task, next, goal, actorId: actor.id });

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { ...next, ...timingUpdates(task, next), ...reviewFields },
  });

  let goalProgress = 0;
  if (updated.goalId) {
    goalProgress = await goalService.recalculateProgress(updated.goalId, updated.employeeId);
    if (reviewFields.reviewStatus === REVIEW_STATUS.APPROVED) {
      await completeGoalIfAllApproved({ goalId: updated.goalId, tenantId, actor });
    }
  }

  if (status !== task.status) {
    await logTaskAudit({
      taskId,
      performedById: actor.id,
      action: 'status_changed',
      details: status === 'done'
        ? 'All milestones complete — task marked DONE.'
        : `Milestone work started — status updated to ${status.toUpperCase().replace('_', ' ')}.`,
    });
  }
  emitToTenant(tenantId, 'task_updated', {
    action: 'update', task: updated, goalId: updated.goalId, goalProgress,
  });
}

// ─── GET /api/tasks/:id/milestones ─────────────────────────────────────────
export async function listMilestones(req, res, next) {
  try {
    const { id: taskId } = req.params;
    await loadTaskForMilestoneActor(taskId, req.user, req.tenantId);

    const items = await prisma.taskMilestone.findMany({
      where: { taskId },
      include: MILESTONE_INCLUDE,
      orderBy: { order: 'asc' },
    });
    res.json({ items });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── POST /api/tasks/:id/milestones ────────────────────────────────────────
export async function createMilestone(req, res, next) {
  try {
    const { id: taskId } = req.params;
    const tenantId = req.tenantId;
    const task = await loadTaskForUser(taskId, req.user, tenantId);

    if (!hasRole(req.user.role, MANAGER_OR_ELEVATED_ROLES)) {
      return res.status(403).json({ error: 'Only a manager (or above) can add milestones' });
    }
    if ((task.priority || 'medium') !== 'critical') {
      return res.status(400).json({ error: 'Milestones are only available for critical-priority tasks' });
    }
    if (!task.dueDate) {
      return res.status(400).json({ error: "The task needs its own due date before milestones can be added" });
    }

    const parsed = createMilestoneSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { title, description, dueDate, progress, assigneeId } = parsed.data;
    let { watcherEmails } = parsed.data;
    await assertWatcherEmailsAllowed(tenantId, watcherEmails);
    watcherEmails = await withDefaultMilestoneWatcher(tenantId, task.employeeId, watcherEmails);
    await assertMilestoneAssigneesValid(tenantId, [assigneeId]);

    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) {
      return res.status(400).json({ error: 'Invalid milestone due date' });
    }

    if (Number(progress || 0) > 0) {
      const blocked = await milestoneWorkBlock({
        goalId: task.goalId, isStandalone: task.isStandalone, tenantId,
        milestone: { status: 'PENDING_APPROVAL' },
      });
      if (blocked) return res.status(409).json({ code: blocked.code, error: blocked.message });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueMidnight = new Date(dueDate);
    dueMidnight.setHours(0, 0, 0, 0);

    const taskDue = task.dueDate ? new Date(task.dueDate) : null;
    const isTaskOverdue = taskDue && taskDue < today;

    if (task.startDate) {
      const taskStart = new Date(task.startDate);
      taskStart.setHours(0, 0, 0, 0);
      if (dueMidnight < taskStart) {
        return res.status(400).json({ error: "Milestone checkpoint due date cannot be earlier than the task's start date" });
      }
    } else if (!isTaskOverdue && dueMidnight < today) {
      return res.status(400).json({ error: 'Milestone checkpoint due date cannot be in the past' });
    }

    if (due > new Date(task.dueDate)) {
      return res.status(400).json({ error: "Milestone due date cannot be later than the task's own due date" });
    }

    const existingCount = await prisma.taskMilestone.count({ where: { taskId } });
    if (existingCount >= MAX_MILESTONES_PER_TASK) {
      return res.status(400).json({ error: `A task may have at most ${MAX_MILESTONES_PER_TASK} milestones` });
    }

    const milestone = await prisma.taskMilestone.create({
      data: {
        tenantId,
        taskId,
        order: existingCount + 1,
        title: title.trim(),
        description: description?.trim() || null,
        dueDate: due,
        progress: Number(progress || 0),
        watcherEmails,
        assigneeId: assigneeId || null,
        status: 'PENDING_APPROVAL',
        createdById: req.user.id,
      },
    });

    const milestoneWithDetails = await prisma.taskMilestone.findUnique({
      where: { id: milestone.id },
      include: MILESTONE_INCLUDE,
    });

    // A milestone-tracked task waits at pending_approval for every milestone
    // to be approved — set that here too, in case the task was created
    // (isMilestoneTracked: true) before any milestone existed to trigger it.
    if (task.isMilestoneTracked && task.status !== 'pending_approval' && task.status === 'todo' && task.progress === 0) {
      await prisma.task.update({ where: { id: taskId }, data: { status: 'pending_approval' } });
    }

    await logTaskAudit({
      taskId, performedById: req.user.id, action: 'milestone_created',
      details: `${req.user.name} added milestone ${milestone.order}: "${milestone.title}".`,
    });

    if (milestone.assigneeId && milestone.assigneeId !== req.user.id) {
      await pushNotification({
        tenantId, recipientId: milestone.assigneeId, type: 'task_update',
        title: `Milestone assigned to you on "${task.title}"`,
        body: `${req.user.name} assigned you milestone "${milestone.title}", due ${due.toISOString().slice(0, 10)}.`,
        entityType: 'milestone', entityId: milestone.id,
      });
    }

    if (task.employeeId !== req.user.id) {
      await pushNotification({
        tenantId, recipientId: task.employeeId, type: 'task_update',
        title: `New milestone on "${task.title}"`,
        body: `${req.user.name} added milestone "${milestone.title}", due ${due.toISOString().slice(0, 10)}.`,
        entityType: 'milestone', entityId: milestone.id,
      });
    }

    res.status(201).json({ item: milestoneWithDetails || milestone });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

/**
 * Broadcasts milestone completion to ALL stakeholders:
 * - Assignee / Task Owner
 * - Manager of the Assignee / Task Creator
 * - Escalation chain managers (L1, L2, L3)
 * - All Milestone Watchers
 * - All Task & Goal Followers
 * Creates in-app Notification records, pushes via Socket.IO, and dispatches email alerts.
 */
async function broadcastMilestoneCompleted({ tenantId, task, milestone, actorUser }) {
  try {
    const recipientUserIds = new Set();

    // 1. Assignee / Task Owner
    if (task.employeeId) recipientUserIds.add(task.employeeId);

    // 2. Task Creator / Initiator
    if (task.createdById) recipientUserIds.add(task.createdById);

    // 3. Direct Manager of the assignee
    if (task.employeeId) {
      const emp = await prisma.tenantUser.findUnique({
        where: { id: task.employeeId },
        select: { managerId: true },
      });
      if (emp?.managerId) recipientUserIds.add(emp.managerId);
    }

    // 4. Followers of the task and its parent goal
    const entityIds = [task.id, task.goalId].filter(Boolean);
    const followers = await prisma.follower.findMany({
      where: { tenantId, entityId: { in: entityIds } },
      select: { userId: true },
    });
    for (const f of followers) {
      if (f.userId) recipientUserIds.add(f.userId);
    }

    // 5. Milestone Watchers who are tenant users
    if (milestone.watcherEmails && milestone.watcherEmails.length > 0) {
      const watcherUsers = await prisma.tenantUser.findMany({
        where: {
          tenantId,
          isDeleted: false,
          email: { in: milestone.watcherEmails.map((e) => e.toLowerCase()) },
        },
        select: { id: true },
      });
      for (const wu of watcherUsers) {
        if (wu.id) recipientUserIds.add(wu.id);
      }
    }

    const title = `Milestone Completed: Station 0${milestone.order}`;
    const body = `Station 0${milestone.order} ("${milestone.title}") on task "${task.title}" has been marked 100% completed by ${actorUser.name}.`;

    // Dispatch in-app notification & Socket.io push to all recipient users
    for (const uid of recipientUserIds) {
      try {
        const notif = await prisma.notification.create({
          data: {
            tenantId,
            recipientId: uid,
            type: 'TASK',
            title,
            body,
            entityType: 'TASK',
            entityId: task.id,
          },
        });
        emitToUser(tenantId, uid, 'notification', notif);
        emitToUser(tenantId, uid, 'task_updated', { taskId: task.id });
        if (task.goalId) {
          emitToUser(tenantId, uid, 'goal_updated', { goalId: task.goalId });
        }
      } catch (err) {
        console.warn(`[broadcastMilestoneCompleted] Notification delivery error for user ${uid}:`, err.message);
      }
    }

    // Completion emails are sent only to watchers; in-app updates above still
    // reach the task owner, manager, creator, and followers.
    const emailsToNotify = new Set(
      (milestone.watcherEmails || []).map((e) => e.toLowerCase())
    );

    // Prepare full task milestone context for rich HTML email
    const allTaskMilestones = await prisma.taskMilestone.findMany({
      where: { taskId: task.id },
      orderBy: { order: 'asc' },
    });

    const subject = `[Checkpoint Completed] Station 0${milestone.order} "${milestone.title}" on "${task.title}" is Complete!`;
    const text = `Critical Checkpoint Completed (100%)\n\n`
      + `Task: "${task.title}"\n`
      + `Milestone: Station 0${milestone.order} — "${milestone.title}"\n`
      + `Completed By: ${actorUser.name}\n`
      + `Date: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}\n\n`
      + `Review in Performance Management: ${env.frontendOrigin || 'http://localhost:5173'}/uer/goals`;

    const html = buildModernMilestoneEmailHtml({
      milestone: { ...milestone, status: 'DONE' },
      task,
      allMilestones: allTaskMilestones,
      daysOverdue: 0,
    });

    for (const email of emailsToNotify) {
      sendMail({
        to: email,
        subject,
        text,
        html,
        event: 'MILESTONE_COMPLETED',
      }).catch((err) => {
        console.warn(`[broadcastMilestoneCompleted] Email failed for ${email}:`, err.message);
      });
    }
  } catch (err) {
    console.warn('[broadcastMilestoneCompleted] Error broadcasting milestone completion:', err);
  }
}

// ─── PATCH /api/tasks/:id/milestones/:mid ──────────────────────────────────
export async function updateMilestone(req, res, next) {
  try {
    const { id: taskId, mid } = req.params;
    const tenantId = req.tenantId;
    const task = await loadTaskForMilestoneActor(taskId, req.user, tenantId);
    const milestone = await loadMilestoneOrThrow(taskId, mid);

    const parsed = updateMilestoneSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      title,
      description,
      dueDate,
      progress,
      watcherEmails,
      assigneeId,
      proposedCompletionDate,
      extensionDaysRequested,
      extensionReason,
      approve,
      isDone,
    } = parsed.data;

    const isManager = hasRole(req.user.role, MANAGER_OR_ELEVATED_ROLES);
    // The task owner, or the one member this milestone was assigned to.
    const isAssignee = task.employeeId === req.user.id || milestone.assigneeId === req.user.id;
    const data = {};
    const auditLines = [];

    // ── Execution gate (lib/milestoneGate.js) ─────────────────────────────
    // Nobody approves or works a milestone until its goal is active and the
    // goal's task weights total 100%; the assignee additionally waits for the
    // milestone itself to be approved when the company requires approval.
    // Only a CHANGE is work: an edit form re-sending the same progress must
    // not turn a rename or re-date into a refused progress update.
    const recordsWork = (progress !== undefined && Number(progress) !== Number(milestone.progress || 0))
      || (isDone !== undefined && Boolean(isDone) !== Boolean(milestone.isDone));
    if (approve === true || recordsWork) {
      const goal = task.goalId && !task.isStandalone
        ? await prisma.goal.findUnique({ where: { id: task.goalId }, select: { status: true } })
        : null;
      const weightSummary = goal ? await goalWeightSummary(task.goalId) : null;
      const { milestoneRequireApproval } = await getCompanySettings(tenantId);
      const gate = { goal, weightSummary, requireApproval: milestoneRequireApproval };
      const blocked = (approve === true && milestoneBlock({ ...gate, action: 'approve', milestone }))
        || (recordsWork && milestoneBlock({
          ...gate,
          action: 'work',
          // Approving and working in one request: judge the work as approved.
          milestone: approve === true ? { ...milestone, status: 'APPROVED' } : milestone,
        }));
      if (blocked) {
        return res.status(409).json({
          code: blocked.code,
          error: blocked.message,
          ...(weightSummary ? { weightSummary } : {}),
        });
      }
    }

    // Description and Progress updates (allowed by assignee or manager)
    if (description !== undefined) {
      data.description = description ? description.trim() : null;
      auditLines.push('updated checkpoint description');
    }
    if (progress !== undefined) {
      if (!isAssignee && !isManager) {
        return res.status(403).json({ error: 'Only the task owner or manager can update milestone progress' });
      }
      const newProgress = Math.min(100, Math.max(0, Number(progress)));
      data.progress = newProgress;
      auditLines.push(`updated progress to ${data.progress}%`);

      if (data.progress === 100 && !milestone.isDone) {
        data.isDone = true;
        data.status = 'DONE';
        data.completedById = req.user.id;
        data.completedAt = new Date();
      } else if (data.progress < 100 && milestone.isDone) {
        data.isDone = false;
        data.status = milestone.approvedById ? 'APPROVED' : (milestone.proposedCompletionDate ? 'RESCHEDULE_REQUESTED' : 'PENDING_APPROVAL');
        data.completedById = null;
        data.completedAt = null;
        auditLines.push('reopened checkpoint via progress slider');
      }
    }

    // ── Manager: edit the milestone's own fields ──────────────────────────
    if (title !== undefined || dueDate !== undefined || watcherEmails !== undefined || assigneeId !== undefined) {
      if (!isManager) {
        return res.status(403).json({ error: 'Only a manager (or above) can edit a milestone' });
      }
      if (milestone.status === 'DONE') {
        return res.status(409).json({ error: 'This milestone is already complete and cannot be edited' });
      }
      if (title !== undefined) data.title = title.trim();
      if (assigneeId !== undefined) {
        await assertMilestoneAssigneesValid(tenantId, [assigneeId]);
        data.assigneeId = assigneeId || null;
        auditLines.push('assignee changed');
      }
      if (watcherEmails !== undefined) {
        await assertWatcherEmailsAllowed(tenantId, watcherEmails);
        data.watcherEmails = await withDefaultMilestoneWatcher(tenantId, task.employeeId, watcherEmails);
      }
      if (dueDate !== undefined) {
        const due = new Date(dueDate);
        if (Number.isNaN(due.getTime())) {
          return res.status(400).json({ error: 'Invalid milestone due date' });
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dueMidnight = new Date(dueDate);
        dueMidnight.setHours(0, 0, 0, 0);

        const taskDue = task.dueDate ? new Date(task.dueDate) : null;
        const isTaskOverdue = taskDue && taskDue < today;

        if (task.startDate) {
          const taskStart = new Date(task.startDate);
          taskStart.setHours(0, 0, 0, 0);
          if (dueMidnight < taskStart) {
            return res.status(400).json({ error: "Milestone checkpoint due date cannot be earlier than the task's start date" });
          }
        } else if (!isTaskOverdue && dueMidnight < today) {
          return res.status(400).json({ error: 'Milestone checkpoint due date cannot be in the past' });
        }

        if (task.dueDate && due > new Date(task.dueDate)) {
          return res.status(400).json({ error: "Milestone due date cannot be later than the task's own due date" });
        }

        data.dueDate = due;
        auditLines.push(`due date set to ${due.toISOString().slice(0, 10)}`);
      }
    }

    // ── Employee: propose a new completion date or extension days ────────
    if (extensionDaysRequested !== undefined) {
      if (!isAssignee) {
        return res.status(403).json({ error: 'Only the task owner can request an extension' });
      }
      if (extensionDaysRequested === null) {
        data.extensionDaysRequested = null;
        data.extensionReason = null;
      } else {
        const days = Number(extensionDaysRequested);
        if (days <= 0) {
          return res.status(400).json({ error: 'Extension days requested must be at least 1 day' });
        }
        const currentDue = milestone.dueDate ? new Date(milestone.dueDate) : new Date();
        const proposed = new Date(currentDue.getTime() + days * 24 * 60 * 60 * 1000);
        data.extensionDaysRequested = days;
        data.extensionReason = extensionReason ? extensionReason.trim() : null;
        data.proposedCompletionDate = proposed;
        data.proposedById = req.user.id;
        data.proposedAt = new Date();
        data.status = 'RESCHEDULE_REQUESTED';
        auditLines.push(`requested +${days} day(s) extension: ${data.extensionReason || 'no reason provided'}`);
      }
    }

    if (proposedCompletionDate !== undefined) {
      if (!isAssignee) {
        return res.status(403).json({ error: 'Only the task owner can propose a completion date' });
      }
      if (!['PENDING_APPROVAL', 'RESCHEDULE_REQUESTED'].includes(milestone.status)) {
        return res.status(409).json({ error: 'This milestone is not open for a new proposed date' });
      }
      if (proposedCompletionDate === null) {
        data.proposedCompletionDate = null;
        data.proposedById = null;
        data.proposedAt = null;
      } else {
        const proposed = new Date(proposedCompletionDate);
        if (Number.isNaN(proposed.getTime())) {
          return res.status(400).json({ error: 'Invalid proposed completion date' });
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const proposedMidnight = new Date(proposedCompletionDate);
        proposedMidnight.setHours(0, 0, 0, 0);

        const taskDue = task.dueDate ? new Date(task.dueDate) : null;
        const isTaskOverdue = taskDue && taskDue < today;

        if (task.startDate) {
          const taskStart = new Date(task.startDate);
          taskStart.setHours(0, 0, 0, 0);
          if (proposedMidnight < taskStart) {
            return res.status(400).json({ error: "Proposed completion date cannot be earlier than the task's start date" });
          }
        } else if (!isTaskOverdue && proposedMidnight < today) {
          return res.status(400).json({ error: 'Proposed completion date cannot be in the past' });
        }

        if (task.dueDate && proposed > new Date(task.dueDate)) {
          return res.status(400).json({ error: "Proposed completion date cannot be later than the task's own due date" });
        }
        data.proposedCompletionDate = proposed;
        data.proposedById = req.user.id;
        data.proposedAt = new Date();
        auditLines.push(`proposed a new completion date of ${proposed.toISOString().slice(0, 10)}`);
      }
    }

    // ── Manager: approve, or send a proposed date back ─────────────────────
    if (approve !== undefined) {
      if (!isManager) {
        return res.status(403).json({ error: 'Only a manager (or above) can approve a milestone' });
      }
      if (!['PENDING_APPROVAL', 'RESCHEDULE_REQUESTED'].includes(milestone.status)) {
        return res.status(409).json({ error: 'This milestone has already been decided' });
      }
      if (approve) {
        // Accepting a pending proposal or extension locks it in as the new dueDate.
        const proposed = data.proposedCompletionDate !== undefined
          ? data.proposedCompletionDate
          : milestone.proposedCompletionDate;
        if (proposed) {
          data.dueDate = proposed;
        } else if (milestone.extensionDaysRequested) {
          const currentDue = milestone.dueDate ? new Date(milestone.dueDate) : new Date();
          data.dueDate = new Date(currentDue.getTime() + milestone.extensionDaysRequested * 24 * 60 * 60 * 1000);
        }
        data.proposedCompletionDate = null;
        data.extensionDaysRequested = null;
        data.extensionReason = null;
        data.status = 'APPROVED';
        data.approvedById = req.user.id;
        data.approvedAt = new Date();
        auditLines.push('approved checkpoint / extension');
      } else {
        // Manager declined extension / reschedule request:
        // Restore status to APPROVED (or PENDING_APPROVAL) and clear all extension request fields
        data.status = milestone.approvedById ? 'APPROVED' : 'PENDING_APPROVAL';
        data.proposedCompletionDate = null;
        data.extensionDaysRequested = null;
        data.extensionReason = null;
        data.proposedById = null;
        data.proposedAt = null;
        auditLines.push(`declined extension request; maintained target date (${milestone.dueDate ? new Date(milestone.dueDate).toISOString().slice(0, 10) : 'none'})`);
      }
    }

    // ── Employee: tick / un-tick done ──────────────────────────────────────
    if (isDone !== undefined) {
      if (!isAssignee && !isManager) {
        return res.status(403).json({ error: 'Only the task owner can complete this milestone' });
      }
      if (isDone) {
        // Whether approval is required at all is a per-company choice (see
        // Company Settings / TenantSettings.milestoneRequireApproval) — off
        // by request, lets the assignee complete straight from their own
        // timeline, still subject to the usual overdue escalation.
        const settings = await getCompanySettings(tenantId);
        if (settings.milestoneRequireApproval && milestone.status !== 'APPROVED') {
          return res.status(409).json({ error: 'This milestone must be approved before it can be marked complete' });
        }
        if (!settings.milestoneRequireApproval && milestone.status === 'DONE') {
          return res.status(409).json({ error: 'This milestone is already complete' });
        }
        data.isDone = true;
        data.status = 'DONE';
        data.progress = 100;
        data.completedById = req.user.id;
        data.completedAt = new Date();
        auditLines.push('marked complete');
      } else {
        if (milestone.status !== 'DONE') {
          return res.status(409).json({ error: 'This milestone is not marked complete' });
        }
        // Un-ticking clears both — an item open again was not completed.
        data.isDone = false;
        data.status = 'APPROVED';
        data.progress = 0;
        data.completedById = null;
        data.completedAt = null;
        auditLines.push('reopened');
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No recognised update supplied' });
    }

    const updated = await prisma.taskMilestone.update({
      where: { id: mid },
      data,
      include: MILESTONE_INCLUDE,
    });

    await logTaskAudit({
      taskId, performedById: req.user.id, action: 'milestone_updated',
      details: `${req.user.name} ${auditLines.join('; ') || 'updated'} milestone "${updated.title}".`,
    });

    if (updated.status === 'APPROVED' || updated.status === 'DONE') {
      await maybeUnlockTask(taskId);
    }
    if (data.progress !== undefined || data.isDone !== undefined) {
      await syncTaskFromMilestones(taskId, req.user, tenantId);
    }

    // ── Milestone Completion: Broadcast to ALL stakeholders ─────────────
    const wasDone = milestone.isDone || milestone.status === 'DONE';
    const isNowDone = updated.isDone || updated.status === 'DONE';

    if (!wasDone && isNowDone) {
      await broadcastMilestoneCompleted({
        tenantId,
        task,
        milestone: updated,
        actorUser: req.user,
      });
    }

    // ── Manager Extension Decisions (Approve / Decline) ───────────────────
    if (approve === false) {
      // Notify assignee that extension was declined
      const notifyUsers = new Set();
      if (task.employeeId && task.employeeId !== req.user.id) notifyUsers.add(task.employeeId);
      for (const uid of notifyUsers) {
        await pushNotification({
          tenantId,
          recipientId: uid,
          type: 'TASK',
          title: `Extension Request Declined`,
          body: `The extension request for Station 0${milestone.order} ("${milestone.title}") on task "${task.title}" was declined by ${req.user.name}. The target date remains ${milestone.dueDate ? new Date(milestone.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unchanged'}.`,
          entityType: 'TASK',
          entityId: task.id,
        });
      }
    } else if (approve === true) {
      // Notify assignee that extension was approved
      const notifyUsers = new Set();
      if (task.employeeId && task.employeeId !== req.user.id) notifyUsers.add(task.employeeId);
      for (const uid of notifyUsers) {
        await pushNotification({
          tenantId,
          recipientId: uid,
          type: 'TASK',
          title: `Extension Request Approved`,
          body: `The extension request for Station 0${milestone.order} ("${milestone.title}") on task "${task.title}" was approved by ${req.user.name}. New target date is ${updated.dueDate ? new Date(updated.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'updated'}.`,
          entityType: 'TASK',
          entityId: task.id,
        });
      }
    } else if (isAssignee && extensionDaysRequested !== undefined && extensionDaysRequested !== null) {
      // Assignee requested extension — notify their direct manager
      const employeeRecord = await prisma.tenantUser.findUnique({
        where: { id: task.employeeId }, select: { managerId: true },
      });
      if (employeeRecord?.managerId && employeeRecord.managerId !== req.user.id) {
        await pushNotification({
          tenantId,
          recipientId: employeeRecord.managerId,
          type: 'TASK',
          title: `Extension Request: Station 0${milestone.order}`,
          body: `${req.user.name} requested +${extensionDaysRequested} day(s) extension for milestone "${updated.title}" on task "${task.title}". Reason: ${extensionReason || 'No reason provided'}.`,
          entityType: 'TASK',
          entityId: task.id,
        });
      }
    } else if (isAssignee && proposedCompletionDate !== undefined && proposedCompletionDate !== null) {
      const employeeRecord = await prisma.tenantUser.findUnique({
        where: { id: task.employeeId }, select: { managerId: true },
      });
      if (employeeRecord?.managerId && employeeRecord.managerId !== req.user.id) {
        await pushNotification({
          tenantId,
          recipientId: employeeRecord.managerId,
          type: 'TASK',
          title: `Proposed Date on "${task.title}"`,
          body: `${req.user.name} proposed a new completion date for milestone "${updated.title}".`,
          entityType: 'TASK',
          entityId: task.id,
        });
      }
    } else if (isManager && task.employeeId !== req.user.id && !isNowDone) {
      await pushNotification({
        tenantId, recipientId: task.employeeId, type: 'TASK',
        title: `Milestone Update on "${task.title}"`,
        body: `${req.user.name} ${auditLines.join('; ') || 'updated'} milestone "${updated.title}".`,
        entityType: 'TASK', entityId: task.id,
      });
    }

    res.json({ item: updated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── DELETE /api/tasks/:id/milestones/:mid ─────────────────────────────────
export async function deleteMilestone(req, res, next) {
  try {
    const { id: taskId, mid } = req.params;
    await loadTaskForUser(taskId, req.user, req.tenantId);
    if (!hasRole(req.user.role, MANAGER_OR_ELEVATED_ROLES)) {
      return res.status(403).json({ error: 'Only a manager (or above) can remove a milestone' });
    }
    const milestone = await loadMilestoneOrThrow(taskId, mid);

    await prisma.taskMilestone.delete({ where: { id: milestone.id } });

    // Re-number the remaining milestones so `order` stays a dense 1..N.
    const remaining = await prisma.taskMilestone.findMany({ where: { taskId }, orderBy: { order: 'asc' } });
    await Promise.all(remaining.map((m, i) => (
      m.order === i + 1 ? null : prisma.taskMilestone.update({ where: { id: m.id }, data: { order: i + 1 } })
    )).filter(Boolean));

    await logTaskAudit({
      taskId, performedById: req.user.id, action: 'milestone_deleted',
      details: `${req.user.name} removed milestone "${milestone.title}".`,
    });

    res.json({ success: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── GET /api/milestones/overdue ───────────────────────────────────────────
// Computed live, never stored — same philosophy as /platform/alerts. This is
// what the dashboard "Attention Required" card reads.
export async function listOverdueMilestones(req, res, next) {
  try {
    const { where, error } = await visibleTaskWhere({
      user: req.user, tenantId: req.tenantId, employeeId: 'all',
    });
    if (error) return res.status(error.status).json({ error: error.message });

    const now = new Date();
    const rows = await prisma.taskMilestone.findMany({
      where: {
        dueDate: { lt: now },
        status: { not: 'DONE' },
        task: where,
      },
      include: { task: { select: { id: true, title: true } } },
      orderBy: { dueDate: 'asc' },
    });

    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const items = rows.map((m) => ({
      id: m.id,
      taskId: m.taskId,
      taskTitle: m.task?.title || '',
      order: m.order,
      title: m.title,
      dueDate: m.dueDate,
      daysOverdue: Math.max(0, Math.floor((now.getTime() - new Date(m.dueDate).getTime()) / MS_PER_DAY)),
      status: m.status,
      watcherEmails: m.watcherEmails,
    }));

    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/milestones/assigned-to-me ────────────────────────────────────
// Milestones the caller owns, whichever team the parent task belongs to, so
// they surface on the caller's own task board.
export async function listMyAssignedMilestones(req, res, next) {
  try {
    const rows = await prisma.taskMilestone.findMany({
      where: { tenantId: req.tenantId, assigneeId: req.user.id },
      include: {
        ...MILESTONE_INCLUDE,
        task: {
          select: {
            id: true, title: true, status: true, priority: true, dueDate: true, goalId: true,
            employee: { select: { id: true, name: true, designation: true } },
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { order: 'asc' }],
    });
    const items = rows.filter((m) => m.task);
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
}

// ─── Helper for escaping XML in SVG strings ──────────────────────────────
function xmlEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── GET /api/tasks/:id/milestones/:mid/live-status.svg ───────────────────
// Dynamic live telemetry image stream for email clients. Returns real-time SVG status
// with zero cache headers so every time the email is opened, it renders live!
export async function getMilestoneLiveStatusSvg(req, res, next) {
  try {
    const { id: taskId, mid: milestoneId } = req.params;
    const milestone = await prisma.taskMilestone.findUnique({
      where: { id: milestoneId },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            milestones: {
              select: { id: true, order: true, title: true, status: true, dueDate: true },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, post-check=0, pre-check=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (!milestone) {
      return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="540" height="124" viewBox="0 0 540 124">
        <rect width="540" height="124" rx="14" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>
        <text x="270" y="65" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="13" font-weight="700" fill="#94a3b8">Checkpoint Station Not Found</text>
      </svg>`);
    }

    const now = new Date();
    const isDone = milestone.status === 'DONE';
    const isOverdue = !isDone && milestone.dueDate && new Date(milestone.dueDate) < now;

    let statusText = 'ON TRACK';
    let statusColor = '#3b82f6';
    let statusBg = '#1e293b';
    let iconChar = '●';

    if (isDone) {
      statusText = 'COMPLETED (100%)';
      statusColor = '#10b981';
      statusBg = '#064e3b';
      iconChar = '✓';
    } else if (isOverdue) {
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const daysOverdue = Math.max(1, Math.floor((now.getTime() - new Date(milestone.dueDate).getTime()) / MS_PER_DAY));
      statusText = `OVERDUE (${daysOverdue} DAY${daysOverdue > 1 ? 'S' : ''} LATE)`;
      statusColor = '#ef4444';
      statusBg = '#450a0a';
      iconChar = '!';
    } else if (milestone.status === 'PENDING_APPROVAL' || milestone.status === 'RESCHEDULE_REQUESTED') {
      statusText = 'AWAITING MANAGER APPROVAL';
      statusColor = '#f59e0b';
      statusBg = '#451a03';
      iconChar = '⏳';
    }

    const allMilestones = milestone.task?.milestones || [];
    const totalMilestones = Math.min(4, Math.max(1, allMilestones.length || 4));
    const completedCount = allMilestones.filter((m) => m.status === 'DONE').length;
    const completionPercent = Math.round((completedCount / (allMilestones.length || 1)) * 100);

    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

    // Up to 4 checkpoint slots
    const slotX = totalMilestones === 1
      ? [270]
      : totalMilestones === 2
        ? [160, 380]
        : totalMilestones === 3
          ? [90, 270, 450]
          : [70, 200, 340, 470];
    const stations = [1, 2, 3, 4].slice(0, totalMilestones).map((stepNum, idx) => {
      const found = allMilestones.find((m) => m.order === stepNum);
      const isTarget = found?.id === milestone.id;
      const stationDone = found?.status === 'DONE';
      const stationOverdue = !stationDone && found?.dueDate && new Date(found.dueDate) < now;

      let dotFill = '#1e293b';
      let dotStroke = '#334155';
      let labelColor = '#64748b';
      let char = `0${stepNum}`;
      let stateBadge = found ? 'PENDING' : 'EMPTY';

      if (stationDone) {
        dotFill = '#10b981';
        dotStroke = '#10b981';
        labelColor = '#10b981';
        char = '✓';
        stateBadge = 'COMPLETED';
      } else if (stationOverdue) {
        dotFill = '#ef4444';
        dotStroke = '#ef4444';
        labelColor = '#ef4444';
        char = '!';
        stateBadge = 'OVERDUE';
      } else if (isTarget) {
        dotFill = statusColor;
        dotStroke = '#93c5fd';
        labelColor = '#60a5fa';
        char = `0${stepNum}`;
        stateBadge = isDone ? 'COMPLETED' : 'ACTIVE';
      }

      const title = found ? found.title : `Checkpoint 0${stepNum}`;
      const shortTitle = title.length > 20 ? title.slice(0, 19) + '…' : title;

      return {
        x: slotX[idx] || (idx + 1) * 120,
        dotFill,
        dotStroke,
        labelColor,
        char,
        stateBadge,
        title: xmlEscape(shortTitle),
      };
    });

    const startX = slotX[0];
    const endX = slotX[slotX.length - 1];

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="124" viewBox="0 0 540 124">
      <defs>
        <linearGradient id="cyberBorder" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${statusColor}" stop-opacity="0.9"/>
          <stop offset="50%" stop-color="#334155" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="${statusColor}" stop-opacity="0.2"/>
        </linearGradient>
        <linearGradient id="pulseGlow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#3b82f6"/>
          <stop offset="100%" stop-color="${statusColor}"/>
        </linearGradient>
      </defs>

      <!-- Main Container Card -->
      <rect width="540" height="124" rx="14" fill="#0b0f19" stroke="url(#cyberBorder)" stroke-width="1.5"/>

      <!-- Top Row: Icon, Title, Status & Live UTC Pill -->
      <circle cx="30" cy="28" r="14" fill="${statusBg}" stroke="${statusColor}" stroke-width="2"/>
      <text x="30" y="33" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="900" fill="${statusColor}">${iconChar}</text>

      <text x="54" y="21" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="800" fill="#93c5fd" letter-spacing="1">CRITICAL CHECKPOINTS // CHECKPOINT 0${milestone.order} OF 0${totalMilestones}</text>
      <text x="54" y="39" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="900" fill="#f8fafc" letter-spacing="0.3">${statusText}</text>

      <!-- Live Sync Pill -->
      <rect x="382" y="16" width="138" height="24" rx="12" fill="#1e293b" stroke="#334155" stroke-width="1"/>
      <circle cx="396" cy="28" r="3.5" fill="${statusColor}"/>
      <text x="406" y="32" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="800" fill="#cbd5e1" letter-spacing="0.5">LIVE · ${timeStr} UTC</text>

      <!-- Subtle Divider Line -->
      <line x1="20" y1="52" x2="520" y2="52" stroke="#1f293d" stroke-width="1"/>

      <!-- Connecting Progress Track Bar -->
      ${slotX.length > 1 ? `
      <line x1="${startX}" y1="74" x2="${endX}" y2="74" stroke="#1e293b" stroke-width="3" stroke-linecap="round"/>
      <line x1="${startX}" y1="74" x2="${startX + (endX - startX) * (completionPercent / 100)}" y2="74" stroke="url(#pulseGlow)" stroke-width="3" stroke-linecap="round"/>
      ` : ''}

      <!-- Checkpoint Nodes -->
      ${stations.map((s) => `
        <g>
          <circle cx="${s.x}" cy="74" r="11" fill="${s.dotFill}" stroke="${s.dotStroke}" stroke-width="2"/>
          <text x="${s.x}" y="78" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="900" fill="#ffffff">${s.char}</text>
          <text x="${s.x}" y="98" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="700" fill="#e2e8f0">${s.title}</text>
          <text x="${s.x}" y="111" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="8.5" font-weight="800" fill="${s.labelColor}" letter-spacing="0.5">${s.stateBadge}</text>
        </g>
      `).join('')}
    </svg>`;

    return res.send(svg);
  } catch (err) {
    next(err);
  }
}
