/**
 * taskWeightage.controller.js
 *
 * The weightage ledger for a team member, and a manager's adjustment to the
 * credit a task earned.
 *
 * The rule this file exists to hold: adjusting the final weight writes ONLY to
 * `managerFinalWeight`. It never touches `Task.weight`, `Task.progress`, the
 * goal's weight total or the execution lock. A manager docking credit for late
 * delivery must not silently re-plan the goal underneath the employee.
 */
import { prisma } from '../lib/prisma.js';
import { loadTaskForUser } from '../services/taskAccess.service.js';
import { visibleTaskWhere } from '../services/taskVisibility.service.js';
import {
  weightageFor, weightageRow, completedWeightOf, WEIGHTAGE_TASK_SELECT,
  financialYearFilter, dateRangeFilter,
} from '../services/taskWeightage.service.js';
import { logTaskAudit } from './taskActivity.controller.js';
import { emitToTenant } from '../lib/socket.js';
import { ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { finalWeightSchema, teamWeightageQuerySchema, taskIdParamSchema } from '../validations/task.schema.js';

// ─── GET /api/team/:id/weightage ────────────────────────────────────────────
/**
 * The ledger for one team member: every task with its planned weight, the
 * credit earned, whether it was delayed, and the manager's final figure.
 *
 * Visibility is the SAME rule as the task board — `visibleTaskWhere` decides
 * whether the caller may see this person's work at all, so there is no second
 * access rule here to drift from it.
 */
export async function getTeamWeightage(req, res, next) {
  try {
    const parsedParams = taskIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const parsedQuery = teamWeightageQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const employeeId = parsedParams.data.id;

    // Access only — the period filters are applied by weightageFor. Passing
    // `fy` here would narrow the permission check by a label, which is not
    // what it is for.
    const { error } = await visibleTaskWhere({
      user: req.user,
      tenantId: req.tenantId,
      employeeId,
    });
    if (error) return res.status(error.status).json({ error: error.message });

    const ledger = await weightageFor({
      tenantId: req.tenantId,
      employeeId,
      fy: parsedQuery.data.fy,
      from: parsedQuery.data.from,
      to: parsedQuery.data.to,
      page: parsedQuery.data.page,
      limit: parsedQuery.data.limit,
    });

    // Who may change the numbers, so the UI does not offer an action the API
    // will refuse.
    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    const isManager = String(req.user.role || '').toUpperCase() === 'MANAGER';
    res.json({ ...ledger, canAdjust: (isElevated || isManager) && employeeId !== req.user.id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── PATCH /api/tasks/:id/final-weight ──────────────────────────────────────
export async function setTaskFinalWeight(req, res, next) {
  try {
    const parsedParams = taskIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid task ID parameter', details: parsedParams.error.issues });
    }
    const parsed = finalWeightSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { id } = parsedParams.data;
    const { managerFinalWeight, reason } = parsed.data;

    const task = await loadTaskForUser(id, req.user, req.tenantId);

    // Only someone senior to the work may award credit for it, and never for
    // their own task — the whole point is an independent judgement.
    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    const isManager = String(req.user.role || '').toUpperCase() === 'MANAGER';
    if (!isElevated && !isManager) {
      return res.status(403).json({ error: 'Only a manager, HR or Admin can set the final weightage' });
    }
    if (task.employeeId === req.user.id && !isElevated) {
      return res.status(403).json({ error: 'You cannot set the final weightage on your own task' });
    }

    // The award cannot exceed what the task was planned to be worth. Awarding
    // 40 for a 30-point task would quietly inflate the employee's total beyond
    // the goal it came from.
    const planned = Number(task.weight || 0);
    if (managerFinalWeight !== null && managerFinalWeight > planned) {
      return res.status(400).json({
        error: `The final weightage cannot exceed this task's planned weight of ${planned}%.`,
        plannedWeight: planned,
      });
    }

    const clearing = managerFinalWeight === null;
    const updated = await prisma.task.update({
      where: { id },
      data: {
        managerFinalWeight,
        weightAdjustedById: clearing ? null : req.user.id,
        weightAdjustedAt: clearing ? null : new Date(),
        weightAdjustReason: clearing ? null : (reason?.trim() || null),
      },
      select: WEIGHTAGE_TASK_SELECT,
    });

    const earned = completedWeightOf(task);
    await logTaskAudit({
      taskId: id,
      performedById: req.user.id,
      action: 'edited',
      details: clearing
        ? `Final weightage cleared — the earned ${earned}% stands again.`
        : `Final weightage set to ${managerFinalWeight}% (earned ${earned}%, planned ${planned}%)${reason ? `. Reason: "${reason.trim()}"` : ''}.`,
    }).catch(() => { /* the ledger entry is not worth failing the request over */ });

    const row = weightageRow(updated);
    emitToTenant(req.tenantId, 'task_weightage_updated', { taskId: id, row });
    res.json(row);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ─── GET /api/team/weightage-summary ────────────────────────────────────────
/**
 * One row per person on the caller's team: their totals, so the directory can
 * show weightage without asking per employee.
 *
 * Scope is `visibleTaskWhere` with employeeId 'all' — the same rule the task
 * board uses — so this can only ever aggregate work the caller may already
 * see, and there is no second access rule to drift from it.
 */
export async function getTeamWeightageSummary(req, res, next) {
  try {
    const parsedQuery = teamWeightageQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }

    const { where, error } = await visibleTaskWhere({
      user: req.user,
      tenantId: req.tenantId,
      employeeId: 'all',
    });
    if (error) return res.status(error.status).json({ error: error.message });

    // Visibility AND the period filters, combined with AND because each may
    // contribute its own OR clause.
    const fyWhere = financialYearFilter(parsedQuery.data.fy);
    const dateWhere = dateRangeFilter(parsedQuery.data.from, parsedQuery.data.to);
    const filters = [fyWhere, dateWhere].filter((w) => Object.keys(w).length);
    const tasks = await prisma.task.findMany({
      where: filters.length ? { AND: [where, ...filters] } : where,
      select: WEIGHTAGE_TASK_SELECT,
    });

    const byEmployee = {};
    for (const task of tasks) {
      const row = weightageRow(task);
      const bucket = (byEmployee[row.employeeId] ||= {
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        taskCount: 0, plannedWeight: 0, completedWeight: 0, finalWeight: 0,
        delayedCount: 0, adjustedCount: 0, adjustmentDelta: 0,
      });
      bucket.taskCount += 1;
      bucket.plannedWeight += row.plannedWeight;
      bucket.completedWeight += row.completedWeight;
      bucket.finalWeight += row.finalWeight;
      if (row.isDelayed) bucket.delayedCount += 1;
      if (row.isAdjusted) { bucket.adjustedCount += 1; bucket.adjustmentDelta += row.adjustmentDelta ?? 0; }
    }

    res.json({ items: Object.values(byEmployee) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}
