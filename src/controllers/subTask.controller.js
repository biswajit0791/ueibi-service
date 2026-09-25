/**
 * subTask.controller.js
 *
 * Sub-tasks: a full record of a piece of work inside a task — title,
 * description, assignee, planned dates and actual dates.
 *
 * Two rules govern this whole file:
 *
 *   1. NO WEIGHT. A sub-task never changes the parent task's progress, the
 *      parent task's weight, or the goal's weight total. Nothing here calls
 *      recalculateProgress and nothing here writes to `task.progress`. If that
 *      ever changes, the goal execution lock and the completion figures both
 *      start lying.
 *
 *   2. The rules it DOES share are reused, not re-implemented. Assignment goes
 *      through the same `resolveTargetEmployee` as task assignment, so the role
 *      hierarchy cannot drift between the two. Actual dates obey the same
 *      "back-dating yes, future no" rule as a task's.
 *
 * Access is inherited from the parent task: `loadTaskForUser` already decides
 * who may act on a task, and a sub-task under it is no more sensitive.
 */
import { prisma } from '../lib/prisma.js';
import { loadTaskForUser } from '../services/taskAccess.service.js';
import { resolveTargetEmployee } from './task.controller.js';
import { logTaskAudit } from './taskActivity.controller.js';
import { emitToTenant } from '../lib/socket.js';
import { taskTiming } from '../lib/taskTiming.js';
import {
  createSubTaskSchema, updateSubTaskSchema, reorderSubTasksSchema,
  subTaskParamSchema, subTaskChildParamSchema,
} from '../validations/subTask.schema.js';

const SUBTASK_SELECT = {
  id: true, taskId: true, title: true, description: true, isDone: true, position: true,
  assigneeId: true, startDate: true, dueDate: true,
  actualStartDate: true, actualCompletionDate: true,
  completedById: true, createdAt: true, updatedAt: true,
  assignee: { select: { id: true, name: true, role: true, designation: true } },
  completedBy: { select: { id: true, name: true } },
};

/** The list plus the counts every screen wants, with delay figures per row. */
async function listFor(taskId) {
  const rows = await prisma.subTask.findMany({
    where: { taskId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: SUBTASK_SELECT,
  });
  // A sub-task is either done or not, so it is fed to the shared timing helper
  // as 100% or 0% — the same delay arithmetic tasks use, no second copy of it.
  const items = rows.map((s) => ({
    ...s,
    timing: taskTiming({
      status: s.isDone ? 'done' : 'todo',
      progress: s.isDone ? 100 : 0,
      startDate: s.startDate,
      dueDate: s.dueDate,
      actualStartDate: s.actualStartDate,
      actualCompletionDate: s.actualCompletionDate,
    }),
  }));
  const done = items.filter((s) => s.isDone).length;
  return {
    items,
    total: items.length,
    done,
    // Display only. NOT written to the task and not part of the goal roll-up.
    checklistPercent: items.length ? Math.round((done / items.length) * 100) : 0,
  };
}

/**
 * Planned and actual dates for a sub-task.
 *
 * Same asymmetry as a task: back-dating is allowed because recording work that
 * started earlier is the point; the future is refused because a task cannot
 * have begun tomorrow, and permitting it would yield negative delays that
 * quietly flatter the numbers.
 */
function resolveDates(input, existing = {}) {
  const now = Date.now();
  const out = {};

  const parse = (value, label, { noFuture = false } = {}) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw { status: 400, message: `${label} is not a valid date` };
    if (noFuture && d.getTime() > now) throw { status: 400, message: `${label} cannot be in the future` };
    return d;
  };

  const startDate = parse(input.startDate, 'Start date');
  const dueDate = parse(input.dueDate, 'Due date');
  const actualStartDate = parse(input.actualStartDate, 'Actual start date', { noFuture: true });
  const actualCompletionDate = parse(input.actualCompletionDate, 'Actual completion date', { noFuture: true });

  if (startDate !== undefined) out.startDate = startDate;
  if (dueDate !== undefined) out.dueDate = dueDate;
  if (actualStartDate !== undefined) out.actualStartDate = actualStartDate;
  if (actualCompletionDate !== undefined) out.actualCompletionDate = actualCompletionDate;

  const pick = (key) => (out[key] !== undefined ? out[key] : existing[key]);

  if (pick('startDate') && pick('dueDate') && new Date(pick('dueDate')) < new Date(pick('startDate'))) {
    throw { status: 400, message: 'Due date cannot be earlier than the start date' };
  }
  if (pick('actualStartDate') && pick('actualCompletionDate')
      && new Date(pick('actualCompletionDate')) < new Date(pick('actualStartDate'))) {
    throw { status: 400, message: 'Actual completion date cannot be earlier than the actual start date' };
  }

  return out;
}

/**
 * Who this piece may be handed to.
 *
 * Delegated to the very function task assignment uses, so a manager's reach
 * over sub-tasks is identical to their reach over tasks and the two cannot
 * drift apart. Null means "whoever owns the parent task".
 */
async function resolveAssignee(assigneeId, req, parentTask) {
  if (assigneeId === undefined) return undefined;
  if (assigneeId === null || assigneeId === '') return null;
  // `parentTask` is deliberately NOT passed through.
  //
  // Handing it over would take the dependency branch of that function, which
  // says "you may spin a companion task onto a colleague from a task you own"
  // — and that branch accepts any target, so an employee could assign a piece
  // of their own task to an HR director. A sub-task is a breakdown of the
  // work, not a request to somebody else, so it takes the plain role
  // hierarchy: employees to themselves, managers within their line, elevated
  // roles freely. The goal is still passed so a manager's co-assignment on it
  // counts.
  const target = await resolveTargetEmployee(
    req.user, req.tenantId, assigneeId, null, parentTask?.goalId || null,
  );
  return target.id;
}

const notifyTenant = (tenantId, taskId, summary) =>
  emitToTenant(tenantId, 'subtask_updated', { taskId, ...summary });

const fail = (res, err) => res.status(err.status || 500).json({ error: err.message || 'Request failed' });

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
    if (err.status) return fail(res, err);
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

    const assigneeId = await resolveAssignee(parsed.data.assigneeId, req, task);
    const dates = resolveDates(parsed.data);

    const isDone = parsed.data.isDone === true;
    // Ticking it on creation records the completion now, unless one was given.
    if (isDone && dates.actualCompletionDate === undefined) dates.actualCompletionDate = new Date();

    const last = await prisma.subTask.findFirst({
      where: { taskId: id }, orderBy: { position: 'desc' }, select: { position: true },
    });

    const created = await prisma.subTask.create({
      data: {
        tenantId: req.tenantId,
        taskId: id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        isDone,
        assigneeId: assigneeId ?? null,
        completedById: isDone ? req.user.id : null,
        position: parsed.data.position ?? ((last?.position ?? -1) + 1),
        createdById: req.user.id,
        ...dates,
      },
      select: SUBTASK_SELECT,
    });

    await logTaskAudit({
      taskId: id,
      performedById: req.user.id,
      action: 'edited',
      details: `Sub-task added: "${created.title}".`,
    }).catch(() => { /* the sub-task is not worth failing the request over */ });

    const summary = await listFor(id);
    notifyTenant(task.tenantId, id, summary);
    res.status(201).json({ subTask: created, ...summary });
  } catch (err) {
    if (err.status) return fail(res, err);
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

    const assigneeId = await resolveAssignee(parsed.data.assigneeId, req, task);
    const dates = resolveDates(parsed.data, existing);
    const { title, description, isDone, position } = parsed.data;

    // Ticking stamps the completion and who did it; un-ticking clears both,
    // because a sub-task that is open again has not finished.
    const tickChanged = isDone !== undefined && isDone !== existing.isDone;
    if (tickChanged) {
      if (isDone) {
        if (dates.actualCompletionDate === undefined && !existing.actualCompletionDate) {
          dates.actualCompletionDate = new Date();
        }
      } else if (dates.actualCompletionDate === undefined) {
        dates.actualCompletionDate = null;
      }
    }

    const updated = await prisma.subTask.update({
      where: { id: sid },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(assigneeId !== undefined ? { assigneeId } : {}),
        ...(isDone !== undefined ? { isDone } : {}),
        ...(tickChanged ? { completedById: isDone ? req.user.id : null } : {}),
        ...dates,
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
    if (err.status) return fail(res, err);
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
    if (err.status) return fail(res, err);
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
    if (err.status) return fail(res, err);
    next(err);
  }
}
