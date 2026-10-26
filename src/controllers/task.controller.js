import { prisma } from '../lib/prisma.js';
import { logTaskAudit, pushNotification } from './taskActivity.controller.js';
import { emitToTenant } from '../lib/socket.js';
import { createTaskSchema, updateTaskSchema, updateTaskStatusSchema, taskIdParamSchema, listTasksQuerySchema } from '../validations/task.schema.js';
import { goalService } from '../services/goal.service.js';
import { loadTaskForUser, getCompanionTaskId } from '../services/taskAccess.service.js';
import { ELEVATED_ROLES, SUPER_ELEVATED_ROLES, MANAGER_OR_ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { TASK_STATUSES } from '../lib/workflowStatus.js';
import {
  assertGoalUnlocked, assertWeightFits, defaultWeightFor, goalWeightSummary, withWeightGuard,
} from '../services/goalWeight.service.js';
import { timingUpdates, isWorkStarted, taskTiming } from '../lib/taskTiming.js';
import { visibleTaskWhere } from '../services/taskVisibility.service.js';
import { assertTaskDatesFitMilestones } from '../lib/dateValidation.js';
import { validateMilestoneDrafts } from '../lib/criticalTask.js';
import { assertWatcherEmailsAllowed, assertMilestoneAssigneesValid, getEscalationChainForEmployee } from './taskMilestone.controller.js';

function formatZodIssues(issues, fallback = 'Validation failed') {
  if (!Array.isArray(issues) || issues.length === 0) return fallback;
  const messages = issues.map((i) => {
    const p = Array.isArray(i.path) && i.path.length ? i.path.join('.') : '';
    return p ? `${p}: ${i.message}` : i.message;
  });
  return messages.join('; ') || fallback;
}

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

// ─── Helper: check if employee is assigned to a goal ───────────────────────
export async function isUserGoalAssignee(goalId, employeeId, tenantId) {
  if (!goalId || !employeeId) return false;
  const goal = await prisma.goal.findFirst({
    where: { id: goalId, tenantId },
    select: {
      id: true,
      employeeId: true,
      assignments: {
        where: { employeeId },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!goal) return false;
  if (goal.employeeId === employeeId) return true;
  return Boolean(goal.assignments && goal.assignments.length > 0);
}

// ─── Helper: resolve & authorise target employee ───────────────────────────
// Returns the TenantUser record that will own the task.
// Verifies the employee belongs to the SAME tenant as the requesting user.
export async function resolveTargetEmployee(requestingUser, tenantId, employeeId, parentTask = null, goalId = null) {
  const targetId = employeeId || requestingUser.id;

  // Task Assignment Restriction: A task can only be assigned to an employee who is already assigned to the parent Goal.
  if (goalId && !parentTask) {
    const isGoalAssignee = await isUserGoalAssignee(goalId, targetId, tenantId);
    if (!isGoalAssignee) {
      throw {
        status: 400,
        message: 'A task can only be assigned to an employee who is already assigned to the parent Goal.',
      };
    }
  }

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
      const formatted = formatZodIssues(parsed.error.issues, 'Validation failed');
      return res.status(400).json({ success: false, error: formatted, message: formatted, details: parsed.error.issues });
    }
    const {
      title, priority, startDate, dueDate, financialYear,
      goalId, isPrivate, isStandalone, workflowType, taskMode, weight,
      description, employeeId, employeeIds, dependency, isDependencyOf,
      status, progress, actualStartDate, actualCompletionDate,
      isMilestoneTracked, source, milestones,
    } = parsed.data;

    // Task Creation Source Validation
    if (source === 'goal') {
      if (!goalId) {
        return res.status(400).json({
          success: false,
          message: 'A task created from within a goal must be associated with a valid goal ID.',
        });
      }
      if (isStandalone === true || isPrivate === true) {
        return res.status(400).json({
          success: false,
          message: 'Tasks created from within a goal cannot be configured as standalone or private.',
        });
      }
    }

    // Normal vs Special Task Workflow Security & Validation
    const isNormalWorkflow = workflowType === 'normal' || taskMode === 'normal';
    if (isNormalWorkflow && (isStandalone === true || isPrivate === true)) {
      return res.status(400).json({
        success: false,
        message: 'Special task flags (standalone or private) cannot be configured through the normal task creation workflow.',
      });
    }

    const effectiveIsStandalone = isNormalWorkflow ? false : Boolean(isStandalone);
    const effectiveIsPrivate = isNormalWorkflow ? false : Boolean(isPrivate);

    // 2b. Milestone tracking is an opt-in for critical work only, and only a
    //     MANAGER or above may turn it on — matches who is allowed to add the
    //     milestones themselves (taskMilestone.controller.js). Refused
    //     outright rather than silently downgraded, so the UI's toggle never
    //     lies about whether it took effect.
    if (isMilestoneTracked) {
      if (!hasRole(req.user.role, MANAGER_OR_ELEVATED_ROLES)) {
        return res.status(403).json({ success: false, message: 'Only a manager (or above) can create a milestone-tracked task' });
      }
      if ((priority || 'medium') !== 'critical') {
        return res.status(400).json({ success: false, message: 'Milestone tracking is only available for critical-priority tasks' });
      }
    } else if (Array.isArray(milestones) && milestones.length > 0) {
      return res.status(400).json({ success: false, message: 'Milestones can only be supplied for a milestone-tracked critical task' });
    }

    // 2c. A milestone-tracked task is created together with its 1–4 milestone
    //     boxes, validated in full before anything is written.
    let milestoneDrafts = [];
    if (isMilestoneTracked) {
      const result = validateMilestoneDrafts(milestones, { startDate, dueDate });
      if (result.error) {
        return res.status(400).json({ success: false, message: result.error });
      }
      try {
        await assertWatcherEmailsAllowed(tenantId, result.items.flatMap((m) => m.watcherEmails));
        await assertMilestoneAssigneesValid(tenantId, result.items.map((m) => m.assigneeId));
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }
      milestoneDrafts = result.items;
    }

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

    // 3b. Dependency date validation
    if (dependency && typeof dependency === 'object' && dependency.dueDate) {
      const depDue = new Date(dependency.dueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!isNaN(depDue.getTime()) && depDue < today) {
        return res.status(400).json({
          success: false,
          message: 'Dependency due date cannot be in the past',
        });
      }
      if (dependency.type === 'pre' && dueDate) {
        const parentDue = new Date(dueDate);
        if (!isNaN(parentDue.getTime()) && depDue > parentDue) {
          return res.status(400).json({
            success: false,
            message: 'Pre-requisite dependency due date cannot be later than main task due date',
          });
        }
      }
    }

    if (isDependencyOf && dueDate) {
      const depDue = new Date(dueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!isNaN(depDue.getTime()) && depDue < today) {
        return res.status(400).json({
          success: false,
          message: 'Dependency task due date cannot be in the past',
        });
      }
    }

    // 3c. Dependency Assignment Rule (Req 11): Must be a manager-level employee
    if (dependency && typeof dependency === 'object') {
      const depAssigneeId = dependency.concernedPersonId || dependency.assigneeId;
      if (depAssigneeId) {
        const depUser = await prisma.tenantUser.findFirst({
          where: { id: depAssigneeId, tenantId, isDeleted: false, status: 'ACTIVE' },
          select: { id: true, name: true, role: true },
        });
        if (!depUser) {
          return res.status(400).json({ success: false, message: 'Dependency assigned employee not found' });
        }
        const depRole = String(depUser.role || '').toUpperCase();
        const MANAGER_ROLES = ['MANAGER', 'HR', 'ADMIN', 'SUPER_ADMIN', 'CMD', 'DIRECTOR', 'LEADERSHIP'];
        if (!MANAGER_ROLES.includes(depRole)) {
          return res.status(400).json({
            success: false,
            message: `A task dependency can only be assigned to a manager-level employee. "${depUser.name}" has role ${depUser.role}.`,
          });
        }
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

    // 4b. Single Employee Assignment (Req 9): Each task can be assigned to only one employee
    const rawTargets = Array.isArray(employeeIds) && employeeIds.length > 0
      ? employeeIds
      : Array.isArray(req.body.assigneeIds) && req.body.assigneeIds.length > 0
      ? req.body.assigneeIds
      : [employeeId || req.user.id];
    const targetEmployeeIds = Array.from(new Set(rawTargets.filter(Boolean)));

    if (targetEmployeeIds.length > 1) {
      return res.status(400).json({
        success: false,
        message: 'Each task can be assigned to only one employee. Multiple assignees are not permitted.',
      });
    }

    // Special Task Security & Ownership Check
    if (effectiveIsPrivate && targetEmployeeIds[0] !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Private tasks can only be created for yourself.',
      });
    }

    if (effectiveIsStandalone) {
      const callerRole = String(req.user.role || '').toUpperCase();
      if (callerRole === 'EMPLOYEE' && targetEmployeeIds[0] !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Employees can only create standalone tasks for themselves.',
        });
      }
    }

    // 5. Validate goal tenant scope (if goalId provided)
    let resolvedGoal = null;
    let resolvedGoalId = null;
    if (!effectiveIsStandalone && goalId) {
      try {
        resolvedGoal = await resolveGoal(goalId, tenantId);
        resolvedGoalId = resolvedGoal?.id || null;
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }
    }

    if (source === 'goal' && !resolvedGoalId) {
      return res.status(400).json({
        success: false,
        message: 'A task created from within a goal must be associated with an active goal belonging to this tenant.',
      });
    }

    // Idempotency & rapid double-click guard:
    // If an identical task was created with the same title, assignee, and goal within the last 5 seconds, suppress duplicate creation
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const existingRecentTask = await prisma.task.findFirst({
      where: {
        tenantId,
        title: title.trim(),
        employeeId: targetEmployeeIds[0],
        goalId: resolvedGoalId,
        createdAt: { gte: fiveSecondsAgo },
      },
    });

    if (existingRecentTask && !isDependencyOf) {
      return res.status(200).json(existingRecentTask);
    }

    // 5b. Weightage: Removed for private tasks and unmonitored tasks (Req 8)
    // A task is monitored if it is linked to a goal OR milestone tracked.
    const isUnmonitoredOrPrivate = Boolean(effectiveIsPrivate || effectiveIsStandalone || (!resolvedGoalId && !isMilestoneTracked));
    let resolvedWeight;

    if (isUnmonitoredOrPrivate) {
      resolvedWeight = 0; // Private and unmonitored tasks carry no weightage
    } else {
      resolvedWeight = weight === undefined || weight === null || weight === ''
        ? await defaultWeightFor(resolvedGoalId, 1)
        : Number(weight);
      if (!Number.isFinite(resolvedWeight) || resolvedWeight < 1) resolvedWeight = 1;

      if (resolvedGoalId) {
        try {
          await assertWeightFits({
            goalId: resolvedGoalId,
            weight: resolvedWeight,
            copies: 1,
          });
        } catch (e) {
          if (sendWeightError(res, e)) return;
          return res.status(e.status || 500).json({ success: false, message: e.message });
        }
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
        const projected = summary.totalWeight + resolvedWeight;
        if (projected > 100) {
          const reason = `Task weights for this goal would total ${projected}%, which exceeds 100%.`;
          return res.status(409).json({
            success: false,
            code: 'GOAL_WEIGHT_EXCEEDED',
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
        target = await resolveTargetEmployee(req.user, tenantId, targetId, parentTask, resolvedGoalId);
      } catch (e) {
        return res.status(e.status || 500).json({ success: false, message: e.message });
      }

      if (resolvedGoalId) {
        const isGoalAssignee = await isUserGoalAssignee(resolvedGoalId, target.id, tenantId);
        if (!isGoalAssignee) {
          return res.status(400).json({
            success: false,
            message: 'A task can only be assigned to an employee who is already assigned to the parent Goal.',
          });
        }
      }
      targets.push(target);
    }

    // 7. Create one task record for its single assigned employee.
    let createdTask;
    const primaryTarget = targets[0];
    // A milestone-tracked task waits at pending_approval until its milestones
    // are approved (same rule createMilestone applies to a lone milestone).
    const initialStatus = milestoneDrafts.length > 0 && effStatus === 'todo' && effProgress === 0
      ? 'pending_approval'
      : effStatus;
    let createdMilestones = [];
    try {
      createdTask = await withWeightGuard(resolvedGoalId, async (tx) => {
        const task = await tx.task.create({
          data: {
            title: title.trim(),
            priority: priority || 'medium',
            status: initialStatus,
            progress: effProgress,
            startDate: startDate ? new Date(startDate) : undefined,
            dueDate: dueDate ? new Date(dueDate) : undefined,
            financialYear: financialYear || null,
            tags: req.body.tags || null,
            isPrivate: effectiveIsPrivate,
            isStandalone: effectiveIsStandalone,
            weight: resolvedWeight,
            description: description || null,
            dependency: dependency || null,
            isDependencyOf: isDependencyOf || null,
            isMilestoneTracked: isMilestoneTracked === true,
            createdOnBehalfOf: Boolean(req.body.createdOnBehalfOf),
            requiresApproval: Boolean(req.body.requiresApproval),
            onHoldReason: req.body.onHoldReason || null,
            assigneeIds: [primaryTarget.id],
            // A task created already in progress has actually started now,
            // unless the caller recorded when it really began.
            ...actualDates.data,
            // ─ Relations ─
            employee: { connect: { id: primaryTarget.id } },
            tenant: { connect: { id: tenantId } },
            ...(resolvedGoalId ? { goal: { connect: { id: resolvedGoalId } } } : {}),
          },
          include: {
            employee: {
              select: { id: true, name: true, email: true, designation: true },
            },
          },
        });
        createdMilestones = [];
        for (const m of milestoneDrafts) {
          createdMilestones.push(await tx.taskMilestone.create({
            data: {
              tenantId,
              taskId: task.id,
              order: m.order,
              title: m.title,
              description: m.description,
              dueDate: m.dueDate,
              progress: m.progress,
              watcherEmails: m.watcherEmails,
              assigneeId: m.assigneeId,
              status: 'PENDING_APPROVAL',
              createdById: req.user.id,
            },
          }));
        }
        return task;
      });
    } catch (e) {
      if (sendWeightError(res, e)) return;
      return res.status(e.status || 500).json({ success: false, message: e.message || 'Could not create the task' });
    }

    // Reporting-chain escalation levels for each milestone, as createMilestone does.
    if (createdMilestones.length > 0) {
      try {
        const chainLevels = await getEscalationChainForEmployee(tenantId, primaryTarget.id);
        if (chainLevels.length > 0) {
          await prisma.checkpointEscalationLevel.createMany({
            data: createdMilestones.flatMap((m) => chainLevels.map((lvl) => ({
              milestoneId: m.id,
              levelNumber: lvl.levelNumber,
              roleOrTitle: lvl.roleOrTitle,
              userId: lvl.userId,
            }))),
          });
        }
      } catch (e) {
        console.error('Failed to attach escalation levels to milestones:', e);
      }
    }

    // 8. Side effects, once the row is safely committed.
    let goalProgress = 0;
    if (resolvedGoalId) {
      for (const empId of targetEmployeeIds) {
        goalProgress = await recalculateGoalProgress(resolvedGoalId, empId);
      }
    }

    await logTaskAudit({
      taskId: createdTask.id,
      performedById: req.user.id,
      action: 'created',
      details: `Task "${createdTask.title}" created (assigned to: ${targets.map(t => t.name || t.id).join(', ')}).`,
    });

    if (actualDates.manuallySet) {
      const parts = [];
      if (createdTask.actualStartDate) parts.push(`actual start ${createdTask.actualStartDate.toISOString().slice(0, 10)}`);
      if (createdTask.actualCompletionDate) parts.push(`actual completion ${createdTask.actualCompletionDate.toISOString().slice(0, 10)}`);
      await logTaskAudit({
        taskId: createdTask.id,
        performedById: req.user.id,
        action: 'edited',
        details: `Actual dates entered manually at creation: ${parts.join(', ') || 'cleared'}.`,
      }).catch(() => {});
    }

    emitToTenant(tenantId, 'task_updated', {
      action: 'create',
      task: {
        ...createdTask,
        progress: createdTask.progress || 0,
        weight: createdTask.weight,
      },
      goalId: resolvedGoalId,
      goalProgress,
    });

    return res.status(201).json(createdTask);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/tasks ─────────────────────────────────────────────────────────
export async function listTasks(req, res, next) {
  try {
    const parsedQuery = listTasksQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      const formatted = formatZodIssues(parsedQuery.error.issues, 'Validation failed');
      return res.status(400).json({ success: false, error: formatted, message: formatted, details: parsedQuery.error.issues });
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
      const formatted = formatZodIssues(parsed.error.issues, 'Validation failed');
      return res.status(400).json({ success: false, error: formatted, message: formatted, details: parsed.error.issues });
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
        ...(req.body.onHoldReason !== undefined && { onHoldReason: req.body.onHoldReason }),
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
            status: parentTask.status, // Manual resume required by assignee/manager
            dependency: updatedDependency,
          }
        });
        
        let parentGoalProgress = 0;
        if (updatedParent.goalId) {
          parentGoalProgress = await recalculateGoalProgress(updatedParent.goalId, updatedParent.employeeId);
        }

        await pushNotification({
          tenantId,
          recipientId: parentTask.employeeId,
          type: 'task_update',
          title: `Dependency Finished for "${parentTask.title}"`,
          body: `Supporting task "${updated.title}" was completed. You can now resume your task when ready.`,
          entityType: 'task',
          entityId: parentTask.id,
        }).catch(() => null);
        
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
      const formatted = formatZodIssues(parsed.error.issues, 'Validation failed');
      return res.status(400).json({ success: false, error: formatted, message: formatted, details: parsed.error.issues });
    }
    const {
      title, priority, startDate, dueDate, financialYear,
      tags, goalId, isPrivate, isStandalone, workflowType, taskMode, weight,
      description, status, progress, dependency, isDependencyOf, employeeId,
      employeeIds, assigneeIds,
      actualStartDate, actualCompletionDate,
    } = parsed.data;

    const isNormalWorkflow = workflowType === 'normal' || taskMode === 'normal';
    if (isNormalWorkflow && (isStandalone === true || isPrivate === true)) {
      return res.status(400).json({
        success: false,
        message: 'Special task flags (standalone or private) cannot be configured through the normal task workflow.',
      });
    }

    const resolvedAssigneeIds = Array.isArray(assigneeIds)
      ? assigneeIds
      : Array.isArray(employeeIds)
      ? employeeIds
      : undefined;

    if (resolvedAssigneeIds && resolvedAssigneeIds.length > 1) {
      return res.status(400).json({
        success: false,
        message: 'Each task can be assigned to only one employee. Multiple assignees are not permitted.',
      });
    }

    const existing = await assertTaskOwner(id, req.user, tenantId).catch(e => {
      res.status(e.status || 500).json({ error: e.message });
      return null;
    });
    if (!existing) return;

    if (isPrivate === true) {
      const targetEmp = employeeId !== undefined ? employeeId : existing.employeeId;
      if (targetEmp !== req.user.id && !hasRole(req.user.role, ELEVATED_ROLES)) {
        return res.status(403).json({
          success: false,
          message: 'Private tasks can only be owned by yourself.',
        });
      }
    }

    // Date validation on update against effective combined dates
    const effectiveStartDate = startDate !== undefined ? startDate : existing.startDate;
    const effectiveDueDate = dueDate !== undefined ? dueDate : existing.dueDate;
    if (effectiveStartDate && effectiveDueDate) {
      const start = new Date(effectiveStartDate);
      const due = new Date(effectiveDueDate);
      if (!isNaN(start.getTime()) && !isNaN(due.getTime()) && due < start) {
        return res.status(400).json({
          success: false,
          message: 'Due date cannot be earlier than start date',
        });
      }
    }

    // Revalidate milestones if task dates are changing
    if (existing.isMilestoneTracked && (startDate !== undefined || dueDate !== undefined)) {
      try {
        await assertTaskDatesFitMilestones(id, effectiveStartDate, effectiveDueDate);
      } catch (err) {
        return res.status(err.status || 400).json({ success: false, message: err.message });
      }
    }

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
        const effectiveGoalForReassign = isStandalone ? null : (goalId !== undefined ? goalId : existing.goalId);
        await resolveTargetEmployee(req.user, tenantId, employeeId, existingParent, effectiveGoalForReassign);
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

    // 5. Dependency approval guard & Dependency manager role check (Req 11)
    if (dependency !== undefined && dependency !== null) {
      if (dependency.status === 'approved' && existing.dependency?.status !== 'approved' && !isElevated && !isDirectManager) {
        return res.status(403).json({ success: false, error: 'Forbidden: Employees cannot approve dependencies' });
      }

      const depAssigneeId = dependency.concernedPersonId || dependency.assigneeId;
      if (depAssigneeId) {
        const depUser = await prisma.tenantUser.findFirst({
          where: { id: depAssigneeId, tenantId, isDeleted: false, status: 'ACTIVE' },
          select: { id: true, name: true, role: true },
        });
        if (depUser) {
          const depRole = String(depUser.role || '').toUpperCase();
          const MANAGER_ROLES = ['MANAGER', 'HR', 'ADMIN', 'SUPER_ADMIN', 'CMD', 'DIRECTOR', 'LEADERSHIP'];
          if (!MANAGER_ROLES.includes(depRole)) {
            return res.status(400).json({
              success: false,
              message: `A task dependency can only be assigned to a manager-level employee. "${depUser.name}" has role ${depUser.role}.`,
            });
          }
        }
      }

      // 5b. Dependency due date past validation
      if (dependency.dueDate) {
        const depDue = new Date(dependency.dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (!isNaN(depDue.getTime()) && depDue < today && dependency.status !== 'completed' && dependency.status !== 'done') {
          return res.status(400).json({ success: false, message: 'Dependency due date cannot be in the past' });
        }
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

    // ── Weight ceiling & private/unmonitored zero weight ─────────────────
    const targetGoalId = resolvedGoalId !== undefined ? resolvedGoalId : existing.goalId;
    const effectiveIsPrivate = isPrivate !== undefined ? isPrivate : existing.isPrivate;
    const effectiveIsStandalone = isStandalone !== undefined ? isStandalone : existing.isStandalone;
    const isUnmonitoredOrPrivate = Boolean(effectiveIsPrivate || effectiveIsStandalone || (!targetGoalId && !existing.isMilestoneTracked));

    // ── Task Assignment Restriction: A task can only be assigned to an employee who is already assigned to the parent Goal ──
    const effectiveParentGoalId = effectiveIsStandalone ? null : targetGoalId;
    if (effectiveParentGoalId) {
      const effectiveAssigneeIds = resolvedAssigneeIds !== undefined
        ? resolvedAssigneeIds
        : (employeeId !== undefined ? [employeeId] : [existing.employeeId]);

      for (const targetEmpId of effectiveAssigneeIds) {
        if (targetEmpId) {
          const isGoalAssignee = await isUserGoalAssignee(effectiveParentGoalId, targetEmpId, tenantId);
          if (!isGoalAssignee) {
            return res.status(400).json({
              success: false,
              message: 'A task can only be assigned to an employee who is already assigned to the parent Goal.',
            });
          }
        }
      }
    }

    let finalWeight = undefined;
    if (isUnmonitoredOrPrivate) {
      finalWeight = 0;
    } else if (weight !== undefined && weight !== null && (isElevated || isDirectManager)) {
      finalWeight = Number(weight);
      if (targetGoalId) {
        try {
          await assertWeightFits({ goalId: targetGoalId, weight: finalWeight, excludeTaskId: id });
        } catch (e) {
          if (sendWeightError(res, e)) return;
          return res.status(e.status || 500).json({ success: false, message: e.message });
        }
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
        ...(finalWeight !== undefined ? { weight: finalWeight } : (weight !== undefined && (isElevated || isDirectManager) && { weight })),
        ...(description !== undefined && { description }),
        ...(dependency !== undefined && (isElevated || isDirectManager || existing.employeeId === req.user.id) && { dependency: dependency || null }),
        ...(isDependencyOf !== undefined && (isElevated || isDirectManager || existing.employeeId === req.user.id) && { isDependencyOf: isDependencyOf || null }),
        ...(employeeId !== undefined && (isElevated || isDirectManager) && { employeeId }),
        ...(resolvedAssigneeIds !== undefined && (isElevated || isDirectManager) && { assigneeIds: resolvedAssigneeIds }),
        ...(req.body.createdOnBehalfOf !== undefined && { createdOnBehalfOf: Boolean(req.body.createdOnBehalfOf) }),
        ...(req.body.requiresApproval !== undefined && { requiresApproval: Boolean(req.body.requiresApproval) }),
        ...(req.body.onHoldReason !== undefined && { onHoldReason: req.body.onHoldReason }),
        ...(req.body.approveDelegation === true && { approvedById: req.user.id, approvedAt: new Date() }),
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
      if (Array.isArray(updated.assigneeIds)) {
        for (const coId of updated.assigneeIds) {
          if (coId !== updated.employeeId) {
            await recalculateGoalProgress(updated.goalId, coId);
          }
        }
      }
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
            status: parentTask.status, // Manual resume required by assignee/manager
            dependency: updatedDependency
          }
        });
        
        let parentGoalProgress = 0;
        if (updatedParent.goalId) {
          parentGoalProgress = await recalculateGoalProgress(updatedParent.goalId, updatedParent.employeeId);
        }

        await pushNotification({
          tenantId,
          recipientId: parentTask.employeeId,
          type: 'task_update',
          title: `Dependency Finished for "${parentTask.title}"`,
          body: `Supporting task "${updated.title}" was completed. You can now resume your task when ready.`,
          entityType: 'task',
          entityId: parentTask.id,
        }).catch(() => null);
        
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
      if (Array.isArray(existing.assigneeIds)) {
        for (const coId of existing.assigneeIds) {
          if (coId !== existing.employeeId) {
            await recalculateGoalProgress(existing.goalId, coId);
          }
        }
      }
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
