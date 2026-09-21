import { prisma } from '../lib/prisma.js';

/**
 * @file reportAggregation.service.js
 * @description Single source of truth for appraisal-cycle rollups.
 *
 * This logic previously lived inline in appraisal.controller.js's
 * getCycleSummary. It was extracted so the Performance Reports module and the
 * appraisal cycle-summary endpoint compute the same numbers from the same
 * code, rather than deriving them twice and drifting apart — a real risk here,
 * since dashboard.controller.js already computes "completion rate" over a
 * different denominator (totalReviews) than this does (totalEmployees).
 *
 * Behaviour is intentionally preserved exactly, including:
 *  - null department is labelled 'Unassigned'
 *  - per-review mean-of-parameters, then averaged across reviews
 *    (mean-of-means, NOT a flat mean over all scores)
 *  - department buckets with no active headcount are dropped
 *  - every average rounded to 1dp, or null when there is nothing to average
 */

/** Active, non-deleted employees for a tenant, optionally one department. */
export function buildEmployeeWhere(tenantId, department) {
  return {
    tenantId,
    status: 'ACTIVE',
    isDeleted: false,
    ...(department ? { department } : {}),
  };
}

/**
 * Computes the org-wide rollup for a single appraisal cycle.
 *
 * @param {Object} args
 * @param {string} args.tenantId
 * @param {string} args.cycleId
 * @param {string} [args.department] optional department filter
 * @returns {Promise<Object>} rollup (without cycleId/cycleName — callers add those)
 */
export async function computeCycleRollup({ tenantId, cycleId, department }) {
  const employeeWhere = buildEmployeeWhere(tenantId, department);

  const [totalEmployees, headcountByDept, reviews] = await Promise.all([
    prisma.tenantUser.count({ where: employeeWhere }),
    prisma.tenantUser.groupBy({
      by: ['department'],
      where: employeeWhere,
      _count: { department: true },
    }),
    prisma.performanceReview.findMany({
      where: {
        cycleId,
        ...(department ? { employee: { department } } : {}),
      },
      select: {
        status: true,
        hikePercentage: true,
        hrSignoffStatus: true,
        employee: { select: { department: true } },
        scores: { select: { selfScore: true, managerScore: true, hrScore: true } },
      },
    }),
  ]);

  const byStatus = { DRAFT: 0, SUBMITTED: 0, MANAGER_REVIEWED: 0, COMPLETED: 0 };
  const deptMap = new Map();
  for (const row of headcountByDept) {
    const dept = row.department || 'Unassigned';
    deptMap.set(dept, {
      department: dept, total: row._count.department, completed: 0,
      selfSum: 0, selfN: 0, mgrSum: 0, mgrN: 0, hrSum: 0, hrN: 0,
    });
  }

  let hikeSum = 0;
  let hikeN = 0;
  let pendingRelease = 0;
  let released = 0;

  for (const rev of reviews) {
    byStatus[rev.status] = (byStatus[rev.status] || 0) + 1;

    const dept = rev.employee?.department || 'Unassigned';
    if (!deptMap.has(dept)) {
      deptMap.set(dept, {
        department: dept, total: 0, completed: 0,
        selfSum: 0, selfN: 0, mgrSum: 0, mgrN: 0, hrSum: 0, hrN: 0,
      });
    }
    const bucket = deptMap.get(dept);
    if (rev.status === 'COMPLETED') bucket.completed += 1;

    const selfScores = rev.scores.filter((s) => s.selfScore != null);
    const mgrScores = rev.scores.filter((s) => s.managerScore != null);
    const hrScores = rev.scores.filter((s) => s.hrScore != null);
    if (selfScores.length) {
      bucket.selfSum += selfScores.reduce((a, s) => a + s.selfScore, 0) / selfScores.length;
      bucket.selfN += 1;
    }
    if (mgrScores.length) {
      bucket.mgrSum += mgrScores.reduce((a, s) => a + s.managerScore, 0) / mgrScores.length;
      bucket.mgrN += 1;
    }
    if (hrScores.length) {
      bucket.hrSum += hrScores.reduce((a, s) => a + s.hrScore, 0) / hrScores.length;
      bucket.hrN += 1;
    }

    if (rev.hikePercentage != null) {
      hikeSum += Number(rev.hikePercentage);
      hikeN += 1;
    }
    if (rev.hrSignoffStatus === 'RELEASED') released += 1;
    else pendingRelease += 1;
  }

  const departmentBreakdown = Array.from(deptMap.values())
    // A review whose employee has no headcount in this department bucket
    // (e.g. an inactive/deleted employee, or one with no department set)
    // shouldn't produce a hollow "0 of 0" entry.
    .filter((b) => b.total > 0)
    .map((b) => ({
      department: b.department,
      total: b.total,
      completed: b.completed,
      completionRate: b.total > 0 ? Number(((b.completed / b.total) * 100).toFixed(1)) : 0,
      avgSelfScore: b.selfN > 0 ? Number((b.selfSum / b.selfN).toFixed(1)) : null,
      avgManagerScore: b.mgrN > 0 ? Number((b.mgrSum / b.mgrN).toFixed(1)) : null,
      avgHrScore: b.hrN > 0 ? Number((b.hrSum / b.hrN).toFixed(1)) : null,
    }))
    .sort((a, b) => a.department.localeCompare(b.department));

  const completedCount = byStatus.COMPLETED || 0;

  return {
    totalEmployees,
    totalReviews: reviews.length,
    byStatus,
    completionRate: totalEmployees > 0 ? Number(((completedCount / totalEmployees) * 100).toFixed(1)) : 0,
    departmentBreakdown,
    hikeSummary: {
      avgHikePercentage: hikeN > 0 ? Number((hikeSum / hikeN).toFixed(1)) : null,
      pendingRelease,
      released,
    },
  };
}

/**
 * Goal completion stats for an arbitrary scope.
 *
 * Extracted from reports.controller.js's private getGoalStats so the Reports
 * module and the dashboard summary compute "average goal progress" from one
 * implementation rather than two that can drift.
 *
 * `where` is supplied by the caller so the same maths can run tenant-wide
 * (Reports) or narrowed to one viewer's assignments (dashboard). Callers are
 * responsible for including tenantId — this helper never widens a scope.
 */
export async function computeGoalStats(where) {
  const goals = await prisma.goal.findMany({
    where,
    select: { progress: true, status: true },
  });
  const total = goals.length;
  const completed = goals.filter((g) => String(g.status).toUpperCase() === 'COMPLETED').length;
  return {
    totalGoals: total,
    completedGoals: completed,
    goalCompletionRate: total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0,
    averageGoalProgress: total > 0 ? Math.round(goals.reduce((s, g) => s + g.progress, 0) / total) : 0,
  };
}
