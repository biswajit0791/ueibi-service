import { prisma } from '../lib/prisma.js';
import { AppraisalNotificationService } from '../services/appraisalNotification.service.js';
import { emitToUser } from '../lib/socket.js';
import { goalService } from '../services/goal.service.js';
import { buildTeamScopeWhere, buildExplicitReportsWhere } from '../services/teamScope.service.js';
import { computeCycleRollup } from '../services/reportAggregation.service.js';
import { getCompanySettings } from '../services/companySettings.service.js';
import { APPRAISAL_MONTH_NAMES, getFiscalYearPeriods, getPeriodMetadata, appraisalAvailability, isQuarterEndMonth } from '../lib/appraisalPeriods.js';
import { getTeamTableMetrics } from '../services/appraisalMetrics.service.js';
import { getTenantFinancialYear } from '../lib/financialYear.js';
import { ELEVATED_ROLES, HR_ROLES, MANAGER_OR_ELEVATED_ROLES, SUPER_ELEVATED_ROLES, hasRole } from '../lib/roles.js';

async function pushNotification({ tenantId, recipientId, type, title, body, entityType, entityId }) {
  if (!recipientId || recipientId === 'system' || !tenantId) return null;
  try {
    const notif = await prisma.notification.create({
      data: {
        tenantId,
        recipientId,
        type: type || 'review_update',
        title,
        body: body || null,
        entityType: entityType || 'review',
        entityId: entityId || null,
      },
    });
    emitToUser(tenantId, recipientId, 'notification', notif);
    return notif;
  } catch (err) {
    console.warn('[AppraisalController] Notification failed:', err.message);
    return null;
  }
}

/**
 * True when `user` may act as the reviewing manager for `employee`:
 * - Elevated roles (HR, SUPER_ADMIN, CMD, ADMIN) can review any employee in their tenant.
 * - Cannot review self.
 * - Direct manager (employee.managerId === user.id) can review.
 * - Downline reporting hierarchy manager (goalService.isSubordinate) can review.
 * - Unassigned managerId fallback: If employee has no explicit managerId assigned,
 *   any tenant MANAGER can review (consistent with buildTeamScopeWhere).
 * - Departmental manager fallback: Manager of the same department can review.
 */
export async function canManagerReview(user, employee, tenantId) {
  if (hasRole(user.role, ELEVATED_ROLES)) return true;
  if (!employee || employee.id === user.id) return false;
  if (employee.tenantId && employee.tenantId !== tenantId) return false;
  if (employee.managerId === user.id) return true;
  if (await goalService.isSubordinate(user.id, employee.id, tenantId)) return true;
  if (!employee.managerId && hasRole(user.role, MANAGER_OR_ELEVATED_ROLES)) return true;
  if (user.department && employee.department &&
      user.department.toLowerCase() === employee.department.toLowerCase() &&
      hasRole(user.role, MANAGER_OR_ELEVATED_ROLES)) return true;
  return false;
}

// Self-assessment can no longer be edited once the manager (or HR) has acted.
const SELF_LOCKED_STATUSES = ['MANAGER_REVIEWED', 'COMPLETED'];

/**
 * Fetch the review for (cycle, employee) or create a DRAFT — race-safe against
 * the unique constraint on (cycleId, employeeId, reviewType).
 */
async function getOrCreateReview(cycleId, employeeId, extraData = {}, include = undefined) {
  const existing = await prisma.performanceReview.findFirst({
    where: { cycleId, employeeId },
    ...(include ? { include } : {}),
  });
  if (existing) return existing;
  try {
    return await prisma.performanceReview.create({
      data: { cycleId, employeeId, status: 'DRAFT', ...extraData },
      ...(include ? { include } : {}),
    });
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    return prisma.performanceReview.findFirst({
      where: { cycleId, employeeId },
      ...(include ? { include } : {}),
    });
  }
}
import {
  createCycleSchema,
  updateCycleSchema,
  createParameterSchema,
  updateParameterSchema,
  selfAssessmentSchema,
  submitSelfRatingSchema,
  managerReviewSchema,
  hrAuditSchema,
  peerNominationSchema,
  peerFeedbackSchema,
  updateReviewSchema,
  listAppraisalsQuerySchema,
  activeCycleQuerySchema,
  listCyclesQuerySchema,
  listParametersQuerySchema,
  syncGoalsToAppraisalSchema,
  myGoalsQuerySchema,
  reviewIdParamSchema,
  cycleIdParamSchema,
  parameterIdParamSchema,
  employeeIdParamSchema,
  nominationIdParamSchema,
  directReportsQuerySchema,
  peerNominationsQuerySchema,
  peerFeedbackQuerySchema,
  cmdPeerFeedbackQuerySchema,
  hrAuditQuerySchema,
  cycleSummaryQuerySchema,
  appraisalTrackerQuerySchema,
} from '../validations/appraisal.schema.js';

const DEFAULT_PARAMETERS = [
  { name: 'Technical Skills', order: 1 },
  { name: 'Conduct & Ethics', order: 2 },
  { name: 'Punctuality & Attendance', order: 3 },
  { name: 'Communication', order: 4 },
  { name: 'Teamwork & Collaboration', order: 5 },
];

export { getPeriodMetadata };

/**
 * Helper to ensure an active cycle exists with default parameters and realistic dynamic dates
 */
async function ensureActiveCycle(tenantId, options = {}) {
  const {
    frequency = 'MONTHLY',
    periodName = null,
    cycleId = null,
    targetDate = new Date(),
    year = null,
    month = null,
    createdById = null,
  } = typeof options === 'string' ? { frequency: options } : options;

  if (cycleId) {
    const foundById = await prisma.appraisalCycle.findFirst({
      where: { id: cycleId, tenantId },
      include: {
        parameters: { orderBy: { order: 'asc' } },
      },
    });
    if (foundById) return foundById;
  }

  const settings = await getCompanySettings(tenantId);
  const period = getPeriodMetadata(frequency, targetDate, periodName, year, month, settings);

  // First try finding an exact cycle matching tenant, frequency, and name (e.g. "March 2031" or "September 2050")
  let cycle = await prisma.appraisalCycle.findFirst({
    where: {
      tenantId,
      frequency: period.frequency,
      name: period.name,
    },
    include: {
      parameters: { orderBy: { order: 'asc' } },
    },
  });

  // If not found, create it dynamically. A concurrent request may create the
  // same (tenantId, frequency, name) row first — the unique constraint turns
  // that into a P2002 which we handle by re-fetching the winner.
  if (!cycle) {
    try {
      cycle = await prisma.appraisalCycle.create({
        data: {
          tenantId,
          name: period.name,
          frequency: period.frequency,
          year: period.year ?? null,
          month: period.month ?? null,
          monthNumber: period.monthNumber ?? null,
          createdById: createdById || null,
          startDate: period.startDate,
          endDate: period.endDate,
          status: 'ACTIVE',
        },
        include: { parameters: true },
      });

      // Check if the tenant already has parameters from an existing cycle so custom skills carry forward!
      const existingParams = await prisma.appraisalParameter.findMany({
        where: { tenantId },
        distinct: ['name'],
        orderBy: { order: 'asc' },
      });

      const paramsToSeed = existingParams.length > 0
        ? existingParams.map((p) => ({ name: p.name, order: p.order, isActive: p.isActive }))
        : DEFAULT_PARAMETERS;

      if (paramsToSeed.length > 0) {
        await prisma.appraisalParameter.createMany({
          data: paramsToSeed.map((param) => ({
            tenantId,
            cycleId: cycle.id,
            name: param.name,
            order: param.order,
            isActive: param.isActive !== false,
          })),
        });
      }
    } catch (err) {
      if (err.code !== 'P2002') throw err;
      // Lost the race — fall through and load the row the other request created.
    }

    cycle = await prisma.appraisalCycle.findFirst({
      where: { tenantId, frequency: period.frequency, name: period.name },
      include: { parameters: { orderBy: { order: 'asc' } } },
    });
  }

  const sDate = new Date(cycle.startDate);
  return {
    ...cycle,
    year: cycle.year || period.year || sDate.getFullYear(),
    month: cycle.month || period.month || APPRAISAL_MONTH_NAMES[sDate.getMonth()],
    monthNumber: cycle.monthNumber || period.monthNumber || (sDate.getMonth() + 1),
  };
}

// ── PHASE 2: CYCLE SETTINGS (HR / SUPER_ADMIN / CMD) ─────────────────────────

/**
 * Explicitly create an appraisal cycle for ANY year and month
 * POST /api/appraisal-cycles
 */
export async function createCycle(req, res, next) {
  try {
    const parsed = createCycleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const {
      year,
      month,
      monthNumber,
      frequency = 'MONTHLY',
      name,
      startDate,
      endDate,
      dueDate,
      status = 'ACTIVE',
    } = parsed.data;

    const settings = await getCompanySettings(req.tenantId);
    const period = getPeriodMetadata(frequency, new Date(), name, year, month, settings);

    const cycleName = name || period.name;
    const cycleStartDate = startDate ? new Date(startDate) : period.startDate;
    const cycleEndDate = endDate ? new Date(endDate) : (dueDate ? new Date(dueDate) : period.endDate);

    // Check if matching cycle already exists
    let existing = await prisma.appraisalCycle.findFirst({
      where: {
        tenantId: req.tenantId,
        frequency: period.frequency,
        name: cycleName,
      },
      include: {
        parameters: { orderBy: { order: 'asc' } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (existing) {
      return res.status(409).json({
        error: `Appraisal cycle for ${period.frequency} ${period.month || ''} ${period.year || ''} already exists.`,
        cycle: {
          ...existing,
          year: existing.year || period.year,
          month: existing.month || period.month,
          monthNumber: existing.monthNumber || period.monthNumber,
        },
      });
    }

    let newCycle;
    try {
      newCycle = await prisma.appraisalCycle.create({
        data: {
          tenantId: req.tenantId,
          name: cycleName,
          frequency: period.frequency,
          year: period.year ?? null,
          month: period.month ?? null,
          monthNumber: monthNumber || period.monthNumber || null,
          createdById: req.user.id,
          startDate: cycleStartDate,
          endDate: cycleEndDate,
          status,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: `Appraisal cycle for ${period.frequency} ${period.month || ''} ${period.year || ''} already exists.`,
        });
      }
      throw err;
    }

    // Clone existing tenant parameters so custom skills carry over to new cycles!
    const existingParams = await prisma.appraisalParameter.findMany({
      where: { tenantId: req.tenantId },
      distinct: ['name'],
      orderBy: { order: 'asc' },
    });

    const paramsToSeed = existingParams.length > 0
      ? existingParams.map((p) => ({ name: p.name, order: p.order, isActive: p.isActive }))
      : DEFAULT_PARAMETERS;

    if (paramsToSeed.length > 0) {
      await prisma.appraisalParameter.createMany({
        data: paramsToSeed.map((param) => ({
          tenantId: req.tenantId,
          cycleId: newCycle.id,
          name: param.name,
          order: param.order,
          isActive: param.isActive !== false,
        })),
      });
    }

    const createdWithParams = await prisma.appraisalCycle.findUnique({
      where: { id: newCycle.id },
      include: {
        parameters: { orderBy: { order: 'asc' } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.status(201).json({
      success: true,
      message: `Appraisal cycle for ${period.name} created successfully.`,
      cycle: {
        ...createdWithParams,
        year: period.year,
        month: period.month,
        monthNumber: monthNumber || period.monthNumber,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * List all appraisal cycles for the tenant with optional filters
 * GET /api/appraisal-cycles
 */
export async function listCycles(req, res, next) {
  try {
    const parsedQuery = listCyclesQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.errors });
    }
    const { year, frequency, status } = parsedQuery.data;

    const where = {
      tenantId: req.tenantId,
    };

    if (frequency) where.frequency = frequency.toUpperCase();
    if (status) where.status = status.toUpperCase();

    const cycles = await prisma.appraisalCycle.findMany({
      where,
      include: {
        parameters: { orderBy: { order: 'asc' } },
        createdBy: { select: { id: true, name: true, email: true } },
        _count: {
          select: { reviews: true, nominations: true },
        },
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });

    let mappedCycles = cycles.map((c) => {
      const sDate = new Date(c.startDate);
      const computedYear = c.year || sDate.getFullYear();
      const computedMonth = c.month || APPRAISAL_MONTH_NAMES[sDate.getMonth()];
      const computedMonthNum = c.monthNumber || (sDate.getMonth() + 1);
      const computedCreatedById = c.createdById;

      return {
        id: c.id,
        name: c.name,
        frequency: c.frequency,
        year: computedYear,
        month: computedMonth,
        monthNumber: computedMonthNum,
        startDate: c.startDate,
        endDate: c.endDate,
        status: c.status,
        createdById: computedCreatedById,
        createdBy: c.createdBy,
        reviewCount: c._count?.reviews || 0,
        nominationCount: c._count?.nominations || 0,
        parameters: c.parameters,
        createdAt: c.createdAt,
      };
    });

    if (year) {
      const filterYear = parseInt(year, 10);
      mappedCycles = mappedCycles.filter((c) => c.year === filterYear);
    }

    // Sort by year desc, monthNumber desc, startDate desc
    mappedCycles.sort((a, b) => {
      if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
      if ((b.monthNumber || 0) !== (a.monthNumber || 0)) return (b.monthNumber || 0) - (a.monthNumber || 0);
      return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
    });

    // Extract all distinct years safely
    const distinctYearSet = new Set();
    mappedCycles.forEach((c) => { if (c.year) distinctYearSet.add(c.year); });
    cycles.forEach((c) => { distinctYearSet.add(new Date(c.startDate).getFullYear()); });
    const distinctYears = Array.from(distinctYearSet).sort((a, b) => b - a);

    res.json({
      success: true,
      count: mappedCycles.length,
      distinctYears,
      cycles: mappedCycles,
    });
  } catch (err) {
    next(err);
  }
}

export async function getActiveCycle(req, res, next) {
  try {
    const parsedQuery = activeCycleQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.errors });
    }
    const {
      frequency: freqQuery = 'MONTHLY',
      period: periodQuery = null,
      cycleId: cycleIdQuery = null,
      year: yearQuery = null,
      month: monthQuery = null,
    } = parsedQuery.data;

    const cycle = await ensureActiveCycle(req.tenantId, {
      frequency: freqQuery,
      periodName: periodQuery,
      cycleId: cycleIdQuery,
      year: yearQuery,
      month: monthQuery,
      createdById: req.user.id,
    });

    // Fetch all available cycles for this tenant
    const availableCycles = await prisma.appraisalCycle.findMany({
      where: { tenantId: req.tenantId },
      select: {
        id: true,
        name: true,
        frequency: true,
        startDate: true,
        endDate: true,
        year: true,
        month: true,
        monthNumber: true,
        status: true,
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });

    const mappedAvailable = availableCycles.map((c) => {
      const sDate = new Date(c.startDate);
      return {
        ...c,
        year: c.year || sDate.getFullYear(),
        month: c.month || APPRAISAL_MONTH_NAMES[sDate.getMonth()],
      };
    });

    const now = new Date();
    const settings = await getCompanySettings(req.tenantId);
    const currentMonthMeta = getPeriodMetadata('MONTHLY', now, null, null, null, settings);
    const currentQuarterMeta = getPeriodMetadata('QUARTERLY', now, null, null, null, settings);
    const currentAnnualMeta = getPeriodMetadata('ANNUAL', now, null, null, null, settings);

    res.json({
      cycle: {
        id: cycle.id,
        name: cycle.name,
        frequency: cycle.frequency,
        year: cycle.year,
        month: cycle.month,
        monthNumber: cycle.monthNumber,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        status: cycle.status,
      },
      parameters: cycle.parameters,
      availableCycles: mappedAvailable,
      currentPeriods: {
        monthly: currentMonthMeta,
        quarterly: currentQuarterMeta,
        annual: currentAnnualMeta,
      },
      fiscalYearStartMonth: settings.financialYearStartMonth || 4,
      fiscalYearStartDay: settings.financialYearStartDay || 1,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateCycle(req, res, next) {
  try {
    const parsedParams = cycleIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid cycle ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;

    const parsed = updateCycleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { frequency, name, status, year, month, startDate, endDate, dueDate } = parsed.data;

    const cycle = await prisma.appraisalCycle.findFirst({
      where: { id, tenantId: req.tenantId },
    });

    if (!cycle) {
      return res.status(404).json({ error: 'Appraisal cycle not found' });
    }

    // `dueDate` is only an alias for `endDate` when no explicit endDate is given.
    const resolvedEndDate = endDate ?? dueDate;

    const updated = await prisma.appraisalCycle.update({
      where: { id },
      data: {
        ...(frequency && { frequency }),
        ...(name && { name }),
        ...(status && { status }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(resolvedEndDate && { endDate: new Date(resolvedEndDate) }),
        ...(year !== undefined && { year: parseInt(year, 10) }),
        ...(month !== undefined && { month }),
      },
      include: {
        parameters: {
          orderBy: { order: 'asc' },
        },
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/appraisal-cycles/:id/summary
 * Org-wide roll-up for HR/Admin/Super Admin/CMD: headcount vs. review status,
 * per-department completion and average scores, and hike sign-off progress
 * for one cycle. Tenant-scoped; no cross-tenant data.
 */
export async function getCycleSummary(req, res, next) {
  try {
    const parsedParams = cycleIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid cycle ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;

    const parsedQuery = cycleSummaryQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsedQuery.error.errors });
    }
    const { department } = parsedQuery.data;

    const cycle = await prisma.appraisalCycle.findFirst({
      where: { id, tenantId: req.tenantId },
    });
    if (!cycle) {
      return res.status(404).json({ error: 'Appraisal cycle not found' });
    }

    // The rollup maths lives in reportAggregation.service.js so the Performance
    // Reports module reuses this exact computation instead of deriving the same
    // numbers a second, divergent way.
    const rollup = await computeCycleRollup({
      tenantId: req.tenantId,
      cycleId: id,
      department,
    });

    res.json({
      cycleId: id,
      cycleName: cycle.name,
      ...rollup,
    });
  } catch (err) {
    next(err);
  }
}

export async function getAppraisalPeriodTracker(req, res, next) {
  try {
    const parsed = appraisalTrackerQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const { frequency, fiscalYearStartYear, department } = parsed.data;
    const settings = await getCompanySettings(req.tenantId);
    const periods = getFiscalYearPeriods(frequency, fiscalYearStartYear, settings);
    const cycleNames = periods.map((period) => period.name);

    await Promise.all(periods.map((period) => ensureActiveCycle(req.tenantId, {
      frequency,
      year: frequency === 'MONTHLY' ? period.year : period.fiscalYearStartYear,
      month: period.month,
      periodName: period.name,
    })));

    const [employees, cycles] = await Promise.all([
      prisma.tenantUser.findMany({
        where: {
          tenantId: req.tenantId,
          status: 'ACTIVE',
          isDeleted: false,
          ...(department ? { department } : {}),
        },
        select: { id: true, name: true, email: true, department: true, designation: true },
        orderBy: { name: 'asc' },
      }),
      prisma.appraisalCycle.findMany({
        where: {
          tenantId: req.tenantId,
          frequency,
          name: { in: cycleNames },
        },
        select: { id: true, name: true, status: true },
      }),
    ]);

    const cycleByName = new Map(cycles.map((cycle) => [cycle.name, cycle]));
    const cycleIds = cycles.map((cycle) => cycle.id);
    const reviews = cycleIds.length
      ? await prisma.performanceReview.findMany({
        where: { cycleId: { in: cycleIds } },
        select: {
          id: true,
          cycleId: true,
          employeeId: true,
          status: true,
          hrSignoffStatus: true,
          selfSubmittedAt: true,
          managerSubmittedAt: true,
        },
      })
      : [];
    const reviewByPeriodAndEmployee = new Map(
      reviews.map((review) => [`${review.cycleId}:${review.employeeId}`, review]),
    );

    const trackerPeriods = periods.map((period) => {
      const cycle = cycleByName.get(period.name) || null;
      const employeesForPeriod = employees.map((employee) => {
        const review = cycle
          ? reviewByPeriodAndEmployee.get(`${cycle.id}:${employee.id}`) || null
          : null;
        let trackingStatus = 'NOT_STARTED';
        if (review?.status === 'DRAFT') trackingStatus = 'DRAFT';
        if (review?.status === 'SUBMITTED') trackingStatus = 'PENDING_MANAGER_REVIEW';
        if (review?.status === 'MANAGER_REVIEWED') trackingStatus = 'PENDING_HR_REVIEW';
        if (review?.status === 'COMPLETED') {
          trackingStatus = review.hrSignoffStatus === 'FINALISED'
            ? 'FINALISED'
            : review.hrSignoffStatus === 'RELEASED'
              ? 'RELEASED'
              : 'PENDING_HR_REVIEW';
        }

        return {
          ...employee,
          reviewId: review?.id || null,
          status: trackingStatus,
          reviewStatus: review?.status || null,
          hrSignoffStatus: review?.hrSignoffStatus || null,
          selfSubmittedAt: review?.selfSubmittedAt || null,
          managerSubmittedAt: review?.managerSubmittedAt || null,
        };
      });
      const completed = employeesForPeriod.filter((employee) =>
        ['COMPLETED', 'RELEASED', 'FINALISED'].includes(employee.status)).length;

      return {
        ...period,
        cycleId: cycle?.id || null,
        cycleStatus: cycle?.status || null,
        totalEmployees: employees.length,
        submittedCount: employeesForPeriod.filter((employee) =>
          employee.status !== 'NOT_STARTED' && employee.status !== 'DRAFT').length,
        draftCount: employeesForPeriod.filter((employee) => employee.status === 'DRAFT').length,
        pendingManagerCount: employeesForPeriod.filter((employee) =>
          employee.status === 'PENDING_MANAGER_REVIEW').length,
        pendingHrCount: employeesForPeriod.filter((employee) =>
          employee.status === 'PENDING_HR_REVIEW').length,
        notStartedCount: employeesForPeriod.filter((employee) =>
          employee.status === 'NOT_STARTED').length,
        completionRate: employees.length > 0
          ? Number(((completed / employees.length) * 100).toFixed(1))
          : 0,
        employees: employeesForPeriod,
      };
    });

    res.json({
      frequency,
      fiscalYearStartYear,
      fiscalYear: periods[0]?.fiscalYear,
      financialYearStartMonth: settings.financialYearStartMonth || 4,
      financialYearStartDay: settings.financialYearStartDay || 1,
      totalEmployees: employees.length,
      periods: trackerPeriods,
    });
  } catch (err) {
    next(err);
  }
}

export async function createParameter(req, res, next) {
  try {
    const parsed = createParameterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { name, order, isActive, cycleId } = parsed.data;

    let targetCycleId = cycleId;
    if (!targetCycleId) {
      const activeCycle = await ensureActiveCycle(req.tenantId, { createdById: req.user.id });
      targetCycleId = activeCycle.id;
    }

    const cycle = await prisma.appraisalCycle.findFirst({
      where: { id: targetCycleId, tenantId: req.tenantId },
    });
    if (!cycle) {
      return res.status(404).json({ error: 'Appraisal cycle not found' });
    }

    let paramOrder = order;
    if (!paramOrder) {
      const lastParam = await prisma.appraisalParameter.findFirst({
        where: { cycleId: targetCycleId },
        orderBy: { order: 'desc' },
      });
      paramOrder = lastParam ? lastParam.order + 1 : 1;
    }

    const parameter = await prisma.appraisalParameter.create({
      data: {
        tenantId: req.tenantId,
        cycleId: targetCycleId,
        name: name.trim(),
        order: paramOrder,
        isActive: isActive !== false,
      },
    });

    res.status(201).json({
      success: true,
      message: `Skill parameter "${parameter.name}" added successfully.`,
      parameter,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteParameter(req, res, next) {
  try {
    const parsedParams = parameterIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameter ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;

    const parameter = await prisma.appraisalParameter.findFirst({
      where: { id, tenantId: req.tenantId },
      include: {
        _count: {
          select: { scores: true },
        },
      },
    });

    if (!parameter) {
      return res.status(404).json({ error: 'Appraisal parameter not found' });
    }

    // If review scores already exist for this parameter, soft-deactivate to protect historical integrity
    if (parameter._count?.scores > 0) {
      const deactivated = await prisma.appraisalParameter.update({
        where: { id },
        data: { isActive: false },
      });
      return res.json({
        success: true,
        deactivated: true,
        message: `Parameter "${parameter.name}" has existing review scores and was deactivated.`,
        parameter: deactivated,
      });
    }

    await prisma.appraisalParameter.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: `Parameter "${parameter.name}" deleted successfully.`,
    });
  } catch (err) {
    next(err);
  }
}

export async function listParameters(req, res, next) {
  try {
    const parsedQuery = listParametersQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.errors });
    }
    const { cycleId } = parsedQuery.data;
    let targetCycleId = cycleId;
    if (!targetCycleId) {
      const active = await ensureActiveCycle(req.tenantId);
      targetCycleId = active.id;
    }

    const parameters = await prisma.appraisalParameter.findMany({
      where: {
        tenantId: req.tenantId,
        cycleId: targetCycleId,
      },
      orderBy: { order: 'asc' },
    });

    res.json({
      success: true,
      count: parameters.length,
      parameters,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateParameter(req, res, next) {
  try {
    const parsedParams = parameterIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameter ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;

    const parsed = updateParameterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { isActive, name, order } = parsed.data;

    const parameter = await prisma.appraisalParameter.findFirst({
      where: { id, tenantId: req.tenantId },
    });

    if (!parameter) {
      return res.status(404).json({ error: 'Appraisal parameter not found' });
    }

    const updated = await prisma.appraisalParameter.update({
      where: { id },
      data: {
        ...(typeof isActive === 'boolean' && { isActive }),
        ...(name && { name }),
        ...(order !== undefined && { order }),
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: SELF ASSESSMENT (EMPLOYEE)
// ─────────────────────────────────────────────────────────────────────────────

// Monthly and Quarterly appraisals: open once the period has ended, show the
// Team-table Final Weightage and Manager Rating read-only, and go straight to
// HR on submission (the manager's input is those task-level figures).
const PERIODIC_FREQUENCIES = new Set(['MONTHLY', 'QUARTERLY']);
const isPeriodic = (cycle) => PERIODIC_FREQUENCIES.has(String(cycle?.frequency || '').toUpperCase());

const fmtOpensAt = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Tell HR that a monthly / quarterly appraisal is waiting for them. Falls back to admins when the company has no HR user. */
async function notifyHrOfSubmission({ tenantId, review, cycle, employeeName }) {
  let recipients = await prisma.tenantUser.findMany({
    where: { tenantId, role: 'HR', isDeleted: false, status: 'ACTIVE', id: { not: review.employeeId } },
    select: { id: true },
  });
  if (recipients.length === 0) {
    recipients = await prisma.tenantUser.findMany({
      where: { tenantId, role: { in: ['SUPER_ADMIN', 'ADMIN'] }, isDeleted: false, status: 'ACTIVE', id: { not: review.employeeId } },
      select: { id: true },
    });
  }
  await Promise.all(recipients.map((r) => pushNotification({
    tenantId,
    recipientId: r.id,
    type: 'appraisal_submitted',
    title: `${cycle.frequency === 'QUARTERLY' ? 'Quarterly' : 'Monthly'} appraisal submitted`,
    body: `${employeeName} submitted the ${cycle.name} appraisal for HR review.`,
    entityType: 'review',
    entityId: review.id,
  })));
}

/**
 * The one path an employee's self-assessment is saved or submitted through
 * (PATCH /performance-reviews/:id/self and POST /appraisals/submit).
 * Returns { status, body } for the caller to send.
 */
async function saveSelfAssessment(req, review, cycle, { selfAccomplishments, selfWeaknesses, selfRating, scores, submit }) {
  if (SELF_LOCKED_STATUSES.includes(review.status) || review.hrSignoffStatus === 'RELEASED') {
    return { status: 409, body: { error: 'Your self-assessment is locked because it has already been reviewed.' } };
  }

  const periodic = isPeriodic(cycle);
  if (String(cycle?.frequency).toUpperCase() === 'MONTHLY') {
    const settings = await getCompanySettings(req.tenantId);
    const monthNumber = cycle.monthNumber || new Date(cycle.startDate).getUTCMonth() + 1;
    if (isQuarterEndMonth(monthNumber, settings)) {
      return {
        status: 409,
        body: {
          error: `${cycle.name} is the last month of its quarter, so it has no monthly appraisal — it is covered by the quarterly appraisal.`,
          code: 'QUARTER_END_MONTH',
        },
      };
    }
  }
  if (periodic) {
    const { available, opensAt } = appraisalAvailability(cycle);
    if (!available) {
      return {
        status: 409,
        body: {
          error: `The ${cycle.name} appraisal opens on ${fmtOpensAt(opensAt)}, once the ${cycle.frequency === 'QUARTERLY' ? 'quarter' : 'month'} has ended.`,
          code: 'APPRAISAL_NOT_OPEN',
          opensAt,
        },
      };
    }
  }

  let totalScore = 0;
  let scoreCount = 0;
  for (const item of Array.isArray(scores) ? scores : []) {
    const raw = item.selfScore ?? item.score;
    if (!item.parameterId || raw === undefined) continue;
    const scoreVal = Number(raw);
    totalScore += scoreVal;
    scoreCount += 1;
    await prisma.reviewScore.upsert({
      where: { reviewId_parameterId: { reviewId: review.id, parameterId: item.parameterId } },
      create: { reviewId: review.id, parameterId: item.parameterId, selfScore: scoreVal },
      update: { selfScore: scoreVal },
    });
  }
  const finalRating = scoreCount > 0
    ? Number((totalScore / scoreCount).toFixed(2))
    : (selfRating !== undefined ? Number(selfRating) : null);

  // A single overall rating (Appraisal Center) uses the same 1–5, half-step scale as parameter scores.
  if (periodic && scoreCount === 0 && finalRating !== null && !Number.isInteger(finalRating * 2)) {
    return { status: 400, body: { error: 'Self rating must be between 1 and 5 in steps of 0.5 (e.g. 3 or 3.5).' } };
  }
  if (periodic && submit && finalRating === null) {
    return { status: 400, body: { error: 'Please give your self rating (1 to 5) before submitting.' } };
  }

  // Freeze what the employee saw at submission, so HR reviews the same figures.
  const metrics = submit && periodic ? await getTeamTableMetrics(req.tenantId, review.employeeId, cycle) : null;

  const updated = await prisma.performanceReview.update({
    where: { id: review.id },
    data: {
      ...(selfAccomplishments !== undefined && { selfAccomplishments }),
      ...(selfWeaknesses !== undefined && { selfWeaknesses }),
      ...(finalRating !== null && { selfRating: finalRating }),
      ...(metrics && {
        managerTaskRatingSnapshot: { ...metrics, snapshotAt: new Date().toISOString() },
        workScore: metrics.finalWeight,
        averageManagerRating: metrics.managerRating,
      }),
      ...(submit && { status: 'SUBMITTED', selfSubmittedAt: new Date() }),
    },
    include: { cycle: true, scores: { include: { parameter: true } } },
  });

  if (submit && periodic) {
    await notifyHrOfSubmission({ tenantId: req.tenantId, review, cycle, employeeName: req.user.name || req.user.email });
  }

  return { status: 200, body: updated };
}

const REVIEW_PERIOD_SELECT = {
  id: true, cycleId: true, status: true, selfRating: true, selfAccomplishments: true,
  selfSubmittedAt: true, hrSignoffStatus: true, hrRemarks: true, managerTaskRatingSnapshot: true,
};

/**
 * GET /api/performance-reviews/mine/periods?fiscalYear=2026
 * Every monthly and quarterly appraisal period of a financial year for the
 * caller — whether it has opened yet, what they have done with it, and the
 * read-only Team-table figures. Lists only; it creates nothing.
 */
export async function getMyAppraisalPeriods(req, res, next) {
  try {
    const settings = await getCompanySettings(req.tenantId);
    const current = getTenantFinancialYear(settings);
    const requested = parseInt(req.query.fiscalYear, 10);
    const fiscalYear = Number.isInteger(requested) && requested > 2000 && requested < 2100 ? requested : current.startYear;

    // Two monthly appraisals per quarter; the quarter-end month's slot is the quarterly one.
    const periods = [
      ...getFiscalYearPeriods('MONTHLY', fiscalYear, settings).filter((p) => !isQuarterEndMonth(p.monthNumber, settings)),
      ...getFiscalYearPeriods('QUARTERLY', fiscalYear, settings),
    ];
    const cycles = await prisma.appraisalCycle.findMany({
      where: { tenantId: req.tenantId, frequency: { in: ['MONTHLY', 'QUARTERLY'] }, name: { in: periods.map((p) => p.name) } },
      select: { id: true, name: true, frequency: true },
    });
    const cycleByKey = new Map(cycles.map((c) => [`${c.frequency}:${c.name}`, c]));
    const reviews = cycles.length
      ? await prisma.performanceReview.findMany({
          where: { employeeId: req.user.id, cycleId: { in: cycles.map((c) => c.id) } },
          select: REVIEW_PERIOD_SELECT,
        })
      : [];
    const reviewByCycle = new Map(reviews.map((r) => [r.cycleId, r]));

    const items = await Promise.all(periods.map(async (period) => {
      const cycle = cycleByKey.get(`${period.frequency}:${period.name}`) || null;
      const review = cycle ? reviewByCycle.get(cycle.id) || null : null;
      const availability = appraisalAvailability(period);
      const snapshot = review?.managerTaskRatingSnapshot?.source === 'TEAM_TABLE' ? review.managerTaskRatingSnapshot : null;
      const teamMetrics = snapshot
        || (availability.available ? await getTeamTableMetrics(req.tenantId, req.user.id, { ...period, id: cycle?.id || null }) : null);
      const { managerTaskRatingSnapshot, ...reviewOut } = review || {};
      return {
        frequency: period.frequency,
        name: period.name,
        periodLabel: period.periodLabel,
        year: period.year,
        month: period.month,
        monthNumber: period.monthNumber,
        startDate: period.startDate,
        endDate: period.endDate,
        availability,
        review: review ? reviewOut : null,
        teamMetrics,
      };
    }));

    res.json({
      fiscalYear,
      fiscalYearLabel: `FY ${fiscalYear}-${String((fiscalYear + 1) % 100).padStart(2, '0')}`,
      currentFiscalYear: current.startYear,
      financialYearStartMonth: current.startMonth,
      monthly: items.filter((i) => i.frequency === 'MONTHLY'),
      quarterly: items.filter((i) => i.frequency === 'QUARTERLY'),
      // The year in order: M, M, Q, M, M, Q … (a quarter sorts by its end, after its two months).
      timeline: [...items].sort((a, b) => new Date(a.endDate) - new Date(b.endDate)),
    });
  } catch (err) {
    next(err);
  }
}

export async function getMyReview(req, res, next) {
  try {
    const parsedQuery = activeCycleQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.errors });
    }
    const {
      frequency: freq = 'MONTHLY',
      period = null,
      cycleId: cycleIdQuery = null,
      year: yearQuery = null,
      month: monthQuery = null,
    } = parsedQuery.data;

    const activeCycle = await ensureActiveCycle(req.tenantId, {
      frequency: freq,
      periodName: period,
      cycleId: cycleIdQuery,
      year: yearQuery,
      month: monthQuery,
      createdById: req.user.id,
    });
    const cycleId = activeCycle.id;

    const review = await getOrCreateReview(
      cycleId,
      req.user.id,
      { reviewType: activeCycle.frequency || 'MONTHLY', dueDate: activeCycle.endDate },
      { cycle: true, scores: { include: { parameter: true } } },
    );

    // Ensure all active parameters have a score slot
    const activeParameters = await prisma.appraisalParameter.findMany({
      where: { cycleId, isActive: true },
      orderBy: { order: 'asc' },
    });
    // Live Team-table figures until submission; the frozen snapshot after.
    const teamMetrics = isPeriodic(activeCycle) && review.status === 'DRAFT'
      ? await getTeamTableMetrics(req.tenantId, req.user.id, activeCycle)
      : (review.managerTaskRatingSnapshot?.source === 'TEAM_TABLE' ? review.managerTaskRatingSnapshot : null);

    res.json({
      review: { ...review, teamMetrics },
      activeParameters,
      cycle: activeCycle,
      availability: appraisalAvailability(activeCycle),
    });
  } catch (err) {
    next(err);
  }
}

export async function updateSelfAssessment(req, res, next) {
  try {
    const parsedParams = reviewIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid review ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;

    const parsed = selfAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: { employee: true, cycle: true },
    });

    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    if (review.employeeId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You can only update your own self-assessment' });
    }

    const result = await saveSelfAssessment(req, review, review.cycle, parsed.data);
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: GOALS ALIGNMENT & APPRAISAL SYNCHRONIZATION
// ─────────────────────────────────────────────────────────────────────────────

export async function getMyGoals(req, res, next) {
  try {
    const parsedQuery = myGoalsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }

    const { page, limit, search, status, category } = parsedQuery.data;
    let targetEmpId = parsedQuery.data.employeeId;
    if (!targetEmpId || targetEmpId === 'mine' || targetEmpId === 'undefined' || targetEmpId === 'null') {
      targetEmpId = req.user.id;
    }

    // Verify target employee belongs to tenant
    const targetUser = await prisma.tenantUser.findFirst({
      where: { id: targetEmpId, tenantId: req.tenantId },
      select: { id: true, name: true, email: true, department: true, designation: true, role: true, managerId: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'Target employee not found in organization' });
    }

    // RBAC & Multi-tenant downline verification:
    // If accessing another employee's goals, caller must be HR / Admin / Super Admin or direct/downline manager
    const callerRole = (req.user.role || '').toUpperCase();
    const isElevatedRole = hasRole(callerRole, ELEVATED_ROLES);
    if (targetEmpId !== req.user.id && !isElevatedRole) {
      const isSubordinate = await goalService.isSubordinate(req.user.id, targetEmpId, req.tenantId);
      const isFallbackSubordinate = (!targetUser.managerId || targetUser.managerId === req.user.id) && ['MANAGER', 'HR', 'ADMIN'].includes(callerRole);
      if (!isSubordinate && !isFallbackSubordinate) {
        return res.status(403).json({ error: 'Access forbidden: employee is not in your reporting downline' });
      }
    }

    const skip = (page - 1) * limit;

    const whereClause = {
      tenantId: req.tenantId,
      OR: [
        { employeeId: targetEmpId },
        { assignments: { some: { employeeId: targetEmpId } } },
      ],
    };

    if (status && status !== 'all') {
      whereClause.status = { equals: status, mode: 'insensitive' };
    }

    if (category && category !== 'all') {
      whereClause.category = { equals: category, mode: 'insensitive' };
    }

    if (search && search.trim()) {
      const s = search.trim();
      whereClause.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { category: { contains: s, mode: 'insensitive' } },
      ];
    }

    // Total matching count for pagination
    const total = await prisma.goal.count({ where: whereClause });
    const totalPages = Math.ceil(total / limit) || 1;

    // Fetch exact created goals with pagination
    const rawGoals = await prisma.goal.findMany({
      where: whereClause,
      include: {
        assignments: {
          where: { employeeId: targetEmpId },
        },
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            employeeId: true,
            managerRating: true,
            managerRatingNotes: true,
            managerRatedAt: true,
            managerRatedBy: { select: { id: true, name: true } },
          },
        },
        employee: {
          select: { id: true, name: true, email: true, department: true, designation: true },
        },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    });

    const goals = rawGoals.map((g) => {
      const a = g.assignments?.[0];
      return {
        ...g,
        progress: a ? a.progress : g.progress,
        status: a ? a.status : g.status,
        milestones: a ? a.milestones : g.milestones,
        completedMilestones: a ? a.completedMilestones : g.completedMilestones,
      };
    });

    // Rollup Synchronization Metrics across all goals of this employee
    const allUserGoals = await prisma.goal.findMany({
      where: {
        tenantId: req.tenantId,
        OR: [
          { employeeId: targetEmpId },
          { assignments: { some: { employeeId: targetEmpId } } },
        ],
      },
      include: {
        assignments: { where: { employeeId: targetEmpId } },
      },
    });

    const userGoalMetrics = allUserGoals.map(g => {
      const a = g.assignments?.[0];
      return {
        progress: a ? a.progress : g.progress,
        status: a ? a.status : g.status,
        milestones: a ? a.milestones : g.milestones,
        completedMilestones: a ? a.completedMilestones : g.completedMilestones,
      };
    });

    const totalGoals = userGoalMetrics.length;
    // Only count goals that have gone through the full workflow and been HR-approved.
    // ACTIVE, PENDING_APPROVAL, PENDING_MANAGER_REVIEW, PENDING_HR_REVIEW, CHANGES_REQUESTED
    // are all in-flight and must NOT be counted as finalized performance inputs.
    const completedGoals = userGoalMetrics.filter(
      g => g.status === 'COMPLETED' || g.status === 'Completed'
    ).length;
    const inProgressGoals = userGoalMetrics.filter(
      g => g.status !== 'COMPLETED' && g.status !== 'Completed'
    ).length;
    const totalProgressSum = userGoalMetrics.reduce((acc, g) => acc + (g.progress || 0), 0);
    const averageProgress = totalGoals > 0 ? Math.round(totalProgressSum / totalGoals) : 0;
    const alignmentScore = totalGoals > 0
      ? Math.min(5.0, Math.max(1.0, +(averageProgress / 20).toFixed(1)))
      : 5.0;

    const milestonesTotal = userGoalMetrics.reduce((acc, g) => acc + (g.milestones || 0), 0);
    const milestonesCompleted = userGoalMetrics.reduce((acc, g) => acc + (g.completedMilestones || 0), 0);

    res.json({
      goals,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      metrics: {
        totalGoals,
        completedGoals,
        inProgressGoals,
        averageProgress,
        alignmentScore,
        milestonesTotal,
        milestonesCompleted,
        completionRate: totalGoals > 0 ? Math.round((completedGoals / totalGoals) * 100) : 0,
      },
      employee: targetUser || {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Synchronize completed and active goals into employee selfAccomplishments
 */
export async function syncGoalsToAppraisal(req, res, next) {
  try {
    const parsed = syncGoalsToAppraisalSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const { reviewId, cycleId, frequency, periodName, year, month } = parsed.data;
    const employeeId = req.user.id;

    // Fetch employee's goals
    const rawGoals = await prisma.goal.findMany({
      where: {
        tenantId: req.tenantId,
        OR: [
          { employeeId },
          { assignments: { some: { employeeId } } },
        ],
      },
      include: {
        assignments: { where: { employeeId } },
      },
      orderBy: [{ progress: 'desc' }, { priority: 'asc' }],
    });

    const goals = rawGoals.map(g => {
      const a = g.assignments?.[0];
      return {
        ...g,
        progress: a ? a.progress : g.progress,
        status: a ? a.status : g.status,
        milestones: a ? a.milestones : g.milestones,
        completedMilestones: a ? a.completedMilestones : g.completedMilestones,
      };
    });

    if (goals.length === 0) {
      return res.status(400).json({ error: 'No goals found to sync with appraisal.' });
    }

    // Build accomplishments text from delivered goals
    const summaryLines = goals.map(g => {
      const statusLabel = g.progress >= 100 ? 'Completed' : `${g.progress}% completed`;
      const milestoneText = g.milestones > 0 ? ` [${g.completedMilestones}/${g.milestones} milestones reached]` : '';
      return `• ${g.title} (${statusLabel}${milestoneText}) — ${g.description || 'Delivered on schedule'}`;
    });

    const accomplishmentsText = `Key Delivered Objectives & Goal Alignments:\n` + summaryLines.join('\n');

    // Calculate suggested self-rating based on average progress
    const totalGoals = goals.length;
    const totalProgress = goals.reduce((acc, g) => acc + (g.progress || 0), 0);
    const avgProgress = totalGoals > 0 ? totalProgress / totalGoals : 75;
    const suggestedRating = Math.min(5.0, Math.max(1.0, +(avgProgress / 20).toFixed(1)));

    let targetReviewId = reviewId;
    if (!targetReviewId) {
      const activeCycle = await ensureActiveCycle(req.tenantId, { frequency, periodName, cycleId, year, month, createdById: req.user.id });
      const existingReview = await getOrCreateReview(activeCycle.id, employeeId, {
        reviewType: activeCycle.frequency || 'MONTHLY',
      });
      targetReviewId = existingReview.id;
    }

    const review = await prisma.performanceReview.findFirst({
      where: { id: targetReviewId, employeeId },
    });

    if (!review) {
      return res.status(404).json({ error: 'Appraisal review record not found' });
    }

    let updatedAccomplishments = review.selfAccomplishments || '';
    if (!updatedAccomplishments.includes('Key Delivered Objectives & Goal Alignments:')) {
      updatedAccomplishments = updatedAccomplishments
        ? `${updatedAccomplishments}\n\n${accomplishmentsText}`
        : accomplishmentsText;
    } else {
      updatedAccomplishments = accomplishmentsText;
    }

    const updated = await prisma.performanceReview.update({
      where: { id: targetReviewId },
      data: {
        selfAccomplishments: updatedAccomplishments,
        ...((!review.selfRating || review.selfRating === 0) && { selfRating: suggestedRating }),
      },
      include: {
        cycle: true,
        scores: { include: { parameter: true } },
      },
    });

    res.json({
      success: true,
      message: 'Goals successfully synchronized into performance appraisal accomplishments!',
      accomplishmentsText,
      suggestedRating,
      review: updated,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: DIRECT REPORT REVIEWS (MANAGER)
// ─────────────────────────────────────────────────────────────────────────────

const DIRECT_REPORT_SELECT = {
  id: true,
  name: true,
  email: true,
  designation: true,
  department: true,
  empType: true,
  role: true,
  managerId: true,
};

export async function getDirectReports(req, res, next) {
  try {
    const parsedQuery = directReportsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { search, department } = parsedQuery.data;

    const { where, isHrOrAdmin } = buildTeamScopeWhere(req.user, req.tenantId, { search, department });

    if (!isHrOrAdmin) {
      // A manager's appraisal team is their reporting downline — direct reports
      // and everyone below them — and nobody else. There is deliberately no
      // fallback to a wider group: a manager without reports has no team here.
      const people = await prisma.tenantUser.findMany({
        where: { tenantId: req.tenantId, isDeleted: false },
        select: { id: true, managerId: true },
      });
      const childrenOf = {};
      people.forEach((u) => { if (u.managerId) (childrenOf[u.managerId] ||= []).push(u.id); });
      const downline = new Set();
      const queue = [req.user.id];
      while (queue.length) {
        for (const child of childrenOf[queue.shift()] || []) {
          if (!downline.has(child) && child !== req.user.id) { downline.add(child); queue.push(child); }
        }
      }
      const explicitWhere = buildExplicitReportsWhere(req.user, req.tenantId, { search, department });
      delete explicitWhere.managerId;
      const directReports = downline.size
        ? await prisma.tenantUser.findMany({
            where: { ...explicitWhere, id: { in: [...downline] } },
            select: DIRECT_REPORT_SELECT,
            orderBy: { name: 'asc' },
          })
        : [];
      return res.json({ directReports });
    }

    const directReports = await prisma.tenantUser.findMany({
      where,
      select: DIRECT_REPORT_SELECT,
      orderBy: { name: 'asc' },
    });

    res.json({ directReports });
  } catch (err) {
    next(err);
  }
}

export async function getEmployeeReviewForManager(req, res, next) {
  try {
    const parsedParams = employeeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.errors });
    }
    const { employeeId } = parsedParams.data;

    const parsedQuery = activeCycleQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.errors });
    }
    const {
      frequency: freq = 'MONTHLY',
      period = null,
      cycleId: cycleIdQuery = null,
      year: yearQuery = null,
      month: monthQuery = null,
    } = parsedQuery.data;

    const activeCycle = await ensureActiveCycle(req.tenantId, {
      cycleId: cycleIdQuery,
      frequency: freq,
      periodName: period,
      year: yearQuery,
      month: monthQuery,
    });
    const cycleId = activeCycle.id;

    const employee = await prisma.tenantUser.findFirst({
      where: { id: employeeId, tenantId: req.tenantId },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (!(await canManagerReview(req.user, employee, req.tenantId))) {
      return res.status(403).json({ error: 'Access forbidden: you are not the manager of this employee' });
    }

    const reviewInclude = {
      employee: {
        select: {
          id: true,
          name: true,
          email: true,
          designation: true,
          department: true,
          role: true,
          managerId: true,
          manager: {
            select: { id: true, name: true, email: true },
          },
          createdAt: true,
        },
      },
      scores: {
        include: { parameter: true },
      },
    };

    // Viewing must not create anything: before the employee starts, there is no review.
    const review = await prisma.performanceReview.findFirst({
      where: { cycleId, employeeId },
      include: reviewInclude,
    });

    const activeParameters = await prisma.appraisalParameter.findMany({
      where: { cycleId, isActive: true },
      orderBy: { order: 'asc' },
    });

    const periodic = isPeriodic(activeCycle);
    const teamMetrics = periodic
      ? (review?.managerTaskRatingSnapshot?.source === 'TEAM_TABLE'
          ? review.managerTaskRatingSnapshot
          : await getTeamTableMetrics(req.tenantId, employeeId, activeCycle))
      : null;

    res.json({
      review: review ? { ...review, teamMetrics } : null,
      teamMetrics,
      activeParameters,
      // Monthly / quarterly go straight to HR; the manager's input is the task ratings and final weightage.
      managerReviewRequired: !periodic,
      availability: appraisalAvailability(activeCycle),
    });
  } catch (err) {
    next(err);
  }
}

export async function updateManagerReview(req, res, next) {
  try {
    const parsedParams = reviewIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid review ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;

    const parsed = managerReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { managerRemarks, managerComments, managerRating, scores } = parsed.data;
    const remarks = managerRemarks || managerComments;

    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: { employee: true, cycle: true },
    });

    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    if (!(await canManagerReview(req.user, review.employee, req.tenantId))) {
      return res.status(403).json({ error: 'Access forbidden: you are not authorized to evaluate this employee' });
    }

    if (isPeriodic(review.cycle)) {
      return res.status(409).json({
        error: 'Monthly and quarterly appraisals go straight to HR. Your rating comes from the task ratings and final weightage you give in the Team table.',
        code: 'NO_MANAGER_REVIEW_FOR_PERIODIC',
      });
    }

    // Stage gating: the employee must have submitted their self-assessment, and a
    // finalised (HR-released / completed) review can no longer be re-opened here.
    if (review.hrSignoffStatus === 'RELEASED' || review.status === 'COMPLETED') {
      return res.status(409).json({ error: 'This appraisal has been finalised and can no longer be changed by the manager.' });
    }
    if (!['SUBMITTED', 'MANAGER_REVIEWED'].includes(review.status) && !hasRole(req.user.role, ELEVATED_ROLES)) {
      return res.status(409).json({ error: 'The employee has not submitted their self-assessment yet.' });
    }

    let totalScore = 0;
    let scoreCount = 0;

    if (Array.isArray(scores)) {
      for (const item of scores) {
        if (item.parameterId && (item.managerScore !== undefined || item.score !== undefined)) {
          const scoreVal = parseFloat(item.managerScore ?? item.score);
          totalScore += scoreVal;
          scoreCount++;

          await prisma.reviewScore.upsert({
            where: {
              reviewId_parameterId: {
                reviewId: id,
                parameterId: item.parameterId,
              },
            },
            create: {
              reviewId: id,
              parameterId: item.parameterId,
              managerScore: scoreVal,
            },
            update: {
              managerScore: scoreVal,
            },
          });
        }
      }
    }

    const avgRating = scoreCount > 0
      ? (totalScore / scoreCount).toFixed(2)
      : (managerRating !== undefined ? Number(managerRating).toFixed(2) : review.managerRating);

    const updated = await prisma.performanceReview.update({
      where: { id },
      data: {
        ...(remarks !== undefined && { managerRemarks: remarks }),
        ...(avgRating !== null && avgRating !== undefined && { managerRating: parseFloat(avgRating) }),
        status: 'MANAGER_REVIEWED',
        managerSubmittedAt: new Date(),
      },
      include: {
        scores: {
          include: { parameter: true },
        },
      },
    });

    // Trigger notification
    await AppraisalNotificationService.notifyManagerReviewSubmitted({
      tenantId: req.tenantId,
      employeeId: review.employeeId,
      reviewId: id,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6: 360° PEER FEEDBACK
// ─────────────────────────────────────────────────────────────────────────────

export async function createPeerNomination(req, res, next) {
  try {
    const nomParsed = peerNominationSchema.safeParse(req.body);
    if (!nomParsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: nomParsed.error.errors });
    }

    const { revieweeId, reviewerId, cycleId: passedCycleId, year, month, reNotify } = req.body || {};
    const activeCycle = await ensureActiveCycle(req.tenantId, { cycleId: passedCycleId, year, month });
    const cycleId = passedCycleId || activeCycle.id;

    const userRole = (req.user.role || '').toUpperCase();
    const isElevated = hasRole(userRole, MANAGER_OR_ELEVATED_ROLES);
    const actualRevieweeId = (isElevated && revieweeId) ? revieweeId : req.user.id;

    if (!reviewerId) {
      return res.status(400).json({ error: 'Reviewer is required' });
    }

    // Verify reviewer exists in the same tenant (supports ID, email, or name)
    let reviewer = await prisma.tenantUser.findFirst({
      where: {
        id: reviewerId,
        tenantId: req.tenantId,
        isDeleted: false,
      },
      select: { id: true, name: true, email: true, designation: true, department: true },
    });

    if (!reviewer) {
      reviewer = await prisma.tenantUser.findFirst({
        where: {
          tenantId: req.tenantId,
          isDeleted: false,
          OR: [
            { email: { equals: reviewerId, mode: 'insensitive' } },
            { name: { equals: reviewerId, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, email: true, designation: true, department: true },
      });
    }

    if (!reviewer) {
      return res.status(404).json({
        error: 'Reviewer not found. Please select a registered colleague from your organization.',
      });
    }

    const actualReviewerId = reviewer.id;

    if (actualRevieweeId === actualReviewerId) {
      return res.status(400).json({ error: 'Self-nomination is not allowed for 360 peer feedback' });
    }

    // Check duplicate nomination
    const existing = await prisma.peerNomination.findUnique({
      where: {
        cycleId_revieweeId_reviewerId: {
          cycleId,
          revieweeId: actualRevieweeId,
          reviewerId: actualReviewerId,
        },
      },
      include: {
        reviewee: { select: { name: true } },
        reviewer: { select: { id: true, name: true, email: true, designation: true, department: true } },
      },
    });

    if (existing) {
      // 1. If previously rejected, reactivate the nomination back to PENDING and notify reviewer
      if (existing.status === 'REJECTED') {
        const reactivated = await prisma.peerNomination.update({
          where: { id: existing.id },
          data: { status: 'PENDING', updatedAt: new Date() },
          include: {
            reviewee: { select: { name: true } },
            reviewer: { select: { id: true, name: true, email: true, designation: true, department: true } },
          },
        });
        await AppraisalNotificationService.notifyPeerNominated({
          tenantId: req.tenantId,
          reviewerId: actualReviewerId,
          revieweeName: reactivated.reviewee?.name || req.user.name || 'Colleague',
          nominationId: reactivated.id,
        });
        return res.status(200).json({
          ...reactivated,
          message: `Nomination for ${reviewer.name} has been reactivated.`,
        });
      }

      // 2. If client explicitly requested reNotify or reminder for pending nomination
      if (reNotify && existing.status === 'PENDING') {
        await AppraisalNotificationService.notifyPeerNominated({
          tenantId: req.tenantId,
          reviewerId: actualReviewerId,
          revieweeName: existing.reviewee?.name || req.user.name || 'Colleague',
          nominationId: existing.id,
        });
        return res.status(200).json({
          ...existing,
          message: `Reminder notification resent to ${reviewer.name}.`,
        });
      }

      // 3. If already COMPLETED
      if (existing.status === 'COMPLETED') {
        return res.status(409).json({
          error: `${reviewer.name || 'This colleague'} has already completed peer feedback for this appraisal cycle.`,
          status: 'COMPLETED',
          existingNominationId: existing.id,
          reviewer: { id: reviewer.id, name: reviewer.name, email: reviewer.email },
        });
      }

      // 4. Default: existing pending nomination
      return res.status(409).json({
        error: `A nomination for ${reviewer.name || 'this peer'} already exists for this cycle`,
        status: existing.status,
        existingNominationId: existing.id,
        reviewer: { id: reviewer.id, name: reviewer.name, email: reviewer.email },
      });
    }

    const nomination = await prisma.peerNomination.create({
      data: {
        tenantId: req.tenantId,
        cycleId,
        revieweeId: actualRevieweeId,
        reviewerId: actualReviewerId,
        status: 'PENDING',
      },
      include: {
        reviewee: {
          select: { name: true },
        },
        reviewer: {
          select: { id: true, name: true, email: true, designation: true, department: true },
        },
      },
    });

    await AppraisalNotificationService.notifyPeerNominated({
      tenantId: req.tenantId,
      reviewerId: actualReviewerId,
      revieweeName: nomination.reviewee.name,
      nominationId: nomination.id,
    });

    res.status(201).json(nomination);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A nomination for this peer already exists for this cycle' });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({ error: 'Invalid reviewer ID: colleague must be an active registered member of your organization.' });
    }
    next(err);
  }
}

export async function getMyNominatedPeers(req, res, next) {
  try {
    const parsedQuery = peerNominationsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { cycleId: cycleIdQuery, year: yearQuery, month: monthQuery, employeeId, revieweeId } = parsedQuery.data;
    const activeCycle = await ensureActiveCycle(req.tenantId, { cycleId: cycleIdQuery, year: yearQuery, month: monthQuery });

    const userRole = (req.user.role || '').toUpperCase();
    const isElevated = hasRole(userRole, MANAGER_OR_ELEVATED_ROLES);
    const targetRevieweeId = (isElevated && (employeeId || revieweeId))
      ? (employeeId || revieweeId)
      : req.user.id;

    const nominations = await prisma.peerNomination.findMany({
      where: {
        tenantId: req.tenantId,
        revieweeId: targetRevieweeId,
        cycleId: activeCycle.id,
      },
      include: {
        reviewer: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
            department: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      revieweeId: targetRevieweeId,
      cycleId: activeCycle.id,
      nominations: nominations.map((n) => ({
        id: n.id,
        reviewerId: n.reviewerId,
        name: n.reviewer?.name || 'Colleague',
        email: n.reviewer?.email,
        designation: n.reviewer?.designation,
        department: n.reviewer?.department,
        status: n.status,
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function deletePeerNomination(req, res, next) {
  try {
    const parsedParams = nominationIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid nomination ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;

    const userRole = (req.user.role || '').toUpperCase();
    const isElevated = hasRole(userRole, ELEVATED_ROLES);

    const nomination = await prisma.peerNomination.findFirst({
      where: {
        id,
        tenantId: req.tenantId,
        ...(isElevated ? {} : { revieweeId: req.user.id }),
      },
    });

    if (!nomination) {
      return res.status(404).json({ error: 'Nomination not found or not owned by you' });
    }

    if (nomination.status === 'COMPLETED' && !isElevated) {
      return res.status(400).json({ error: 'Cannot cancel nomination: peer feedback has already been submitted' });
    }

    // Delete associated feedback if any exists
    await prisma.peerFeedback.deleteMany({
      where: { nominationId: id },
    });

    await prisma.peerNomination.delete({
      where: { id },
    });

    res.json({ success: true, message: 'Nomination cancelled successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getPendingNominationsForMe(req, res, next) {
  try {
    const nominations = await prisma.peerNomination.findMany({
      where: {
        tenantId: req.tenantId,
        reviewerId: req.user.id,
        status: 'PENDING',
      },
      include: {
        reviewee: {
          select: {
            id: true,
            name: true,
            email: true,
            designation: true,
            department: true,
          },
        },
        cycle: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ nominations });
  } catch (err) {
    next(err);
  }
}

export async function submitPeerFeedback(req, res, next) {
  try {
    const parsedParams = nominationIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid nomination ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data; // nominationId

    const parsed = peerFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { rating, strengths, growthAreas } = parsed.data;

    const nomination = await prisma.peerNomination.findUnique({
      where: { id },
      include: { reviewee: true },
    });

    if (!nomination || nomination.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Nomination request not found' });
    }

    if (nomination.reviewerId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You are not the assigned reviewer for this nomination' });
    }

    if (nomination.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Feedback has already been submitted for this nomination' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const feedback = await tx.peerFeedback.create({
        data: {
          nominationId: id,
          rating: parseFloat(rating),
          strengths,
          growthAreas,
        },
      });

      await tx.peerNomination.update({
        where: { id },
        data: { status: 'COMPLETED' },
      });

      return feedback;
    });

    await AppraisalNotificationService.notifyPeerFeedbackReceived({
      tenantId: req.tenantId,
      revieweeId: nomination.revieweeId,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Shared by getReceivedPeerFeedback, getCmdPeerFeedbackForEmployee, and
 * team.controller.js — maps COMPLETED peer nominations (with their feedback
 * + reviewer included) into the flat feedback-item shape all three return.
 */
export function mapNominationsToFeedbackItems(nominations) {
  const items = nominations
    .filter((n) => n.feedback)
    .map((n) => ({
      id: n.feedback.id,
      nominationId: n.id,
      rating: Number(n.feedback.rating),
      strengths: n.feedback.strengths,
      growthAreas: n.feedback.growthAreas,
      createdAt: n.feedback.createdAt,
      reviewerId: n.reviewerId,
      reviewer: n.reviewer,
    }));

  const count = items.length;
  const averageRating = count > 0
    ? (items.reduce((acc, curr) => acc + curr.rating, 0) / count).toFixed(1)
    : '0.0';

  return { items, count, averageRating };
}

export async function getReceivedPeerFeedback(req, res, next) {
  try {
    const parsedQuery = peerFeedbackQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    // Nominations can be created under whichever cycle happens to be selected
    // wherever the nomination was made (self-assessment cadence on the main
    // appraisal page vs. the default "current month" on the 360 hub), and this
    // page has no cycle picker of its own — so unless a cycleId is explicitly
    // requested, show feedback across every cycle rather than silently
    // defaulting to just today's real calendar month.
    const cycleId = parsedQuery.data.cycleId || null;

    const nominations = await prisma.peerNomination.findMany({
      where: {
        tenantId: req.tenantId,
        ...(cycleId ? { cycleId } : {}),
        revieweeId: req.user.id,
        status: 'COMPLETED',
      },
      include: {
        feedback: true,
        reviewer: {
          select: { id: true, name: true, email: true, designation: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Reviewer identity is shown to the recipient by design (not anonymized) —
    // see the "Nominate a Peer" flow, which no longer promises anonymity.
    const { items, count, averageRating } = mapNominationsToFeedbackItems(nominations);

    res.json({
      count,
      averageRating,
      items,
    });
  } catch (err) {
    next(err);
  }
}

export async function getCmdPeerFeedbackForEmployee(req, res, next) {
  try {
    const parsedParams = employeeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.errors });
    }
    const { employeeId } = parsedParams.data;

    const parsedQuery = cmdPeerFeedbackQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    // Same reasoning as getReceivedPeerFeedback: don't silently scope to
    // today's real calendar-month cycle when no cycleId was requested.
    const cycleId = parsedQuery.data.cycleId || null;

    const nominations = await prisma.peerNomination.findMany({
      where: {
        tenantId: req.tenantId,
        ...(cycleId ? { cycleId } : {}),
        revieweeId: employeeId,
        status: 'COMPLETED',
      },
      include: {
        feedback: true,
        reviewer: {
          select: { id: true, name: true, email: true, designation: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const { items, count, averageRating } = mapNominationsToFeedbackItems(nominations);

    res.json({
      count,
      averageRating,
      items,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7: HR AUDIT & HIKE
// ─────────────────────────────────────────────────────────────────────────────

export async function getHrAuditReview(req, res, next) {
  try {
    const parsedParams = employeeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.errors });
    }
    const { employeeId } = parsedParams.data;

    const parsedQuery = hrAuditQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { cycleId: cycleIdQuery, year: yearQuery, month: monthQuery, frequency: freqQuery } = parsedQuery.data;
    const activeCycle = await ensureActiveCycle(req.tenantId, {
      cycleId: cycleIdQuery,
      frequency: freqQuery || 'ANNUAL',
      year: yearQuery,
      month: monthQuery,
    });
    const cycleId = cycleIdQuery || activeCycle.id;

    const employee = await prisma.tenantUser.findFirst({
      where: { id: employeeId, tenantId: req.tenantId },
      include: { manager: { select: { id: true, name: true, email: true } } },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const review = await getOrCreateReview(
      cycleId,
      employeeId,
      { reviewType: activeCycle.frequency || 'ANNUAL' },
      {
        employee: { select: { id: true, name: true, email: true, designation: true, department: true, band: true } },
        hrSignedOffBy: { select: { id: true, name: true, email: true } },
        scores: { include: { parameter: true } },
      },
    );

    const activeParameters = await prisma.appraisalParameter.findMany({
      where: { cycleId, isActive: true },
      orderBy: { order: 'asc' },
    });

    // What the employee saw when they submitted; live Team-table figures before that.
    const teamMetrics = review.managerTaskRatingSnapshot?.source === 'TEAM_TABLE'
      ? review.managerTaskRatingSnapshot
      : await getTeamTableMetrics(req.tenantId, employeeId, activeCycle);
    res.json({
      review: { ...review, teamMetrics },
      employee,
      activeParameters,
      availability: appraisalAvailability(activeCycle),
    });
  } catch (err) {
    next(err);
  }
}

export async function updateHrAuditReview(req, res, next) {
  try {
    const parsedParams = reviewIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid review ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;

    const parsed = hrAuditSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { hikePercentage, hrSignoffStatus, hrRemarks, scores } = parsed.data;

    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: { employee: true, cycle: { select: { frequency: true } } },
    });

    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    // Hikes are decided only on the annual review; monthly/quarterly are tracking reviews
    if (hikePercentage !== undefined && hikePercentage !== null && review.cycle?.frequency !== 'ANNUAL') {
      return res.status(400).json({ error: 'Hike percentage can only be set on the annual appraisal review.' });
    }

    // A user cannot perform an audit and final sign-off on their own appraisal
    if (review.employeeId === req.user.id) {
      return res.status(403).json({
        error: 'You cannot audit or sign off on your own performance review. For HR and Finance personnel, this must be conducted by an Admin or Super Admin.',
      });
    }

    // For HR and Finance personnel, only Admin, Super Admin, or CMD can execute the audit sign-off
    const empRole = String(review.employee?.role || '').toUpperCase();
    if ((empRole === 'HR' || empRole === 'FINANCE') && !hasRole(req.user.role, SUPER_ELEVATED_ROLES)) {
      return res.status(403).json({
        error: `Appraisal audit and hike sign-off for ${empRole} personnel can only be conducted by Admin or Super Admin.`,
      });
    }

    // Irreversible once RELEASED
    if (review.hrSignoffStatus === 'RELEASED') {
      return res.status(409).json({ error: 'Appraisal audit sign-off has already been released and cannot be modified' });
    }

    if (Array.isArray(scores)) {
      for (const item of scores) {
        if (item.parameterId && item.hrScore !== undefined) {
          const scoreVal = parseFloat(item.hrScore);
          await prisma.reviewScore.upsert({
            where: {
              reviewId_parameterId: {
                reviewId: id,
                parameterId: item.parameterId,
              },
            },
            create: {
              reviewId: id,
              parameterId: item.parameterId,
              hrScore: scoreVal,
            },
            update: {
              hrScore: scoreVal,
            },
          });
        }
      }
    }

    const isReleasing = hrSignoffStatus === 'RELEASED';

    const updated = await prisma.performanceReview.update({
      where: { id },
      data: {
        ...(hikePercentage !== undefined && { hikePercentage: parseFloat(hikePercentage) }),
        ...(hrRemarks !== undefined && { hrRemarks }),
        ...(hrSignoffStatus && { hrSignoffStatus }),
        ...(isReleasing && {
          hrSignedOffById: req.user.id,
          hrSignedOffAt: new Date(),
          status: 'COMPLETED',
        }),
      },
      include: {
        hrSignedOffBy: {
          select: { id: true, name: true },
        },
        scores: {
          include: { parameter: true },
        },
      },
    });

    if (isReleasing) {
      await AppraisalNotificationService.notifyHrHikeReleased({
        tenantId: req.tenantId,
        employeeId: review.employeeId,
        managerId: review.employee.managerId,
        hikePercentage: hikePercentage || review.hikePercentage,
        reviewId: id,
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9: REVIEWS ROLLUP DASHBOARD (/uer/reviews)
// ─────────────────────────────────────────────────────────────────────────────

export async function getMyAllReviews(req, res, next, opts = {}) {
  try {
    const parsedQuery = listAppraisalsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsedQuery.error.errors });
    }

    const { page, limit, search, frequency, status, department, cycleId } = parsedQuery.data;
    const skip = (page - 1) * limit;

    const whereClause = {
      cycle: { tenantId: req.tenantId },
    };

    if (opts.allEmployees) {
      // Org-wide view for HR / Admin — optionally narrowed to one employee or department.
      const empFilter = req.query.employeeId;
      if (empFilter && empFilter !== 'all') whereClause.employeeId = empFilter;
      if (department) whereClause.employee = { department };
    } else {
      whereClause.employeeId = req.user.id;
    }

    if (cycleId) {
      whereClause.cycleId = cycleId;
    }

    if (frequency) {
      whereClause.cycle = {
        ...whereClause.cycle,
        frequency: frequency.toUpperCase(),
      };
    }

    if (status) {
      whereClause.status = status.toUpperCase();
    }

    if (search && search.trim()) {
      const term = search.trim();
      whereClause.OR = [
        {
          cycle: {
            name: { contains: term, mode: 'insensitive' },
          },
        },
        {
          selfAccomplishments: { contains: term, mode: 'insensitive' },
        },
        {
          selfWeaknesses: { contains: term, mode: 'insensitive' },
        },
        {
          managerRemarks: { contains: term, mode: 'insensitive' },
        },
      ];
    }

    const [total, reviews] = await Promise.all([
      prisma.performanceReview.count({ where: whereClause }),
      prisma.performanceReview.findMany({
        where: whereClause,
        include: {
          cycle: true,
          scores: {
            include: { parameter: true },
          },
          ...(opts.allEmployees ? {
            employee: { select: { id: true, name: true, email: true, designation: true, department: true } },
          } : {}),
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const formatted = reviews.map((rev) => {
      const selfScores = rev.scores.filter((s) => s.selfScore !== null && s.selfScore !== undefined);
      const mgrScores = rev.scores.filter((s) => s.managerScore !== null && s.managerScore !== undefined);
      const hrScores = rev.scores.filter((s) => s.hrScore !== null && s.hrScore !== undefined);

      const avgSelf = selfScores.length > 0
        ? (selfScores.reduce((acc, s) => acc + s.selfScore, 0) / selfScores.length).toFixed(1)
        : (rev.selfRating ? Number(rev.selfRating).toFixed(1) : null);

      const avgMgr = mgrScores.length > 0
        ? (mgrScores.reduce((acc, s) => acc + s.managerScore, 0) / mgrScores.length).toFixed(1)
        : (rev.managerRating ? Number(rev.managerRating).toFixed(1) : null);

      const avgHr = hrScores.length > 0
        ? (hrScores.reduce((acc, s) => acc + s.hrScore, 0) / hrScores.length).toFixed(1)
        : null;

      return {
        id: rev.id,
        cycleId: rev.cycleId,
        cycleName: rev.cycle?.name || 'Performance Review',
        frequency: rev.cycle?.frequency || rev.reviewType || 'ANNUAL',
        reviewType: rev.reviewType,
        status: rev.status,
        dueDate: rev.dueDate || rev.cycle?.endDate,
        selfAccomplishments: rev.selfAccomplishments,
        selfWeaknesses: rev.selfWeaknesses,
        managerRemarks: rev.managerRemarks,
        hrRemarks: rev.hrRemarks,
        hikePercentage: rev.hikePercentage ? Number(rev.hikePercentage) : null,
        hrSignoffStatus: rev.hrSignoffStatus,
        averageSelfScore: avgSelf,
        averageManagerScore: avgMgr,
        averageHrScore: avgHr,
        scores: rev.scores,
        createdAt: rev.createdAt,
        ...(rev.employee ? { employee: rev.employee, employeeId: rev.employeeId } : {}),
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    res.json({
      reviews: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      total,
      page,
      totalPages,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/performance-reviews/:id and GET /api/appraisals/:id
 * Fetches complete review breakdown by ID with employee identity, cycle metadata, scores, and sign-off status
 */
export async function getReviewById(req, res, next) {
  try {
    const parsedParams = reviewIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid review ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
    const review = await prisma.performanceReview.findFirst({
      where: {
        id,
        cycle: { tenantId: req.tenantId },
      },
      include: {
        cycle: true,
        employee: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            department: true,
            designation: true,
            managerId: true,
            manager: {
              select: { id: true, name: true, email: true },
            },
            createdAt: true,
          },
        },
        scores: {
          include: {
            parameter: true,
          },
          orderBy: { parameter: { order: 'asc' } },
        },
        hrSignedOffBy: {
          select: { id: true, name: true, email: true },
        },
        resultsSharedBy: {
          select: { id: true, name: true, email: true },
        },
        finalisedBy: {
          select: { id: true, name: true, email: true },
        },
        concerns: {
          include: {
            raisedBy: { select: { id: true, name: true, role: true, email: true } },
            respondedBy: { select: { id: true, name: true, role: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!review) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    // RBAC:
    // - Employee can view their own review
    // - A manager anywhere up the reporting chain can view it
    // - Elevated roles (HR / ADMIN / SUPER_ADMIN / CMD) can view all within tenant
    const isOwner = review.employeeId === req.user.id;
    const canView = isOwner || await canManagerReview(req.user, review.employee, req.tenantId);

    if (!canView) {
      return res.status(403).json({ error: 'Access forbidden: You do not have permission to view this appraisal' });
    }

    // Compute averages
    const selfScores = review.scores.filter((s) => s.selfScore !== null && s.selfScore !== undefined);
    const mgrScores = review.scores.filter((s) => s.managerScore !== null && s.managerScore !== undefined);
    const hrScores = review.scores.filter((s) => s.hrScore !== null && s.hrScore !== undefined);

    const avgSelf = selfScores.length > 0
      ? (selfScores.reduce((acc, s) => acc + s.selfScore, 0) / selfScores.length).toFixed(1)
      : (review.selfRating ? Number(review.selfRating).toFixed(1) : null);

    const avgMgr = mgrScores.length > 0
      ? (mgrScores.reduce((acc, s) => acc + s.managerScore, 0) / mgrScores.length).toFixed(1)
      : (review.managerRating ? Number(review.managerRating).toFixed(1) : null);

    const avgHr = hrScores.length > 0
      ? (hrScores.reduce((acc, s) => acc + s.hrScore, 0) / hrScores.length).toFixed(1)
      : null;

    let taskRatingSummary = review.managerTaskRatingSnapshot || null;
    if (!taskRatingSummary && review.cycle) {
      taskRatingSummary = await getTeamTableMetrics(req.tenantId, review.employeeId, review.cycle);
    }

    res.json({
      review: {
        ...review,
        averageSelfScore: avgSelf,
        averageManagerScore: avgMgr,
        averageHrScore: avgHr,
        teamMetrics: taskRatingSummary?.source === 'TEAM_TABLE' ? taskRatingSummary : null,
        managerTaskRatingSummary: taskRatingSummary,
        managerTaskRatingSnapshot: taskRatingSummary || review.managerTaskRatingSnapshot,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Submit employee self-rating for active cycle (POST /api/appraisals/submit)
 */
export async function submitSelfRating(req, res, next) {
  try {
    const parsed = submitSelfRatingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const {
      cycleId: passedCycleId,
      year,
      month,
      frequency,
      periodName,
      rating,
      comments,
      selfRating = rating,
      selfAccomplishments = comments,
      selfWeaknesses,
      scores,
      submit = true,
    } = parsed.data;

    const activeCycle = await ensureActiveCycle(req.tenantId, {
      cycleId: passedCycleId,
      frequency: frequency || 'MONTHLY',
      periodName,
      year,
      month,
      createdById: req.user.id,
    });
    const cycleId = activeCycle.id;

    const review = await getOrCreateReview(cycleId, req.user.id, {
      reviewType: activeCycle.frequency || 'MONTHLY',
      dueDate: activeCycle.endDate,
    });

    const result = await saveSelfAssessment(req, review, activeCycle, {
      selfAccomplishments,
      selfWeaknesses,
      selfRating,
      scores,
      submit,
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
}

/**
 * Submit manager review for an employee appraisal (PATCH /api/appraisals/:id/manager-review)
 */
export async function submitManagerRating(req, res, next) {
  return updateManagerReview(req, res, next);
}

/**
 * List appraisal reviews (GET /api/appraisals)
 * - HR / Admin / CMD / Super Admin: every review in the tenant (optionally
 *   filtered by ?employeeId=).
 * - Everyone else: only their own reviews.
 */
export async function listAppraisals(req, res, next) {
  return getMyAllReviews(req, res, next, { allEmployees: hasRole(req.user.role, ELEVATED_ROLES) });
}

/**
 * Delete a performance review (DELETE /api/performance-reviews/:id & DELETE /api/appraisals/:id)
 * RBAC Rules:
 * - EMPLOYEE: Can delete their own review (e.g. drafts or duplicate submissions).
 * - MANAGER: Can delete direct report review records.
 * - HR / ADMIN / SUPER_ADMIN / CMD / OWNER: Can delete any review in tenant.
 */
export async function deleteReview(req, res, next) {
  try {
    const parsedParams = reviewIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid review ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
    const review = await prisma.performanceReview.findFirst({
      where: {
        id,
        cycle: { tenantId: req.tenantId },
      },
      include: {
        employee: true,
      },
    });

    if (!review) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    const isOwner = review.employeeId === req.user.id;
    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    const isManager = !isElevated && await canManagerReview(req.user, review.employee, req.tenantId);

    if (!isOwner && !isManager && !isElevated) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to delete this appraisal record.' });
    }

    // A review that has progressed past DRAFT is part of the record — only
    // elevated roles may delete it, and a released one is immutable.
    if (review.hrSignoffStatus === 'RELEASED' && req.user.role?.toUpperCase() !== 'SUPER_ADMIN') {
      return res.status(409).json({ error: 'A released appraisal cannot be deleted.' });
    }
    if (review.status !== 'DRAFT' && !isElevated) {
      return res.status(409).json({ error: 'Only a draft appraisal can be deleted by the employee or manager.' });
    }

    await prisma.performanceReview.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Appraisal review record deleted successfully.',
      deletedId: id,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Update review metadata (PATCH /api/performance-reviews/:id & PATCH /api/appraisals/:id)
 * RBAC Rules:
 * - EMPLOYEE (owner): Can update selfAccomplishments, selfWeaknesses, selfRating.
 * - MANAGER: Can update managerRemarks, managerRating.
 * - HR / ADMIN / SUPER_ADMIN / CMD / OWNER: Can update all fields including hikePercentage and status.
 */
export async function updateReview(req, res, next) {
  try {
    const parsedParams = reviewIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid review ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;

    const parsed = updateReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const review = await prisma.performanceReview.findFirst({
      where: {
        id,
        cycle: { tenantId: req.tenantId },
      },
      include: {
        employee: true,
        cycle: { select: { frequency: true } },
      },
    });

    if (!review) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    const isOwner = review.employeeId === req.user.id;
    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    const isManager = !isElevated && await canManagerReview(req.user, review.employee, req.tenantId);

    if (!isOwner && !isManager && !isElevated) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to update this review.' });
    }

    // A finalised review is immutable for everyone except elevated roles.
    if ((review.hrSignoffStatus === 'RELEASED' || review.status === 'COMPLETED') && !isElevated) {
      return res.status(409).json({ error: 'This appraisal has been finalised and can no longer be edited.' });
    }

    const {
      selfAccomplishments,
      selfWeaknesses,
      selfRating,
      managerRemarks,
      managerRating,
      status,
      hikePercentage,
    } = parsed.data;

    const dataToUpdate = {};
    if (isOwner || isElevated) {
      // The owner can only touch self fields while the review is still theirs.
      if (isElevated || !SELF_LOCKED_STATUSES.includes(review.status)) {
        if (selfAccomplishments !== undefined) dataToUpdate.selfAccomplishments = selfAccomplishments;
        if (selfWeaknesses !== undefined) dataToUpdate.selfWeaknesses = selfWeaknesses;
        if (selfRating !== undefined) dataToUpdate.selfRating = Number(selfRating);
      }
    }

    if (isManager || isElevated) {
      if (managerRemarks !== undefined) dataToUpdate.managerRemarks = managerRemarks;
      if (managerRating !== undefined) dataToUpdate.managerRating = Number(managerRating);
    }

    if (isElevated) {
      if (hikePercentage !== undefined) {
        if (review.cycle?.frequency !== 'ANNUAL') {
          return res.status(400).json({ error: 'Hike percentage can only be set on the annual appraisal review.' });
        }
        dataToUpdate.hikePercentage = Number(hikePercentage);
      }
      if (status !== undefined) dataToUpdate.status = status;
    } else if (isOwner && (status === 'DRAFT' || status === 'SUBMITTED') && !SELF_LOCKED_STATUSES.includes(review.status)) {
      // Owner may only move between DRAFT and SUBMITTED, and only before a review has started.
      dataToUpdate.status = status;
    }

    const updated = await prisma.performanceReview.update({
      where: { id },
      data: dataToUpdate,
      include: {
        cycle: true,
        scores: { include: { parameter: true } },
      },
    });

    res.json({ success: true, review: updated });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TWO-STAGE REVIEW CYCLE & CONCERN TICKETING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /performance-reviews/:id/share-results
 * HR / Admin shares review results (Work Score, Manager Rating, HR Rating) with employee.
 */
export async function shareReviewResults(req, res, next) {
  try {
    const parsedParams = reviewIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid review ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;
    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    if (!isElevated) {
      return res.status(403).json({ error: 'Only HR or administrative personnel can share review results.' });
    }

    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: {
        employee: true,
        cycle: true,
      },
    });

    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    if (review.hrSignoffStatus === 'FINALISED' || review.hrSignoffStatus === 'RELEASED') {
      return res.status(409).json({ error: 'This review has already been finalised.' });
    }

    const { hrRating, hrRemarks, workScore: manualWorkScore, averageManagerRating: manualAvgRating } = req.body || {};

    // Calculate workScore automatically if not manually provided
    let calculatedWorkScore = manualWorkScore !== undefined ? Number(manualWorkScore) : review.workScore;
    if (calculatedWorkScore === null || calculatedWorkScore === undefined) {
      const goals = await prisma.goal.findMany({
        where: {
          tenantId: req.tenantId,
          employeeId: review.employeeId,
          status: { in: ['COMPLETED', 'ACTIVE', 'PENDING_HR_REVIEW', 'PENDING_MANAGER_REVIEW'] },
        },
        select: { progress: true },
      });
      if (goals.length > 0) {
        calculatedWorkScore = Math.round(goals.reduce((acc, g) => acc + (g.progress || 0), 0) / goals.length);
      } else {
        calculatedWorkScore = 100;
      }
    }

    // Calculate averageManagerRating automatically if not manually provided
    let calculatedAvgManagerRating = manualAvgRating !== undefined ? Number(manualAvgRating) : review.averageManagerRating;
    if (calculatedAvgManagerRating === null || calculatedAvgManagerRating === undefined) {
      if (TASK_RATING_FREQUENCIES.has(String(review.reviewType || '').toUpperCase())) {
        calculatedAvgManagerRating = review.managerTaskRatingSnapshot?.averageRating ?? null;
      } else {
        const goalsWithRating = await prisma.goal.findMany({
          where: {
            tenantId: req.tenantId,
            employeeId: review.employeeId,
            managerRating: { not: null },
          },
          select: { managerRating: true },
        });
        if (goalsWithRating.length > 0) {
          const sum = goalsWithRating.reduce((acc, g) => acc + (g.managerRating || 0), 0);
          calculatedAvgManagerRating = Number((sum / goalsWithRating.length).toFixed(1));
        } else if (review.managerRating) {
          calculatedAvgManagerRating = Number(review.managerRating);
        }
      }
    }

    const updated = await prisma.performanceReview.update({
      where: { id },
      data: {
        hrSignoffStatus: 'SHARED',
        resultsSharedAt: new Date(),
        resultsSharedById: req.user.id,
        workScore: calculatedWorkScore,
        averageManagerRating: calculatedAvgManagerRating,
        ...(hrRating !== undefined && { hrRating: Number(hrRating) }),
        ...(hrRemarks !== undefined && { hrRemarks }),
      },
      include: {
        resultsSharedBy: { select: { id: true, name: true, email: true } },
        scores: { include: { parameter: true } },
        concerns: {
          include: {
            raisedBy: { select: { id: true, name: true, role: true } },
            respondedBy: { select: { id: true, name: true, role: true } },
          },
        },
      },
    });

    // Notify employee that results are ready to view
    await pushNotification({
      tenantId: req.tenantId,
      recipientId: review.employeeId,
      type: 'review_shared',
      title: 'Performance Review Results Shared',
      body: `HR Partner ${req.user.name} has shared your performance review results. You can review them and submit any feedback or concerns.`,
      entityType: 'review',
      entityId: id,
    });

    res.json({ success: true, review: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /performance-reviews/:id/concerns
 * Employee raises a concern on their shared review results.
 */
export async function raiseReviewConcern(req, res, next) {
  try {
    const parsedParams = reviewIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid review ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;
    const { comment } = req.body || {};

    if (!comment || typeof comment !== 'string' || comment.trim().length < 5) {
      return res.status(400).json({ error: 'Please enter a clear explanation for your concern (at least 5 characters).' });
    }

    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    if (review.employeeId !== req.user.id && !hasRole(req.user.role, ELEVATED_ROLES)) {
      return res.status(403).json({ error: 'Only the review owner can raise a concern.' });
    }

    if (review.hrSignoffStatus === 'FINALISED' || review.hrSignoffStatus === 'RELEASED') {
      return res.status(409).json({ error: 'Cannot raise concerns on a finalised review.' });
    }

    const concern = await prisma.reviewConcern.create({
      data: {
        tenantId: req.tenantId,
        reviewId: id,
        raisedById: req.user.id,
        comment: comment.trim(),
        status: 'OPEN',
      },
      include: {
        raisedBy: { select: { id: true, name: true, role: true, email: true } },
      },
    });

    await prisma.performanceReview.update({
      where: { id },
      data: { hrSignoffStatus: 'CONCERN_RAISED' },
    });

    // Notify Manager & HR
    const managerId = review.employee?.managerId;
    if (managerId) {
      await pushNotification({
        tenantId: req.tenantId,
        recipientId: managerId,
        type: 'review_concern',
        title: 'Review Concern Raised',
        body: `${req.user.name} raised a concern on their performance review: "${comment.trim().slice(0, 80)}..."`,
        entityType: 'review',
        entityId: id,
      });
    }

    const hrUsers = await prisma.tenantUser.findMany({
      where: { tenantId: req.tenantId, role: { in: ['HR', 'ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true },
    });
    for (const hr of hrUsers) {
      if (hr.id !== req.user.id && hr.id !== managerId) {
        await pushNotification({
          tenantId: req.tenantId,
          recipientId: hr.id,
          type: 'review_concern',
          title: 'Review Concern Raised',
          body: `${req.user.name} raised a concern on their performance review.`,
          entityType: 'review',
          entityId: id,
        });
      }
    }

    res.status(201).json({ success: true, concern });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /performance-reviews/:id/concerns
 * Lists all concern thread entries for a review.
 */
export async function listReviewConcerns(req, res, next) {
  try {
    const parsedParams = reviewIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid review ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;

    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const isOwner = review.employeeId === req.user.id;
    const canView = isOwner || await canManagerReview(req.user, review.employee, req.tenantId);
    if (!canView) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const concerns = await prisma.reviewConcern.findMany({
      where: { reviewId: id, tenantId: req.tenantId },
      include: {
        raisedBy: { select: { id: true, name: true, role: true, email: true } },
        respondedBy: { select: { id: true, name: true, role: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ concerns });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /performance-reviews/:id/concerns/:cid/respond
 * Manager or HR responds to a raised concern.
 */
export async function respondReviewConcern(req, res, next) {
  try {
    const { id, cid } = req.params;
    const { response, markResolved = true } = req.body || {};

    if (!response || typeof response !== 'string' || response.trim().length === 0) {
      return res.status(400).json({ error: 'Response content is required.' });
    }

    const concern = await prisma.reviewConcern.findFirst({
      where: { id: cid, reviewId: id, tenantId: req.tenantId },
      include: { review: { include: { employee: true } } },
    });

    if (!concern) {
      return res.status(404).json({ error: 'Review concern not found.' });
    }

    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    const isManager = concern.review.employee?.managerId === req.user.id;
    if (!isElevated && !isManager) {
      return res.status(403).json({ error: 'Only reporting managers or HR can respond to review concerns.' });
    }

    const updatedConcern = await prisma.reviewConcern.update({
      where: { id: cid },
      data: {
        response: response.trim(),
        respondedById: req.user.id,
        respondedAt: new Date(),
        status: markResolved ? 'RESOLVED' : 'OPEN',
      },
      include: {
        raisedBy: { select: { id: true, name: true, role: true, email: true } },
        respondedBy: { select: { id: true, name: true, role: true, email: true } },
      },
    });

    // If marked resolved, check if all concerns on this review are now resolved
    if (markResolved) {
      const openCount = await prisma.reviewConcern.count({
        where: { reviewId: id, status: 'OPEN' },
      });
      if (openCount === 0) {
        await prisma.performanceReview.update({
          where: { id },
          data: { hrSignoffStatus: 'SHARED' },
        });
      }
    }

    // Notify employee of resolution response
    await pushNotification({
      tenantId: req.tenantId,
      recipientId: concern.raisedById,
      type: 'concern_responded',
      title: 'Concern Response Received',
      body: `${req.user.name} responded to your review concern: "${response.trim().slice(0, 80)}..."`,
      entityType: 'review',
      entityId: id,
    });

    res.json({ success: true, concern: updatedConcern });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /performance-reviews/:id/finalise
 * HR final sign-off: locks review permanently.
 */
export async function finaliseReview(req, res, next) {
  try {
    const parsedParams = reviewIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid review ID parameter', details: parsedParams.error.errors });
    }
    const { id } = parsedParams.data;
    const isElevated = hasRole(req.user.role, ELEVATED_ROLES);
    if (!isElevated) {
      return res.status(403).json({ error: 'Only HR or administrative personnel can finalise a review.' });
    }

    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    // Check if open concerns remain
    const openConcernsCount = await prisma.reviewConcern.count({
      where: { reviewId: id, status: 'OPEN' },
    });
    if (openConcernsCount > 0) {
      return res.status(400).json({
        error: `Cannot finalise review: There are ${openConcernsCount} open concern(s) that must be addressed or resolved first.`,
      });
    }

    const finalised = await prisma.performanceReview.update({
      where: { id },
      data: {
        hrSignoffStatus: 'FINALISED',
        finalisedAt: new Date(),
        finalisedById: req.user.id,
        hrSignedOffAt: new Date(),
        hrSignedOffById: req.user.id,
        status: 'COMPLETED',
      },
      include: {
        finalisedBy: { select: { id: true, name: true, email: true } },
        scores: { include: { parameter: true } },
      },
    });

    // Notify employee & manager
    await pushNotification({
      tenantId: req.tenantId,
      recipientId: review.employeeId,
      type: 'review_finalised',
      title: 'Performance Review Finalised',
      body: `Your performance review has been officially finalised by HR Partner ${req.user.name}.`,
      entityType: 'review',
      entityId: id,
    });

    if (review.employee?.managerId) {
      await pushNotification({
        tenantId: req.tenantId,
        recipientId: review.employee.managerId,
        type: 'review_finalised',
        title: 'Report Review Finalised',
        body: `The performance review for ${review.employee.name} has been finalised by HR.`,
        entityType: 'review',
        entityId: id,
      });
    }

    res.json({ success: true, review: finalised });
  } catch (err) {
    next(err);
  }
}
