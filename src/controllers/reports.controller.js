import { prisma } from '../lib/prisma.js';
import { computeCycleRollup, computeGoalStats } from '../services/reportAggregation.service.js';
import {
  REPORT_CATALOG,
  buildReport,
  countReportRows,
  toCsv,
} from '../services/reportExport.service.js';
import { getTenantFinancialYear } from '../lib/financialYear.js';
import { getCompanySettings } from '../services/companySettings.service.js';
import {
  analyticsQuerySchema,
  trendQuerySchema,
  catalogQuerySchema,
  exportParamSchema,
  exportQuerySchema,
} from '../validations/reports.schema.js';

/**
 * Resolves the cycle a report should cover: the requested one, or the most
 * recent cycle that has started and has reviews (monthly cycles are created
 * ahead of time, so "latest by start date" is often an empty future month).
 * Returns null when the tenant has no cycles at all — callers report honest
 * zeros rather than inventing numbers.
 */
async function resolveCycle(tenantId, cycleId) {
  if (cycleId) {
    return prisma.appraisalCycle.findFirst({ where: { id: cycleId, tenantId } });
  }
  const now = new Date();
  return (
    (await prisma.appraisalCycle.findFirst({
      where: { tenantId, startDate: { lte: now }, reviews: { some: {} } },
      orderBy: { startDate: 'desc' },
    }))
    || (await prisma.appraisalCycle.findFirst({
      where: { tenantId, startDate: { lte: now } },
      orderBy: { startDate: 'desc' },
    }))
    || prisma.appraisalCycle.findFirst({ where: { tenantId }, orderBy: { startDate: 'desc' } })
  );
}

/** The tenant's financial year window ({ label, startDate, endDate }) that contains `date`. */
function fyContaining(settings, date) {
  const { label, startDate, endDate } = getTenantFinancialYear(settings, date);
  return { label, startDate, endDate };
}

/** Same window, addressed by its start year (local noon avoids timezone edge days). */
function fyStartingIn(settings, startYear) {
  const month = Number(settings?.financialYearStartMonth) || 4;
  const day = Number(settings?.financialYearStartDay) || 1;
  return fyContaining(settings, new Date(startYear, month - 1, day, 12));
}

/**
 * The financial year FY-scoped reports cover: the one asked for, else the one
 * the selected cycle falls in, else the current one. Derived from the cycle's
 * dates, not its name — "January 2027" belongs to FY 2026-27, not FY 2027-28.
 */
function resolveFinancialYear(settings, cycle, requested) {
  const match = requested && requested.match(/(\d{4})/);
  if (match) return fyStartingIn(settings, Number(match[1]));
  if (cycle) {
    const mid = new Date((new Date(cycle.startDate).getTime() + new Date(cycle.endDate).getTime()) / 2);
    return fyContaining(settings, mid);
  }
  return fyContaining(settings, new Date());
}

/** The current financial year and the four before it, newest first, for the FY filter. */
function recentFinancialYears(settings) {
  const current = getTenantFinancialYear(settings, new Date());
  return Array.from({ length: 5 }, (_, i) => fyStartingIn(settings, current.startYear - i).label);
}

/**
 * Tenant-wide goal completion stats for a financial year.
 *
 * The maths lives in computeGoalStats (reportAggregation.service.js) so the
 * dashboard summary shares it; this wrapper keeps the tenant/FY scope that
 * Reports needs. Scoped by Goal.tenantId (not employee.tenantId) so goals with
 * no assignee are still counted — they belong to the tenant either way.
 */
async function getGoalStats(tenantId, fyLabel) {
  return computeGoalStats({ tenantId, ...(fyLabel ? { financialYear: fyLabel } : {}) });
}

/** Task, leave and exit roll-up for the financial year, optionally one department. */
async function getPeopleStats(tenantId, fy, department) {
  const byDept = department ? { department } : {};
  const taskWhere = {
    tenantId,
    isPrivate: false,
    OR: [
      { financialYear: fy.label },
      { financialYear: null, dueDate: { gte: fy.startDate, lte: fy.endDate } },
    ],
    ...(department ? { employee: byDept } : {}),
  };
  const [invited, totalTasks, doneTasks, overdueTasks, leave, exits] = await Promise.all([
    prisma.tenantUser.count({ where: { tenantId, status: 'INVITED', isDeleted: false, ...byDept } }),
    prisma.task.count({ where: taskWhere }),
    prisma.task.count({ where: { ...taskWhere, status: 'done' } }),
    prisma.task.count({ where: { ...taskWhere, status: { not: 'done' }, dueDate: { lt: new Date() } } }),
    prisma.leaveRequest.aggregate({
      where: {
        status: 'APPROVED',
        requestType: 'LEAVE',
        startDate: { gte: fy.startDate, lte: fy.endDate },
        employee: { tenantId, ...byDept },
      },
      _sum: { totalDays: true },
    }),
    prisma.exitDetails.count({
      where: {
        tenantId,
        lastWorkingDay: { gte: fy.startDate, lte: fy.endDate },
        ...(department ? { user: byDept } : {}),
      },
    }),
  ]);
  return {
    invitedEmployees: invited,
    totalTasks,
    completedTasks: doneTasks,
    overdueTasks,
    taskCompletionRate: totalTasks > 0 ? Number(((doneTasks / totalTasks) * 100).toFixed(1)) : 0,
    approvedLeaveDays: Number(leave._sum.totalDays || 0),
    exits,
  };
}

/**
 * GET /reports/analytics
 *
 * Real appraisal-backed analytics for one cycle. Replaces the previous version,
 * which derived a fake "score" from Goal.progress / 20 and returned hardcoded
 * Engineering/Design departments whenever a tenant had no goals.
 */
export async function getAnalyticsSummary(req, res, next) {
  try {
    const parsedQuery = analyticsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { cycleId, department, financialYear } = parsedQuery.data;
    const tenantId = req.tenantId;

    const [cycle, settings] = await Promise.all([resolveCycle(tenantId, cycleId), getCompanySettings(tenantId)]);
    if (cycleId && !cycle) {
      return res.status(404).json({ error: 'Appraisal cycle not found' });
    }
    const fy = resolveFinancialYear(settings, cycle, financialYear);

    const [rollup, goalStats, peopleStats] = await Promise.all([
      cycle
        ? computeCycleRollup({ tenantId, cycleId: cycle.id, department })
        : Promise.resolve(null),
      getGoalStats(tenantId, fy.label),
      getPeopleStats(tenantId, fy, department),
    ]);

    const totalHeadcount = rollup
      ? rollup.totalEmployees
      : await prisma.tenantUser.count({
          where: { tenantId, status: 'ACTIVE', isDeleted: false },
        });

    res.json({
      // Preserved keys so existing consumers keep working.
      totalHeadcount,
      averageGoalProgress: goalStats.averageGoalProgress,
      // Real appraisal averages per department — empty when there are no
      // reviews yet, never fabricated.
      departmentPerformance: rollup
        ? rollup.departmentBreakdown.map((d) => ({
            dept: d.department,
            score: d.avgManagerScore ?? d.avgSelfScore ?? 0,
            avgSelfScore: d.avgSelfScore,
            avgManagerScore: d.avgManagerScore,
            avgHrScore: d.avgHrScore,
            employees: d.total,
            completionRate: d.completionRate,
          }))
        : [],
      cycle: cycle ? { id: cycle.id, name: cycle.name, frequency: cycle.frequency, status: cycle.status } : null,
      financialYear: fy.label,
      reviewSummary: rollup
        ? {
            totalReviews: rollup.totalReviews,
            byStatus: rollup.byStatus,
            completionRate: rollup.completionRate,
            hikeSummary: rollup.hikeSummary,
          }
        : null,
      goalSummary: goalStats,
      peopleSummary: peopleStats,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /reports/trend
 *
 * One point per real appraisal cycle, oldest first. Replaces the frontend's
 * hardcoded Q1–Q4 2024 line. Returns [] when the tenant has fewer than two
 * cycles with reviews, so the UI can say so instead of drawing a fake trend.
 */
export async function getPerformanceTrend(req, res, next) {
  try {
    const parsedQuery = trendQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { frequency, department, limit } = parsedQuery.data;
    const tenantId = req.tenantId;

    const cycles = await prisma.appraisalCycle.findMany({
      where: { tenantId, ...(frequency ? { frequency } : {}) },
      orderBy: { startDate: 'desc' },
      take: limit,
      select: { id: true, name: true, frequency: true, startDate: true },
    });

    const points = [];
    for (const c of cycles.slice().reverse()) {
      const rollup = await computeCycleRollup({ tenantId, cycleId: c.id, department });
      // Only cycles that actually have reviews can contribute a data point.
      if (rollup.totalReviews === 0) continue;

      const withSelf = rollup.departmentBreakdown.filter((d) => d.avgSelfScore != null);
      const withMgr = rollup.departmentBreakdown.filter((d) => d.avgManagerScore != null);
      const avgOf = (arr, key) => (arr.length ? Number((arr.reduce((s, d) => s + d[key], 0) / arr.length).toFixed(1)) : null);

      points.push({
        cycleId: c.id,
        quarter: c.name,            // `quarter` key kept: it's the recharts XAxis dataKey
        label: c.name,
        frequency: c.frequency,
        startDate: c.startDate,
        // null (not 0) while a cycle's reviews are unscored, so the chart shows
        // a gap instead of a false drop.
        avg: avgOf(withMgr, 'avgManagerScore') ?? avgOf(withSelf, 'avgSelfScore'),
        avgManagerScore: avgOf(withMgr, 'avgManagerScore'),
        avgSelfScore: avgOf(withSelf, 'avgSelfScore'),
        completionRate: rollup.completionRate,
        totalReviews: rollup.totalReviews,
      });
    }

    res.json({ points, sufficientData: points.filter((p) => p.avg != null).length >= 2 });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /reports/catalog
 *
 * The real report list with live row counts, replacing the hardcoded table
 * (and its permanently-stale "Today, 09:41 AM" timestamps).
 */
export async function getReportCatalog(req, res, next) {
  try {
    const parsedQuery = catalogQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { cycleId, department, financialYear } = parsedQuery.data;
    const tenantId = req.tenantId;

    const [cycle, settings] = await Promise.all([resolveCycle(tenantId, cycleId), getCompanySettings(tenantId)]);
    if (cycleId && !cycle) {
      return res.status(404).json({ error: 'Appraisal cycle not found' });
    }
    const fy = resolveFinancialYear(settings, cycle, financialYear);

    const scopeLabel = (scope) => {
      if (scope === 'financialYear') return fy.label;
      if (scope === 'current') return 'Current workforce';
      return cycle ? cycle.name : 'No appraisal cycle yet';
    };

    const args = { tenantId, cycle, department, fy };
    const reports = await Promise.all(
      REPORT_CATALOG.map(async (r) => ({
        ...r,
        format: 'CSV',
        rowCount: await countReportRows(r.key, args),
        scopeLabel: scopeLabel(r.scope),
      })),
    );

    const financialYears = recentFinancialYears(settings);
    if (!financialYears.includes(fy.label)) financialYears.push(fy.label);

    res.json({
      cycle: cycle ? { id: cycle.id, name: cycle.name, frequency: cycle.frequency } : null,
      financialYear: fy.label,
      financialYears,
      reports,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /reports/export/:reportKey
 *
 * Streams a real CSV built from live data, following the Content-Type /
 * Content-Disposition pattern established by policy.controller.js.
 */
export async function exportReport(req, res, next) {
  try {
    const parsedParams = exportParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid report key', details: parsedParams.error.issues });
    }
    const parsedQuery = exportQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { reportKey } = parsedParams.data;
    const { cycleId, department, financialYear } = parsedQuery.data;
    const tenantId = req.tenantId;

    const [cycle, settings] = await Promise.all([resolveCycle(tenantId, cycleId), getCompanySettings(tenantId)]);
    if (cycleId && !cycle) {
      return res.status(404).json({ error: 'Appraisal cycle not found' });
    }

    const { headers, rows } = await buildReport(reportKey, {
      tenantId,
      cycle,
      department,
      fy: resolveFinancialYear(settings, cycle, financialYear),
    });

    const stamp = new Date().toISOString().split('T')[0];
    const fileName = `${reportKey}-${stamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(toCsv(headers, rows));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}
