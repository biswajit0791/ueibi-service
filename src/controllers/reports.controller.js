import { prisma } from '../lib/prisma.js';
import { computeCycleRollup } from '../services/reportAggregation.service.js';
import {
  REPORT_CATALOG,
  buildReport,
  countReportRows,
  toCsv,
} from '../services/reportExport.service.js';
import { toGoalsFinancialYear } from '../lib/financialYear.js';
import {
  analyticsQuerySchema,
  trendQuerySchema,
  catalogQuerySchema,
  exportParamSchema,
  exportQuerySchema,
} from '../validations/reports.schema.js';

/**
 * Resolves the cycle a report should cover: the requested one, or the tenant's
 * most recent cycle by start date. Returns null when the tenant has no cycles
 * at all — callers report honest zeros rather than inventing numbers.
 */
async function resolveCycle(tenantId, cycleId) {
  if (cycleId) {
    return prisma.appraisalCycle.findFirst({ where: { id: cycleId, tenantId } });
  }
  return prisma.appraisalCycle.findFirst({
    where: { tenantId },
    orderBy: { startDate: 'desc' },
  });
}

/** Tenant-wide goal completion stats for a financial year. */
async function getGoalStats(tenantId, financialYear) {
  const goalsFy = financialYear ? toGoalsFinancialYear(financialYear) : undefined;
  // Scoped by Goal.tenantId (not employee.tenantId) so goals with no assignee
  // are still counted — they belong to the tenant either way.
  const goals = await prisma.goal.findMany({
    where: { tenantId, ...(goalsFy ? { financialYear: goalsFy } : {}) },
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
    const { cycleId, department } = parsedQuery.data;
    const tenantId = req.tenantId;

    const cycle = await resolveCycle(tenantId, cycleId);
    if (cycleId && !cycle) {
      return res.status(404).json({ error: 'Appraisal cycle not found' });
    }

    const [rollup, goalStats] = await Promise.all([
      cycle
        ? computeCycleRollup({ tenantId, cycleId: cycle.id, department })
        : Promise.resolve(null),
      getGoalStats(tenantId, cycle?.name),
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
      reviewSummary: rollup
        ? {
            totalReviews: rollup.totalReviews,
            byStatus: rollup.byStatus,
            completionRate: rollup.completionRate,
            hikeSummary: rollup.hikeSummary,
          }
        : null,
      goalSummary: goalStats,
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
        avg: avgOf(withMgr, 'avgManagerScore') ?? avgOf(withSelf, 'avgSelfScore') ?? 0,
        avgManagerScore: avgOf(withMgr, 'avgManagerScore'),
        avgSelfScore: avgOf(withSelf, 'avgSelfScore'),
        completionRate: rollup.completionRate,
        totalReviews: rollup.totalReviews,
      });
    }

    res.json({ points, sufficientData: points.length >= 2 });
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
    const { cycleId, department } = parsedQuery.data;
    const tenantId = req.tenantId;

    const cycle = await resolveCycle(tenantId, cycleId);
    if (cycleId && !cycle) {
      return res.status(404).json({ error: 'Appraisal cycle not found' });
    }

    const args = { tenantId, cycle, department, financialYear: cycle?.name };
    const reports = await Promise.all(
      REPORT_CATALOG.map(async (r) => ({
        ...r,
        format: 'CSV',
        rowCount: await countReportRows(r.key, args),
        scopeLabel: cycle ? cycle.name : 'No appraisal cycle yet',
      })),
    );

    res.json({
      cycle: cycle ? { id: cycle.id, name: cycle.name } : null,
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

    const cycle = await resolveCycle(tenantId, cycleId);
    if (cycleId && !cycle) {
      return res.status(404).json({ error: 'Appraisal cycle not found' });
    }

    const { headers, rows } = await buildReport(reportKey, {
      tenantId,
      cycle,
      department,
      financialYear: financialYear || cycle?.name,
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
