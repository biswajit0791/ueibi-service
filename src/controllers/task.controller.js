import { prisma } from '../lib/prisma.js';
import { logTaskAudit } from './taskActivity.controller.js';
import { emitToTenant } from '../lib/socket.js';
import { createTaskSchema, updateTaskSchema, updateTaskStatusSchema, taskIdParamSchema, listTasksQuerySchema } from '../validations/task.schema.js';
import { goalService } from '../services/goal.service.js';
import { loadTaskForUser, getCompanionTaskId } from '../services/taskAccess.service.js';
import { ELEVATED_ROLES, SUPER_ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { TASK_STATUSES } from '../lib/workflowStatus.js';
import {
  assertGoalUnlocked, assertWeightFits, defaultWeightFor, goalWeightSummary, withWeightGuard,
} from '../services/goalWeight.service.js';
import { timingUpdates, isWorkStarted, taskTiming } from '../lib/taskTiming.js';
import { visibleTaskWhere } from '../services/taskVisibility.service.js';

// ─── Helper: actual start / completion dates ───────────────────────────────
//
// These are normally stamped automatically as a task moves, which is what
// makes the delay figures trustworthy. They can also be entered by hand, for
// the real case of work that began before it was entered into the system.
//
// Two rules apply, and they are asymmetric on purpose:
//   - BACKWARDS is allowed. Recording that work actually started last Tuesday
//     is the whole point of letting these be set.
//   - FORWARDS is not. A task cannot have started or finished in the future;
//     that is not a correction, it is nonsense, and it would produce negative
//     delays that quietly flatter the numbers.
// Completion may also not precede the start.
function resolveActualDates({ suppliedStart, suppliedCompletion, auto, existing = {} }) {
  const out = { ...auto };
  const now = Date.now();

  const parse = (value, label) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw { status: 400, message: `${label} is not a valid date` };
    }
    if (d.getTime() > now) {
      throw { status: 400, message: `${label} cannot be in the future` };
    }
    return d;
  };

  const start = parse(suppliedStart, 'Actual start date');
  const completion = parse(suppliedCompletion, 'Actual completion date');

  if (start !== undefined) out.actualStartDate = start;
  if (completion !== undefined) out.actualCompletionDate = completion;

  // When a completion date is recorded by hand and no start date is known,
  // do NOT keep the automatic start of "now". Auto-stamping assumes a task
  // completed without ever being started began at the moment it finished,
  // which is fine live but wrong for history: it would place the start after
  // the completion and trip the ordering rule below with a confusing message.
  // An unknown start is better recorded as unknown.
  if (completion !== undefined && completion !== null
      && start === undefined && !existing.actualStartDate) {
    delete out.actualStartDate;
  }

  const finalStart = out.actualStartDate !== undefined ? out.actualStartDate : existing.actualStartDate;
  const finalCompletion = out.actualCompletionDate !== undefined
    ? out.actualCompletionDate : existing.actualCompletionDate;

  if (finalStart && finalCompletion && new Date(finalCompletion) < new Date(finalStart)) {
    throw { status: 400, message: 'Actual completion date cannot be earlier than the actual start date' };
  }

  return {
    data: out,
    manuallySet: start !== undefined || completion !== undefined,
  };
}

/**
 * A task carrying an actual completion date IS complete.
 *
 * Without this, recording "this ran from the 11th to the 22nd" on a new task
 * left it at todo/0% while holding a completion date, and the timing helper
 * quite rightly called it OVERDUE. That is contradictory data, not a reporting
 * bug. So: recording a completion date completes the task, and stating the
 * opposite outright is refused rather than silently resolved one way.
 */
function reconcileCompletion({ completionDate, status, progress }) {
  if (!completionDate) return null;
  const saysIncomplete = (status !== undefined && status !== null && status !== 'done')
    || (progress !== undefined && progress !== null && Number(progress) < 100);
  if (saysIncomplete) {
    throw {
      status: 400,
      message: 'A task with an actual completion date is complete. Either clear the completion date, or set the task to 100%.',
    };
  }
  return { status: 'done', progress: 100 };
}

// ─── Helper: weight-rule failures ──────────────────────────────────────────
// These carry a summary the UI needs (what the total is, what is missing), so
// they are answered here rather than handed to the generic error handler,
// which would keep the message and drop everything else.
// Delay / overdue figures travel with every task, computed server-side from
// the planned and actual dates so every screen reports the same number.
const withTiming = (t) => ({ ...t, timing: taskTiming(t) });

const WEIGHT_CODES = ['GOAL_WEIGHT_INCOMPLETE', 'GOAL_WEIGHT_EXCEEDED', 'GOAL_AWAITING_APPROVAL'];
function sendWeightError(res, e) {
  if (!e || !WEIGHT_CODES.includes(e.code)) return false;
  res.status(e.status || 400).json({
    success: false,
    code: e.code,
    error: e.message,
    message: e.message,
    ...(e.weightSummary ? { weightSummary: e.weightSummary } : {}),
    ...(e.available !== undefined ? { available: e.available } : {}),
  });
  return true;
}

// ─── Helper: resolve & authorise target employee ───────────────────────────
// Returns the TenantUser record that will own the task.
// Verifies the employee belongs to the SAME tenant as the requesting user.
export async function resolveTargetEmployee(requestingUser, tenantId, employeeId, parentTask = null, goalId = null) {
  // If no employeeId supplied → default to the requesting user themselves
  if (!employeeId) {
    return { id: requestingUser.id };
  }

  // If assigning to self → fast path (no extra DB check needed)
  if (employeeId === requestingUser.id) {
    return { id: requestingUser.id };
  }

  // Verify the target employee exists AND belongs to the authenticated tenant
  const targetUser = await prisma.tenantUser.findFirst({
    where: { id: employeeId, tenantId, isDeleted: false },
  });

  if (!targetUser) {
    throw { status: 403, message: 'Access forbidden: target employee not found in your organisation' };
  }

  // Tier 4: Elevated roles can assign across the org freely
  if (hasRole(requestingUser.role, ELEVATED_ROLES)) {
    const callerRole = String(requestingUser.role || '').toUpperCase();
    const targetRole = String(targetUser.role || '').toUpperCase();
    // HR cannot assign tasks to higher authority roles (CMD, ADMIN, SUPER_ADMIN)
    if (callerRole === 'HR' && targetUser.id !== requestingUser.id && hasRole(targetRole, SUPER_ELEVATED_ROLES)) {
      throw {
        status: 403,
        message: `Access forbidden: HR cannot assign tasks to higher authority roles (${targetRole})`,
      };
    }
    return targetUser;
  }

  // Peer dependency: you may spin off a companion task on a colleague ONLY when
  // it hangs off a real parent task that YOU own (or manage).
  if (parentTask) {
    const ownsParent = parentTask.employeeId === requestingUser.id
      || await goalService.isSubordinate(requestingUser.id, parentTask.employeeId, tenantId);
    if (ownsParent) {
      return targetUser;
    }
    throw { status: 403, message: 'Access forbidden: you can only raise a dependency from a task you own' };
  }

  const callerRole = String(requestingUser.role || '').toUpperCase();
  const targetRole = String(targetUser.role || '').toUpperCase();
  const elevatedRoleList = ['SUPER_ADMIN', 'ADMIN', 'HR', 'CMD', 'DIRECTOR', 'OWNER', 'LEADERSHIP'];

  // Who a MANAGER may not hand work to: their peers, anyone above them, and
  // FINANCE.
  //
  // This is a separate list from the one above on purpose. `elevatedRoleList`
  // answers "who may assign to other people at all", and FINANCE must NOT be
  // in that — a finance user assigns only to themselves, like an employee.
  // But it was also being used to answer "who is off-limits to a manager",
  // and because FINANCE was absent from it, a manager could assign work to
  // the finance head. One list cannot answer both questions.
  const managerMayNotAssignTo = [...elevatedRoleList, 'MANAGER', 'FINANCE'];

  // Regular EMPLOYEE: Cannot assign main tasks to other people (especially higher roles)
  if (callerRole === 'EMPLOYEE' || !['MANAGER', ...elevatedRoleList].includes(callerRole)) {
    throw {
      status: 403,
      message: 'Access forbidden: employees can only assign tasks to themselves. To request support from a colleague, use the dependency option.',
    };
  }

  // MANAGER:
  if (callerRole === 'MANAGER') {
    // Cannot assign to peer managers, higher authority roles, or FINANCE.
    if (managerMayNotAssignTo.includes(targetRole)) {
      throw {
        status: 403,
        message: `Access forbidden: managers cannot assign tasks to peer or higher authority roles (${targetRole})`,
      };
    }

    // 1. Direct or indirect downline subordinate:
    if (await goalService.isSubordinate(requestingUser.id, employeeId, tenantId)) {
      return targetUser;
    }

    // 2. Co-assigned on the goal:
    if (goalId) {
      const coAssigned = await prisma.goalAssignment.findFirst({
        where: { goalId, employeeId, tenantId },
      });
      if (coAssigned) {
        return targetUser;
      }
    }

    // 3. Same department or target employee has no explicit manager set:
    if (requestingUser.department && targetUser.department === requestingUser.department) {
      return targetUser;
    }
    if (!targetUser.managerId) {
      return targetUser;
    }
  }

  throw { status: 403, message: 'Access forbidden: you are not authorised to assign tasks to this employee' };
}

// ─── Helper: assert task exists & requester owns/manages it ────────────────
// Thin wrapper around the shared taskAccess service so task.controller and
// taskActivity.controller enforce exactly the same rule.
const assertTaskOwner = (id, requestingUser, tenantId) => loadTaskForUser(id, requestingUser, tenantId);

// ─── Helper: validate goal belongs to same tenant ─────────────────────────
async function resolveGoal(goalId, tenantId) {
  if (!goalId) return null;

  const goal = await prisma.goal.findFirst({ where: { id: goalId } });
  if (!goal) throw { status: 404, message: `Goal not found: ${goalId}` };
  if (goal.tenantId !== tenantId) {
    throw { status: 403, message: 'Access forbidden: goal belongs to a different organisation' };
  }
  return goal;
}

async function recalculateGoalProgress(goalId, employeeId = null) {
  if (!goalId) return 0;
  return await goalService.recalculateProgress(goalId, employeeId);
}

// ─── POST /api/tasks ────────────────────────────────────────────────────────
export async function createTask(req, res, next) {
  try {
    // 1. Guard: tenant context must be present (set by auth middleware from JWT)
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: 'Tenant context is required to create a task' });
    }

    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      title, priority, startDate, dueDate, financialYear,
      tags, goalId, isPrivate, isStandalone, weight,
      description, employeeId, employeeIds, dependency, isDependencyOf,
      status, progress, actualStartDate, actualCompletionDate,
    } = parsed.data;

    // 3. Date validation: dueDate must not be earlier than startDate
    if (startDate && dueDate) {
      const start = new Date(startDate);
      const due = new Date(dueDate);
      if (isNaN(start.getTime()) || isNaN(due.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid date format for startDate or dueDate' });
      }
      if (due < start) {
        return res.status(400).json({
          success: false,
          message: 'Due date cannot be earlier than start date',
        });
      }
    }

    // 4a. If this task is a companion of a parent ("dependency") task, that parent
    //     must be a real task in this tenant that the caller is allowed to act on.
    let parentTask = null;
    if (isDependencyOf) {
      try {
        parentTask = await loadTaskForUser(isDependencyOf, req.user, tenantId);
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message || 'Invalid parent task' });
      }
    }

    // 4b. Determine target employee(s) (single or multiple)
    const targetEmployeeIds = Array.isArray(employeeIds) && employeeIds.length > 0
      ? Array.from(new Set(employeeIds.filter(Boolean)))
      : [employeeId || req.user.id];

    // 5. Validate goal tenant scope (if goalId provided)
    let resolvedGoal = null;
    let resolvedGoalId = null;
    if (!isStandalone && goalId) {
      try {
        resolvedGoal = await resolveGoal(goalId, tenantId);
        resolvedGoalId = resolvedGoal?.id || null;
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }
    }

    // 5b. Weight. Resolved once, before the loop, because one submission can
    //     create a task per assignee and they each carry the full weight — so
    //     the ceiling has to be measured against the whole batch, not against
    //     one task at a time.
    let resolvedWeight = weight === undefined || weight === null || weight === ''
      ? await defaultWeightFor(resolvedGoalId, targetEmployeeIds.length)
      : Number(weight);
    if (!Number.isFinite(resolvedWeight) || resolvedWeight < 1) resolvedWeight = 1;

    if (resolvedGoalId) {
      try {
        await assertWeightFits({
          goalId: resolvedGoalId,
          weight: resolvedWeight,
          copies: targetEmployeeIds.length,
        });
      } catch (e) {
        if (sendWeightError(res, e)) return;
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }
    }

    // 5c. Actual dates: auto-stamped, or as supplied for work that began
    //     before it was entered here.
    //
    //     The contradiction is checked FIRST. "Finished on the 23rd, 40% done"
    //     is a statement about the work, and saying so plainly beats the date
    //     ordering rule catching it afterwards and blaming the timestamps.
    let effStatus = status || 'todo';
    let effProgress = progress || 0;
    try {
      const done = reconcileCompletion({
        completionDate: actualCompletionDate, status, progress,
      });
      if (done) { effStatus = done.status; effProgress = done.progress; }
    } catch (e) {
      return res.status(e.status || 400).json({ success: false, message: e.message });
    }

    let actualDates;
    try {
      actualDates = resolveActualDates({
        suppliedStart: actualStartDate,
        suppliedCompletion: actualCompletionDate,
        auto: timingUpdates({}, { status: effStatus, progress: effProgress }),
      });
    } catch (e) {
      return res.status(e.status || 400).json({ success: false, message: e.message });
    }

    // 5d. A task may only be CREATED already in flight when the goal's own
    //     execution is unlocked. Creating plain 'todo' tasks is how a locked
    //     goal reaches 100% in the first place, so that is never blocked.
    //     Measured on the EFFECTIVE state: recording a completion date makes
    //     the task done, and that is work landing on the goal like any other.
    //
    //     The weight is measured on the goal as it will be ONCE THIS TASK
    //     EXISTS, not as it is now. Checking the current total made the first
    //     task on a goal impossible to create in flight: an empty goal is at
    //     0%, so adding its one 100%-weight task was refused for leaving the
    //     goal unplanned — by a check that ran before the very task that
    //     completes the plan. Approval is still judged on the goal as it
    //     stands, because adding a task does not approve anything.
    if (resolvedGoalId && isWorkStarted({ status: effStatus, progress: effProgress })) {
      const summary = await goalWeightSummary(resolvedGoalId);
      if (summary?.awaitingApproval) {
        return res.status(409).json({
          success: false,
          code: 'GOAL_AWAITING_APPROVAL',
          error: summary.reason,
          message: summary.reason,
          weightSummary: summary,
        });
      }
      if (summary && !summary.exempt) {
        const projected = summary.totalWeight + (resolvedWeight * targetEmployeeIds.length);
        if (projected !== 100) {
          const reason = projected > 100
            ? `Task weights for this goal would total ${projected}%, which exceeds 100%.`
            : `Task weights would total ${projected}%. A goal must be fully planned at 100% before work can be recorded against it.`;
          return res.status(409).json({
            success: false,
            code: 'GOAL_WEIGHT_INCOMPLETE',
            error: reason,
            message: reason,
            weightSummary: { ...summary, projectedTotal: projected },
          });
        }
      }
    }

    // 6. Resolve every target employee FIRST. These checks read the database
    //    and can refuse the request outright, and neither belongs inside the
    //    transaction that follows.
    const targets = [];
    for (const targetId of targetEmployeeIds) {
      let target;
      try {
        target = await resolveTargetEmployee(req.user, tenantId, targetId, parentTask, goalId);
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }

      if (resolvedGoal && target.id === req.user.id && !hasRole(req.user.role, ELEVATED_ROLES)) {
        const onGoal = resolvedGoal.employeeId === req.user.id
          || resolvedGoal.createdById === req.user.id
          || (await prisma.goalAssignment.findFirst({
              where: { goalId: resolvedGoal.id, employeeId: req.user.id }, select: { id: true },
            })) !== null;
        if (!onGoal) {
          return res.status(403).json({ success: false, message: 'You are not assigned to this goal' });
        }
      }
      targets.push(target);
    }

    // 7. Create them inside one serialisable transaction that re-checks the
    //    goal's total before committing. Two people adding 20% to an 80% goal
    //    at the same moment would otherwise both pass their own check and
    //    leave the goal at 120%.
    let createdTasks;
    try {
      createdTasks = await withWeightGuard(resolvedGoalId, async (tx) => {
        const made = [];
        for (const target of targets) {
          made.push(await tx.task.create({
            data: {
              title: title.trim(),
              priority: priority || 'medium',
              status: effStatus,
              progress: effProgress,
              startDate: startDate ? new Date(startDate) : undefined,
              dueDate: dueDate ? new Date(dueDate) : undefined,
              financialYear: financialYear || null,
              tags: tags || null,
              isPrivate: isPrivate ?? false,
              isStandalone: isStandalone ?? false,
              weight: resolvedWeight,
              description: description || null,
              dependency: dependency || null,
              isDependencyOf: isDependencyOf || null,
              // A task created already in progress has actually started now,
              // unless the caller recorded when it really began.
              ...actualDates.data,
              // ─ Relations ─
              employee: { connect: { id: target.id } },
              tenant: { connect: { id: tenantId } },
              ...(resolvedGoalId ? { goal: { connect: { id: resolvedGoalId } } } : {}),
            },
          }));
        }
        return made;
      });
    } catch (e) {
      if (sendWeightError(res, e)) return;
      return res.status(e.status || 500).json({ success: false, message: e.message || 'Could not create the task' });
    }

    // 8. Side effects, once the rows are safely committed.
    for (const task of createdTasks) {
      let goalProgress = 0;
      if (resolvedGoalId) {
        goalProgress = await recalculateGoalProgress(resolvedGoalId, task.employeeId);
      }

      await logTaskAudit({
        taskId: task.id,
        performedById: req.user.id,
        action: 'created',
        details: `Task "${task.title}" created.`,
      });

      // An actual date entered by hand is recorded, so a back-dated task can
      // always be told apart from one the system stamped itself.
      if (actualDates.manuallySet) {
        const parts = [];
        if (task.actualStartDate) parts.push(`actual start ${task.actualStartDate.toISOString().slice(0, 10)}`);
        if (task.actualCompletionDate) parts.push(`actual completion ${task.actualCompletionDate.toISOString().slice(0, 10)}`);
        await logTaskAudit({
          taskId: task.id,
          performedById: req.user.id,
          action: 'edited',
          details: `Actual dates entered manually at creation: ${parts.join(', ') || 'cleared'}.`,
        }).catch(() => {});
      }

      emitToTenant(tenantId, 'task_updated', {
        action: 'create',
        task: {
          ...task,
          progress: task.progress || 0,
          weight: task.weight,
        },
        goalId: resolvedGoalId,
        goalProgress,
      });
    }

    if (createdTasks.length === 1) {
      res.status(201).json(createdTasks[0]);
    } else {
      res.status(201).json({
        ...createdTasks[0],
        createdTasks,
        count: createdTasks.length,
      });
    }
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/tasks ─────────────────────────────────────────────────────────
export async function listTasks(req, res, next) {
  try {
    const parsedQuery = listTasksQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }

    // The visibility rule now lives in one service, because the sub-task board
    // needs the same answer and a second copy would have been free to drift.
    const { where, error } = await visibleTaskWhere({
      user: req.user,
      tenantId: req.tenantId,
      employeeId: parsedQuery.data.employeeId,
      fy: parsedQuery.data.fy,
    });
    if (error) return res.status(error.status).json({ error: error.message });

    const items = await prisma.task.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ items: items.map(withTiming) });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/tasks/:id/status ────────────────────────────────────────────
export async function updateTaskStatus(req, res, next) {
  try {
    const parsedParams = taskIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid task ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
    const parsed = updateTaskStatusSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { status, progress } = parsed.data;
    const tenantId = req.tenantId;

    const existing = await assertTaskOwner(id, req.user, tenantId).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });
    if (!existing) return;

    let progressUpdate = progress !== undefined ? Number(progress) : undefined;
    if (progressUpdate === undefined) {
      if (status === 'done') progressUpdate = 100;
      else if (status === 'todo') progressUpdate = 0;
      else if (status === 'in_progress' && (!existing.progress || existing.progress === 0)) progressUpdate = 10;
    } else {
      progressUpdate = Math.min(100, Math.max(0, progressUpdate));
    }

    // ── The weight gate ──────────────────────────────────────────────────
    // Work may not begin on a goal whose tasks do not total exactly 100%.
    // Moving a task BACK to 'todo' is always allowed: that reduces work in
    // flight rather than adding it, and blocking it would trap a task in a
    // state its own goal no longer permits.
    const nextState = {
      status,
      progress: progressUpdate !== undefined && !isNaN(progressUpdate) ? progressUpdate : existing.progress,
    };
    if (existing.goalId && isWorkStarted(nextState) && !existing.isStandalone) {
      try {
        await assertGoalUnlocked(existing.goalId);
      } catch (e) {
        if (sendWeightError(res, e)) return;
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }
    }

    const updated = await prisma.task.update({
      where: { id },
      data: { 
        status,
        ...(progressUpdate !== undefined && !isNaN(progressUpdate) && { progress: progressUpdate }),
        ...timingUpdates(existing, nextState),
      },
    });

    let goalProgress = 0;
    if (updated.goalId) {
      goalProgress = await recalculateGoalProgress(updated.goalId, updated.employeeId);
    }

    if (updated.status === 'done' && updated.isDependencyOf) {
      const parentTask = await prisma.task.findUnique({
        where: { id: updated.isDependencyOf }
      });
      if (parentTask) {
        const updatedDependency = parentTask.dependency ? {
          ...parentTask.dependency,
          status: 'completed'
        } : null;
        
        const updatedParent = await prisma.task.update({
          where: { id: parentTask.id },
          data: {
            status: parentTask.status === 'pending_on_others' ? 'in_progress' : parentTask.status,
            dependency: updatedDependency
          }
        });
        
        let parentGoalProgress = 0;
        if (updatedParent.goalId) {
          parentGoalProgress = await recalculateGoalProgress(updatedParent.goalId, updatedParent.employeeId);
        }
        
        emitToTenant(tenantId, 'task_updated', {
          action: 'update',
          task: updatedParent,
          goalId: updatedParent.goalId,
          goalProgress: parentGoalProgress,
        });
      }
    }

    await logTaskAudit({
      taskId: id,
      performedById: req.user.id,
      action: 'status_changed',
      details: `Status updated to ${status.toUpperCase().replace('_', ' ')}.`,
    });

    emitToTenant(tenantId, 'task_updated', {
      action: 'update',
      task: updated,
      goalId: updated.goalId,
      goalProgress,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/tasks/:id ─────────────────────────────────────────────────────
export async function updateTask(req, res, next) {
  try {
    const parsedParams = taskIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid task ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
    const tenantId = req.tenantId;
    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      title, priority, startDate, dueDate, financialYear,
      tags, goalId, isPrivate, isStandalone, weight,
      description, status, progress, dependency, isDependencyOf, employeeId,
      actualStartDate, actualCompletionDate,
    } = parsed.data;

    // Date validation on update too
    if (startDate && dueDate) {
      const start = new Date(startDate);
      const due = new Date(dueDate);
      if (!isNaN(start.getTime()) && !isNaN(due.getTime()) && due < start) {
        return res.status(400).json({
          success: false,
          message: 'Due date cannot be earlier than start date',
        });
      }
    }

    const existing = await assertTaskOwner(id, req.user, tenantId).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });
    if (!existing) return;

    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    // "Manager" here means anywhere up the reporting chain of the task owner.
    const isDirectManager = !isElevated && existing.employeeId && existing.employeeId !== req.user.id
      ? await goalService.isSubordinate(req.user.id, existing.employeeId, tenantId)
      : false;

    // ── Field-level authorization checks ─────────────────────────────────
    // 1. Reassignment guard: employees cannot reassign tasks
    if (employeeId !== undefined && employeeId !== existing.employeeId) {
      if (!isElevated && !isDirectManager) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot reassign tasks' });
      }
      try {
        let existingParent = null;
        if (existing.isDependencyOf) {
          existingParent = await prisma.task.findFirst({ where: { id: existing.isDependencyOf, tenantId } });
        }
        await resolveTargetEmployee(req.user, tenantId, employeeId, existingParent, existing.goalId);
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }
    }

    // 2. Goal assignment guard: employees cannot move task between goals
    if (goalId !== undefined && goalId !== existing.goalId) {
      if (!isElevated && !isDirectManager) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot reassign task goal' });
      }
    }

    // 3. Weight guard: employees cannot alter task weight
    if (weight !== undefined && weight !== existing.weight) {
      if (!isElevated && !isDirectManager) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot modify task weight' });
      }
    }

    // 4. Dependency parent mapping guard
    if (isDependencyOf !== undefined && isDependencyOf !== existing.isDependencyOf) {
      if (!isElevated && !isDirectManager && existing.employeeId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot modify dependency structure' });
      }
    }

    // 5. Dependency approval guard: employees cannot approve dependencies directly
    if (dependency !== undefined && dependency !== null) {
      if (dependency.status === 'approved' && existing.dependency?.status !== 'approved' && !isElevated && !isDirectManager) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot approve dependencies' });
      }
    }

    // If goalId is being updated, validate tenant scope
    let resolvedGoalId = undefined;
    if (goalId !== undefined) {
      if (!goalId) {
        resolvedGoalId = null;
      } else {
        try {
          const goal = await resolveGoal(goalId, tenantId);
          resolvedGoalId = goal?.id || null;
        } catch (e) {
          return res.status(e.status || 500).json({ success: false, message: e.message });
        }
      }
    }

    let finalProgress = progress;
    let finalStatus = status;
    
    if (finalProgress === undefined && status !== undefined) {
      if (status === 'done') finalProgress = 100;
      else if (status === 'todo') finalProgress = 0;
    }
    if (progress !== undefined && finalStatus === undefined) {
      if (progress === 100) finalStatus = 'done';
      else if (progress > 0) finalStatus = 'in_progress';
      else if (progress === 0) finalStatus = 'todo';
    }

    // ── Weight ceiling ───────────────────────────────────────────────────
    // Measured against the task's siblings, so raising a task from 20 to 30
    // on a goal totalling 100 is refused, but re-saving it at 20 is not.
    const targetGoalId = resolvedGoalId !== undefined ? resolvedGoalId : existing.goalId;
    if (weight !== undefined && weight !== null && targetGoalId
        && (isElevated || isDirectManager)) {
      try {
        await assertWeightFits({ goalId: targetGoalId, weight: Number(weight), excludeTaskId: id });
      } catch (e) {
        if (sendWeightError(res, e)) return;
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }
    }

    // ── The weight gate ──────────────────────────────────────────────────
    // Same rule as PATCH /tasks/:id/status, enforced here too because this
    // endpoint can set status and progress as well and would otherwise be a
    // way straight around the lock.
    const wasStarted = isWorkStarted(existing);
    const willBeStarted = isWorkStarted({
      status: finalStatus !== undefined ? finalStatus : existing.status,
      progress: finalProgress !== undefined ? finalProgress : existing.progress,
    });
    // Also gate a task that is ALREADY in flight being moved onto a different
    // goal: otherwise work could be parked on a locked goal without any status
    // change at all.
    const changingGoal = resolvedGoalId !== undefined && resolvedGoalId !== existing.goalId;
    const movingIntoWork = willBeStarted && (
      !wasStarted
      || finalStatus !== undefined
      || finalProgress !== undefined
      || changingGoal
    );
    const isStandaloneNow = isStandalone !== undefined ? isStandalone : existing.isStandalone;
    if (targetGoalId && movingIntoWork && !isStandaloneNow) {
      try {
        await assertGoalUnlocked(targetGoalId);
      } catch (e) {
        if (sendWeightError(res, e)) return;
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }
    }

    // A weight change goes through the same serialisable guard as creation:
    // two people raising two different tasks at once could each fit on their
    // own and not together.
    const weightChanging = weight !== undefined && weight !== null
      && Number(weight) !== Number(existing.weight)
      && (isElevated || isDirectManager);

    // Actual dates: whatever the movement implies, overridden by anything the
    // caller recorded explicitly.
    let actualDates;
    try {
      actualDates = resolveActualDates({
        suppliedStart: actualStartDate,
        suppliedCompletion: actualCompletionDate,
        auto: timingUpdates(existing, {
          status: finalStatus !== undefined ? finalStatus : existing.status,
          progress: finalProgress !== undefined ? finalProgress : existing.progress,
        }),
        existing,
      });
    } catch (e) {
      return res.status(e.status || 400).json({ success: false, message: e.message });
    }

    // Recording a completion date completes the task here too. Only applied
    // when a completion date is being SET in this request — an edit that
    // merely touches the title must not resurrect a done flag from a date the
    // task already held.
    if (actualCompletionDate !== undefined && actualCompletionDate !== null && actualCompletionDate !== '') {
      try {
        const done = reconcileCompletion({
          completionDate: actualDates.data.actualCompletionDate,
          status, progress,
        });
        if (done) { finalStatus = done.status; finalProgress = done.progress; }
      } catch (e) {
        return res.status(e.status || 400).json({ success: false, message: e.message });
      }
    }

    const runUpdate = (tx) => tx.task.update({
      where: { id },
      data: {
        ...actualDates.data,
        ...(title !== undefined && { title: title.trim() }),
        ...(priority !== undefined && { priority }),
        ...(finalStatus !== undefined && { status: finalStatus }),
        ...(finalProgress !== undefined && { progress: finalProgress }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(financialYear !== undefined && { financialYear }),
        ...(tags !== undefined && { tags }),
        ...(resolvedGoalId !== undefined && { goalId: resolvedGoalId }),
        ...(isPrivate !== undefined && (isElevated || isDirectManager || existing.employeeId === req.user.id) && { isPrivate }),
        ...(isStandalone !== undefined && (isElevated || isDirectManager) && { isStandalone }),
        ...(weight !== undefined && (isElevated || isDirectManager) && { weight }),
        ...(description !== undefined && { description }),
        ...(dependency !== undefined && (isElevated || isDirectManager || existing.employeeId === req.user.id) && { dependency: dependency || null }),
        ...(isDependencyOf !== undefined && (isElevated || isDirectManager || existing.employeeId === req.user.id) && { isDependencyOf: isDependencyOf || null }),
        ...(employeeId !== undefined && (isElevated || isDirectManager) && { employeeId }),
      },
    });

    let updated;
    try {
      updated = weightChanging && targetGoalId
        ? await withWeightGuard(targetGoalId, runUpdate)
        : await runUpdate(prisma);
    } catch (e) {
      if (sendWeightError(res, e)) return;
      return res.status(e.status || 500).json({ success: false, message: e.message || 'Could not update the task' });
    }

    let goalProgress = 0;
    if (updated.goalId) {
      goalProgress = await recalculateGoalProgress(updated.goalId, updated.employeeId);
    }

    // If dependency was updated and has a companion task - keep it synchronized
    if (dependency !== undefined && dependency !== null) {
      const companionTaskId = getCompanionTaskId(dependency);
      if (companionTaskId) {
        const companionTask = await prisma.task.findFirst({
          where: { id: companionTaskId, tenantId }
        });
        if (companionTask) {
          const updatedCompanion = await prisma.task.update({
            where: { id: companionTaskId },
            data: {
              employeeId: dependency.concernedPersonId,
              title: dependency.title,
              description: dependency.description || null,
              dueDate: dependency.dueDate ? new Date(dependency.dueDate) : null,
            }
          });
          
          emitToTenant(tenantId, 'task_updated', {
            action: 'update',
            task: updatedCompanion,
            goalId: updatedCompanion.goalId,
            goalProgress: 0,
          });
        }
      }
    }

    if (updated.status === 'done' && updated.isDependencyOf) {
      const parentTask = await prisma.task.findUnique({
        where: { id: updated.isDependencyOf }
      });
      if (parentTask) {
        const updatedDependency = parentTask.dependency ? {
          ...parentTask.dependency,
          status: 'completed'
        } : null;
        
        const updatedParent = await prisma.task.update({
          where: { id: parentTask.id },
          data: {
            status: parentTask.status === 'pending_on_others' ? 'in_progress' : parentTask.status,
            dependency: updatedDependency
          }
        });
        
        let parentGoalProgress = 0;
        if (updatedParent.goalId) {
          parentGoalProgress = await recalculateGoalProgress(updatedParent.goalId, updatedParent.employeeId);
        }
        
        emitToTenant(tenantId, 'task_updated', {
          action: 'update',
          task: updatedParent,
          goalId: updatedParent.goalId,
          goalProgress: parentGoalProgress,
        });
      }
    }

    // Determine details of edit
    let details = 'Task edited.';
    let action = 'edited';
    if (dependency !== undefined && dependency !== null && existing.dependency === null) {
      action = 'dependency_created';
      details = `Created dependency: "${dependency.title || 'Untitled'}".`;
    } else if (status !== undefined && status !== existing.status) {
      action = 'status_changed';
      details = `Status updated to ${status.toUpperCase().replace('_', ' ')}.`;
    }

    await logTaskAudit({
      taskId: id,
      performedById: req.user.id,
      action,
      details,
    });

    // A hand-entered actual date leaves a trail of its own, naming what it was
    // before. Delay figures are only worth anything if a correction is visible.
    if (actualDates.manuallySet) {
      const show = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'not recorded');
      const changes = [];
      if (actualStartDate !== undefined) {
        changes.push(`actual start ${show(existing.actualStartDate)} → ${show(updated.actualStartDate)}`);
      }
      if (actualCompletionDate !== undefined) {
        changes.push(`actual completion ${show(existing.actualCompletionDate)} → ${show(updated.actualCompletionDate)}`);
      }
      await logTaskAudit({
        taskId: id,
        performedById: req.user.id,
        action: 'edited',
        details: `Actual dates changed by hand: ${changes.join('; ')}.`,
      }).catch(() => {});
    }

    emitToTenant(tenantId, 'task_updated', {
      action: 'update',
      task: updated,
      goalId: updated.goalId,
      goalProgress,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/tasks/:id ───────────────────────────────────────────────────
export async function deleteTask(req, res, next) {
  try {
    const parsedParams = taskIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid task ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
    const tenantId = req.tenantId;

    const existing = await assertTaskOwner(id, req.user, tenantId).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });
    if (!existing) return;

    // If this task IS a dependency companion — clear the parent's dependency field
    if (existing.isDependencyOf) {
      await prisma.task.updateMany({
        where: { id: existing.isDependencyOf, tenantId },
        data: { dependency: null, isDependencyOf: null },
      }).catch(() => {}); // best-effort; parent may already be deleted
    }

    // If this task HAS a dependency companion — also delete the companion
    const companionId = getCompanionTaskId(existing.dependency);
    if (companionId) {
      await prisma.task.deleteMany({
        where: { id: companionId, tenantId },
      }).catch(() => {});
    }

    await prisma.task.delete({ where: { id } });

    let goalProgress = 0;
    if (existing.goalId) {
      goalProgress = await recalculateGoalProgress(existing.goalId, existing.employeeId);
    }

    emitToTenant(tenantId, 'task_updated', {
      action: 'delete',
      taskId: id,
      goalId: existing.goalId,
      goalProgress,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
