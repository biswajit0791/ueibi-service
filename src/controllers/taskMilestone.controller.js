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
 *   - only the task's own assignee may propose a date or tick one done
 */
import { prisma } from '../lib/prisma.js';
import { loadTaskForUser } from '../services/taskAccess.service.js';
import { visibleTaskWhere } from '../services/taskVisibility.service.js';
import { logTaskAudit, pushNotification } from './taskActivity.controller.js';
import { MANAGER_OR_ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { getCompanySettings, findDisallowedWatcherEmails } from '../services/companySettings.service.js';
import {
  createMilestoneSchema, updateMilestoneSchema, MAX_MILESTONES_PER_TASK,
} from '../validations/taskMilestone.schema.js';

const MILESTONE_INCLUDE = {
  proposedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

async function loadMilestoneOrThrow(taskId, milestoneId) {
  const milestone = await prisma.taskMilestone.findFirst({
    where: { id: milestoneId, taskId },
  });
  if (!milestone) throw { status: 404, message: 'Milestone not found on this task' };
  return milestone;
}

/** Throws a 400 naming every watcher email whose domain isn't on the
 *  tenant's allowlist (its own registered domain, plus Company Settings). */
async function assertWatcherEmailsAllowed(tenantId, emails) {
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

// ─── GET /api/tasks/:id/milestones ─────────────────────────────────────────
export async function listMilestones(req, res, next) {
  try {
    const { id: taskId } = req.params;
    await loadTaskForUser(taskId, req.user, req.tenantId);

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
    const { title, dueDate, watcherEmails } = parsed.data;
    await assertWatcherEmailsAllowed(tenantId, watcherEmails);

    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) {
      return res.status(400).json({ error: 'Invalid milestone due date' });
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
        dueDate: due,
        watcherEmails,
        status: 'PENDING_APPROVAL',
        createdById: req.user.id,
      },
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

    if (task.employeeId !== req.user.id) {
      await pushNotification({
        tenantId, recipientId: task.employeeId, type: 'task_update',
        title: `New milestone on "${task.title}"`,
        body: `${req.user.name} added milestone "${milestone.title}", due ${due.toISOString().slice(0, 10)}.`,
        entityType: 'milestone', entityId: milestone.id,
      });
    }

    res.status(201).json({ item: milestone });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── PATCH /api/tasks/:id/milestones/:mid ──────────────────────────────────
export async function updateMilestone(req, res, next) {
  try {
    const { id: taskId, mid } = req.params;
    const tenantId = req.tenantId;
    const task = await loadTaskForUser(taskId, req.user, tenantId);
    const milestone = await loadMilestoneOrThrow(taskId, mid);

    const parsed = updateMilestoneSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { title, dueDate, watcherEmails, proposedCompletionDate, approve, isDone } = parsed.data;

    const isManager = hasRole(req.user.role, MANAGER_OR_ELEVATED_ROLES);
    const isAssignee = task.employeeId === req.user.id;
    const data = {};
    const auditLines = [];

    // ── Manager: edit the milestone's own fields ──────────────────────────
    if (title !== undefined || dueDate !== undefined || watcherEmails !== undefined) {
      if (!isManager) {
        return res.status(403).json({ error: 'Only a manager (or above) can edit a milestone' });
      }
      if (milestone.status === 'DONE') {
        return res.status(409).json({ error: 'This milestone is already complete and cannot be edited' });
      }
      if (title !== undefined) data.title = title.trim();
      if (watcherEmails !== undefined) {
        await assertWatcherEmailsAllowed(tenantId, watcherEmails);
        data.watcherEmails = watcherEmails;
      }
      if (dueDate !== undefined) {
        const due = new Date(dueDate);
        if (Number.isNaN(due.getTime())) {
          return res.status(400).json({ error: 'Invalid milestone due date' });
        }
        if (task.dueDate && due > new Date(task.dueDate)) {
          return res.status(400).json({ error: "Milestone due date cannot be later than the task's own due date" });
        }
        data.dueDate = due;
        auditLines.push(`due date set to ${due.toISOString().slice(0, 10)}`);
      }
    }

    // ── Employee: propose a new completion date ───────────────────────────
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
        // Accepting a pending proposal locks it in as the new dueDate.
        const proposed = data.proposedCompletionDate !== undefined
          ? data.proposedCompletionDate
          : milestone.proposedCompletionDate;
        if (proposed) data.dueDate = proposed;
        data.status = 'APPROVED';
        data.approvedById = req.user.id;
        data.approvedAt = new Date();
        auditLines.push('approved');
      } else {
        data.status = 'RESCHEDULE_REQUESTED';
        data.proposedCompletionDate = null;
        auditLines.push('sent the proposed date back for another try');
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

    // Notify the other side of the conversation.
    if (isAssignee && approve === undefined && proposedCompletionDate !== undefined) {
      // Employee proposed — tell whoever can approve it (their reporting manager, if any).
      const employeeRecord = await prisma.tenantUser.findUnique({
        where: { id: task.employeeId }, select: { managerId: true },
      });
      if (employeeRecord?.managerId) {
        await pushNotification({
          tenantId, recipientId: employeeRecord.managerId, type: 'task_update',
          title: `Proposed date on "${task.title}"`,
          body: `${req.user.name} proposed a new completion date for milestone "${updated.title}".`,
          entityType: 'milestone', entityId: updated.id,
        });
      }
    } else if (isManager && task.employeeId !== req.user.id) {
      await pushNotification({
        tenantId, recipientId: task.employeeId, type: 'task_update',
        title: `Milestone update on "${task.title}"`,
        body: `${req.user.name} ${auditLines.join('; ') || 'updated'} milestone "${updated.title}".`,
        entityType: 'milestone', entityId: updated.id,
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
