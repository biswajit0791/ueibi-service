/**
 * subTask.controller.js
 *
 * Checklist items under a task: what someone is actually working through, and
 * when each piece was finished.
 *
 * The rule that governs this whole file: a sub-task NEVER changes the parent
 * task's progress, the parent task's weight, or the goal's weight total. It is
 * a record, not a measure. Nothing here calls recalculateProgress and nothing
 * here writes to `task.progress` — if that ever changes, the goal execution
 * lock and the completion figures both start lying.
 *
 * Access is inherited from the parent task rather than reimplemented:
 * `loadTaskForUser` already decides who may act on a task, and a checklist
 * under it is not more sensitive than the task itself.
 */
import { prisma } from '../lib/prisma.js';
import { loadTaskForUser } from '../services/taskAccess.service.js';
import { logTaskAudit } from './taskActivity.controller.js';
import { emitToTenant } from '../lib/socket.js';
import {
  createSubTaskSchema, updateSubTaskSchema, reorderSubTasksSchema,
  subTaskParamSchema, subTaskChildParamSchema,
} from '../validations/subTask.schema.js';

const SUBTASK_SELECT = {
  id: true, taskId: true, title: true, isDone: true, position: true,
  assigneeId: true, completedAt: true, completedById: true, createdAt: true, updatedAt: true,
  assignee: { select: { id: true, name: true, role: true } },
  completedBy: { select: { id: true, name: true } },
};

/** The list plus the counts every screen wants, in one shape. */
async function listFor(taskId) {
  const items = await prisma.subTask.findMany({
    where: { taskId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: SUBTASK_SELECT,
  });
  const done = items.filter((s) => s.isDone).length;
  return {
    items,
    total: items.length,
    done,
    // Reported for display only. It is NOT written to the task and does not
    // feed the goal roll-up; a task's percentage stays whatever its owner set.
    checklistPercent: items.length ? Math.round((done / items.length) * 100) : 0,
  };
}

/**
 * A sub-task may only be pointed at someone in the caller's own tenant.
 * Beyond that it inherits the parent task's access rule — if you may act on
 * the task, you may hand a piece of it to a colleague.
 */
async function resolveAssignee(assigneeId, tenantId) {
  if (assigneeId === undefined) return undefined;
  if (assigneeId === null || assigneeId === '') return null;
  const user = await prisma.tenantUser.findFirst({
    where: { id: assigneeId, tenantId, isDeleted: false },
    select: { id: true },
  });
  if (!user) {
    throw { status: 400, message: 'That person is not in your organisation' };
  }
  return user.id;
}

const notifyTenant = (tenantId, taskId, summary) =>
  emitToTenant(tenantId, 'subtask_updated', { taskId, ...summary });

// ─── GET /api/tasks/:id/subtasks ────────────────────────────────────────────
export async function listSubTasks(req, res, next) {
  try {
    const parsed = subTaskParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid task ID parameter', details: parsed.error.issues });
    }
    await loadTaskForUser(parsed.data.id, req.user, req.tenantId);
    res.json(await listFor(parsed.data.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── POST /api/tasks/:id/subtasks ───────────────────────────────────────────
export async function createSubTask(req, res, next) {
  try {
    const parsedParams = subTaskParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid task ID parameter', details: parsedParams.error.issues });
    }
    const parsed = createSubTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { id } = parsedParams.data;
    const task = await loadTaskForUser(id, req.user, req.tenantId);

    const assigneeId = await resolveAssignee(parsed.data.assigneeId, req.tenantId);

    const last = await prisma.subTask.findFirst({
      where: { taskId: id }, orderBy: { position: 'desc' }, select: { position: true },
    });
    const isDone = parsed.data.isDone === true;

    const created = await prisma.subTask.create({
      data: {
        tenantId: req.tenantId,
        taskId: id,
        title: parsed.data.title,
        isDone,
        assigneeId: assigneeId ?? null,
        completedAt: isDone ? new Date() : null,
        completedById: isDone ? req.user.id : null,
        position: parsed.data.position ?? ((last?.position ?? -1) + 1),
        createdById: req.user.id,
      },
      select: SUBTASK_SELECT,
    });

    await logTaskAudit({
      taskId: id,
      performedById: req.user.id,
      action: 'edited',
      details: `Sub-task added: "${created.title}".`,
    }).catch(() => { /* the checklist is not worth failing the request over */ });

    const summary = await listFor(id);
    notifyTenant(task.tenantId, id, summary);
    res.status(201).json({ subTask: created, ...summary });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── PATCH /api/tasks/:id/subtasks/:sid ─────────────────────────────────────
export async function updateSubTask(req, res, next) {
  try {
    const parsedParams = subTaskChildParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = updateSubTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { id, sid } = parsedParams.data;
    const task = await loadTaskForUser(id, req.user, req.tenantId);

    const existing = await prisma.subTask.findFirst({ where: { id: sid, taskId: id } });
    if (!existing) return res.status(404).json({ error: 'Sub-task not found on this task' });

    const assigneeId = await resolveAssignee(parsed.data.assigneeId, req.tenantId);
    const { title, isDone, position } = parsed.data;

    // Ticking stamps who and when; un-ticking clears both, because a sub-task
    // that is open again was not completed.
    const tickChanged = isDone !== undefined && isDone !== existing.isDone;

    const updated = await prisma.subTask.update({
      where: { id: sid },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(assigneeId !== undefined ? { assigneeId } : {}),
        ...(isDone !== undefined ? { isDone } : {}),
        ...(tickChanged
          ? isDone
            ? { completedAt: new Date(), completedById: req.user.id }
            : { completedAt: null, completedById: null }
          : {}),
      },
      select: SUBTASK_SELECT,
    });

    if (tickChanged) {
      await logTaskAudit({
        taskId: id,
        performedById: req.user.id,
        action: 'edited',
        details: `Sub-task ${isDone ? 'completed' : 'reopened'}: "${updated.title}".`,
      }).catch(() => {});
    }

    const summary = await listFor(id);
    notifyTenant(task.tenantId, id, summary);
    res.json({ subTask: updated, ...summary });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── DELETE /api/tasks/:id/subtasks/:sid ────────────────────────────────────
export async function deleteSubTask(req, res, next) {
  try {
    const parsedParams = subTaskChildParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const { id, sid } = parsedParams.data;
    const task = await loadTaskForUser(id, req.user, req.tenantId);

    const existing = await prisma.subTask.findFirst({ where: { id: sid, taskId: id } });
    if (!existing) return res.status(404).json({ error: 'Sub-task not found on this task' });

    await prisma.subTask.delete({ where: { id: sid } });
    await logTaskAudit({
      taskId: id,
      performedById: req.user.id,
      action: 'edited',
      details: `Sub-task removed: "${existing.title}".`,
    }).catch(() => {});

    const summary = await listFor(id);
    notifyTenant(task.tenantId, id, summary);
    res.json({ success: true, ...summary });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── PATCH /api/tasks/:id/subtasks-order ────────────────────────────────────
export async function reorderSubTasks(req, res, next) {
  try {
    const parsedParams = subTaskParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid task ID parameter', details: parsedParams.error.issues });
    }
    const parsed = reorderSubTasksSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { id } = parsedParams.data;
    const task = await loadTaskForUser(id, req.user, req.tenantId);

    const owned = await prisma.subTask.findMany({ where: { taskId: id }, select: { id: true } });
    const ownedIds = new Set(owned.map((s) => s.id));
    const stray = parsed.data.order.filter((sid) => !ownedIds.has(sid));
    if (stray.length) {
      return res.status(400).json({ error: `These sub-tasks do not belong to this task: ${stray.join(', ')}` });
    }

    await prisma.$transaction(
      parsed.data.order.map((sid, index) =>
        prisma.subTask.update({ where: { id: sid }, data: { position: index } })),
    );

    const summary = await listFor(id);
    notifyTenant(task.tenantId, id, summary);
    res.json(summary);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}
