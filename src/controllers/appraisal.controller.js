import { prisma } from '../lib/prisma.js';
import { stripPeerReviewerIdentity } from '../lib/privacy.js';
import { AppraisalNotificationService } from '../services/appraisalNotification.service.js';
import { goalService } from '../services/goal.service.js';
import {
  updateCycleSchema,
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
  syncGoalsToAppraisalSchema,
  myGoalsQuerySchema,
  reviewIdParamSchema,
} from '../validations/appraisal.schema.js';

const DEFAULT_PARAMETERS = [
  { name: 'Technical Skills', order: 1 },
  { name: 'Conduct & Ethics', order: 2 },
  { name: 'Punctuality & Attendance', order: 3 },
  { name: 'Communication', order: 4 },
  { name: 'Teamwork & Collaboration', order: 5 },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Dynamically computes start date, end date, period name, and due date based on live date
 */
export function getPeriodMetadata(frequency = 'MONTHLY', targetDate = new Date(), customPeriodName = null) {
  const date = targetDate instanceof Date ? targetDate : new Date(targetDate);
  const year = date.getFullYear();
  const monthIndex = date.getMonth();

  if (customPeriodName && typeof customPeriodName === 'string') {
    const matchedMonth = MONTH_NAMES.findIndex(m => customPeriodName.toLowerCase().includes(m.toLowerCase()));
    if (matchedMonth !== -1) {
      const yearMatch = customPeriodName.match(/\b(20\d\d)\b/);
      const parsedYear = yearMatch ? parseInt(yearMatch[1], 10) : year;
      const startDate = new Date(Date.UTC(parsedYear, matchedMonth, 1, 0, 0, 0));
      const endDate = new Date(Date.UTC(parsedYear, matchedMonth + 1, 0, 23, 59, 59));
      return {
        name: `${MONTH_NAMES[matchedMonth]} ${parsedYear}`,
        frequency: 'MONTHLY',
        startDate,
        endDate,
        periodLabel: `${MONTH_NAMES[matchedMonth]} ${parsedYear}`,
        dueDate: endDate,
      };
    }
  }

  const freq = (frequency || 'MONTHLY').toUpperCase();

  if (freq === 'MONTHLY') {
    const monthName = MONTH_NAMES[monthIndex];
    const name = `${monthName} ${year}`;
    const startDate = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59));
    return {
      name,
      frequency: 'MONTHLY',
      startDate,
      endDate,
      periodLabel: `${monthName} (${year})`,
      dueDate: endDate,
    };
  }

  if (freq === 'QUARTERLY') {
    const quarter = Math.floor(monthIndex / 3) + 1;
    const qStartMonth = (quarter - 1) * 3;
    const startDate = new Date(Date.UTC(year, qStartMonth, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, qStartMonth + 3, 0, 23, 59, 59));
    return {
      name: `Q${quarter} ${year}`,
      frequency: 'QUARTERLY',
      startDate,
      endDate,
      periodLabel: `Quarterly (Q${quarter} ${year})`,
      dueDate: endDate,
    };
  }

  // ANNUAL (Fiscal year April 1 - March 31)
  const isPostApril = monthIndex >= 3;
  const fyStartYear = isPostApril ? year : year - 1;
  const fyEndYear = fyStartYear + 1;
  const name = `FY ${fyStartYear}-${fyEndYear}`;
  const startDate = new Date(Date.UTC(fyStartYear, 3, 1, 0, 0, 0));
  const endDate = new Date(Date.UTC(fyEndYear, 2, 31, 23, 59, 59));
  return {
    name,
    frequency: 'ANNUAL',
    startDate,
    endDate,
    periodLabel: `Annual (${name})`,
    dueDate: endDate,
  };
}

/**
 * Helper to ensure an active cycle exists with default parameters and realistic dynamic dates
 */
async function ensureActiveCycle(tenantId, options = {}) {
  const {
    frequency = 'MONTHLY',
    periodName = null,
    cycleId = null,
    targetDate = new Date(),
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

  const period = getPeriodMetadata(frequency, targetDate, periodName);

  // First try finding an exact cycle matching tenant, name, and frequency
  let cycle = await prisma.appraisalCycle.findFirst({
    where: {
      tenantId,
      name: period.name,
      frequency: period.frequency,
    },
    include: {
      parameters: { orderBy: { order: 'asc' } },
    },
  });

  // If not found, create it dynamically
  if (!cycle) {
    cycle = await prisma.appraisalCycle.create({
      data: {
        tenantId,
        name: period.name,
        frequency: period.frequency,
        startDate: period.startDate,
        endDate: period.endDate,
        status: 'ACTIVE',
      },
      include: {
        parameters: true,
      },
    });

    for (const param of DEFAULT_PARAMETERS) {
      await prisma.appraisalParameter.create({
        data: {
          tenantId,
          cycleId: cycle.id,
          name: param.name,
          order: param.order,
          isActive: true,
        },
      });
    }

    cycle = await prisma.appraisalCycle.findUnique({
      where: { id: cycle.id },
      include: {
        parameters: {
          orderBy: { order: 'asc' },
        },
      },
    });
  }

  return cycle;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: CYCLE SETTINGS (HR / SUPER_ADMIN / CMD)
// ─────────────────────────────────────────────────────────────────────────────

export async function getActiveCycle(req, res, next) {
  try {
    const parsedQuery = activeCycleQuerySchema.safeParse(req.query);
    const freqQuery = (parsedQuery.success && parsedQuery.data.frequency)
      ? parsedQuery.data.frequency
      : (req.query.frequency ? req.query.frequency.toUpperCase() : 'MONTHLY');
    const periodQuery = parsedQuery.success ? (parsedQuery.data.period || null) : (req.query.period || null);
    const cycleIdQuery = parsedQuery.success ? (parsedQuery.data.cycleId || null) : (req.query.cycleId || null);

    const cycle = await ensureActiveCycle(req.tenantId, {
      frequency: freqQuery,
      periodName: periodQuery,
      cycleId: cycleIdQuery,
    });

    // Also fetch all available cycles for this tenant so the user can easily select past/active cycles
    const availableCycles = await prisma.appraisalCycle.findMany({
      where: { tenantId: req.tenantId },
      select: {
        id: true,
        name: true,
        frequency: true,
        startDate: true,
        endDate: true,
        status: true,
      },
      orderBy: { startDate: 'desc' },
    });

    const now = new Date();
    const currentMonthMeta = getPeriodMetadata('MONTHLY', now);
    const currentQuarterMeta = getPeriodMetadata('QUARTERLY', now);
    const currentAnnualMeta = getPeriodMetadata('ANNUAL', now);

    res.json({
      cycle: {
        id: cycle.id,
        name: cycle.name,
        frequency: cycle.frequency,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        status: cycle.status,
      },
      parameters: cycle.parameters,
      availableCycles,
      currentPeriods: {
        monthly: currentMonthMeta,
        quarterly: currentQuarterMeta,
        annual: currentAnnualMeta,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateCycle(req, res, next) {
  try {
    const { id } = req.params;

    const parsed = updateCycleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { frequency, name, status } = parsed.data;

    const cycle = await prisma.appraisalCycle.findFirst({
      where: { id, tenantId: req.tenantId },
    });

    if (!cycle) {
      return res.status(404).json({ error: 'Appraisal cycle not found' });
    }

    const updated = await prisma.appraisalCycle.update({
      where: { id },
      data: {
        ...(frequency && { frequency }),
        ...(name && { name }),
        ...(status && { status }),
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

export async function updateParameter(req, res, next) {
  try {
    const { id } = req.params;

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

export async function getMyReview(req, res, next) {
  try {
    const freq = req.query.frequency ? req.query.frequency.toUpperCase() : 'MONTHLY';
    const period = req.query.period || null;
    const cycleIdQuery = req.query.cycleId || null;

    const activeCycle = await ensureActiveCycle(req.tenantId, {
      frequency: freq,
      periodName: period,
      cycleId: cycleIdQuery,
    });
    const cycleId = activeCycle.id;

    let review = await prisma.performanceReview.findFirst({
      where: {
        cycleId,
        employeeId: req.user.id,
      },
      include: {
        cycle: true,
        scores: {
          include: {
            parameter: true,
          },
        },
      },
    });

    // If no review exists, create a DRAFT review
    if (!review) {
      review = await prisma.performanceReview.create({
        data: {
          cycleId,
          employeeId: req.user.id,
          status: 'DRAFT',
          reviewType: activeCycle.frequency || 'MONTHLY',
          dueDate: activeCycle.endDate,
        },
        include: {
          cycle: true,
          scores: {
            include: {
              parameter: true,
            },
          },
        },
      });
    }

    // Ensure all active parameters have a score slot
    const activeParameters = await prisma.appraisalParameter.findMany({
      where: { cycleId, isActive: true },
      orderBy: { order: 'asc' },
    });

    res.json({
      review,
      activeParameters,
      cycle: activeCycle,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateSelfAssessment(req, res, next) {
  try {
    const { id } = req.params;

    const parsed = selfAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { selfAccomplishments, selfWeaknesses, scores, submit } = parsed.data;

    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    if (review.employeeId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You can only update your own self-assessment' });
    }

    // Upsert scores if provided
    let totalScore = 0;
    let scoreCount = 0;

    if (Array.isArray(scores)) {
      for (const item of scores) {
        if (item.parameterId && item.selfScore !== undefined) {
          const scoreVal = parseInt(item.selfScore, 10);
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
              selfScore: scoreVal,
            },
            update: {
              selfScore: scoreVal,
            },
          });
        }
      }
    }

    const avgRating = scoreCount > 0 ? (totalScore / scoreCount).toFixed(2) : review.selfRating;

    const updated = await prisma.performanceReview.update({
      where: { id },
      data: {
        ...(selfAccomplishments !== undefined && { selfAccomplishments }),
        ...(selfWeaknesses !== undefined && { selfWeaknesses }),
        ...(scoreCount > 0 && { selfRating: parseFloat(avgRating) }),
        ...(submit && {
          status: 'SUBMITTED',
          selfSubmittedAt: new Date(),
        }),
      },
      include: {
        scores: {
          include: {
            parameter: true,
          },
        },
      },
    });

    res.json(updated);
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
      select: { id: true, name: true, email: true, department: true, designation: true, role: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'Target employee not found in organization' });
    }

    // RBAC & Multi-tenant downline verification:
    // If accessing another employee's goals, caller must be HR / Admin / Super Admin or direct/downline manager
    if (targetEmpId !== req.user.id && !['SUPER_ADMIN', 'ADMIN', 'HR', 'LEADERSHIP', 'OWNER'].includes(req.user.role)) {
      const isSubordinate = await goalService.isSubordinate(req.user.id, targetEmpId, req.tenantId);
      if (!isSubordinate) {
        return res.status(403).json({ error: 'Access forbidden: employee is not in your reporting downline' });
      }
    }

    const skip = (page - 1) * limit;

    const whereClause = {
      tenantId: req.tenantId,
      employeeId: targetEmpId,
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
    const goals = await prisma.goal.findMany({
      where: whereClause,
      include: {
        tasks: {
          select: { id: true, title: true, status: true, priority: true, dueDate: true },
        },
        employee: {
          select: { id: true, name: true, email: true, department: true, designation: true },
        },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    });

    // Rollup Synchronization Metrics across all goals of this employee
    const allUserGoals = await prisma.goal.findMany({
      where: { tenantId: req.tenantId, employeeId: targetEmpId },
      select: { progress: true, status: true, milestones: true, completedMilestones: true },
    });

    const totalGoals = allUserGoals.length;
    // Only count goals that have gone through the full workflow and been HR-approved.
    // ACTIVE, PENDING_APPROVAL, PENDING_MANAGER_REVIEW, PENDING_HR_REVIEW, CHANGES_REQUESTED
    // are all in-flight and must NOT be counted as finalized performance inputs.
    const completedGoals = allUserGoals.filter(
      g => g.status === 'COMPLETED' || g.status === 'Completed'
    ).length;
    const inProgressGoals = allUserGoals.filter(
      g => g.status !== 'COMPLETED' && g.status !== 'Completed'
    ).length;
    const totalProgressSum = allUserGoals.reduce((acc, g) => acc + (g.progress || 0), 0);
    const averageProgress = totalGoals > 0 ? Math.round(totalProgressSum / totalGoals) : 0;
    const alignmentScore = totalGoals > 0
      ? Math.min(5.0, Math.max(1.0, +(averageProgress / 20).toFixed(1)))
      : 5.0;

    const milestonesTotal = allUserGoals.reduce((acc, g) => acc + (g.milestones || 0), 0);
    const milestonesCompleted = allUserGoals.reduce((acc, g) => acc + (g.completedMilestones || 0), 0);

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

    const { reviewId, cycleId, frequency, periodName } = parsed.data;
    const employeeId = req.user.id;

    // Fetch employee's goals
    const goals = await prisma.goal.findMany({
      where: {
        tenantId: req.tenantId,
        employeeId,
      },
      orderBy: [{ progress: 'desc' }, { priority: 'asc' }],
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
      const activeCycle = await ensureActiveCycle(req.tenantId, { frequency, periodName, cycleId });
      let existingReview = await prisma.performanceReview.findFirst({
        where: { employeeId, cycleId: activeCycle.id },
      });
      if (!existingReview) {
        existingReview = await prisma.performanceReview.create({
          data: {
            employeeId,
            cycleId: activeCycle.id,
            status: 'DRAFT',
          },
        });
      }
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

export async function getDirectReports(req, res, next) {
  try {
    const isHrOrAdmin = ['HR', 'SUPER_ADMIN', 'CMD', 'ADMIN'].includes(req.user.role);

    const where = isHrOrAdmin
      ? { tenantId: req.tenantId, status: 'ACTIVE' }
      : { tenantId: req.tenantId, managerId: req.user.id, status: 'ACTIVE' };

    const directReports = await prisma.tenantUser.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        designation: true,
        department: true,
        empType: true,
        role: true,
        managerId: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({ directReports });
  } catch (err) {
    next(err);
  }
}

export async function getEmployeeReviewForManager(req, res, next) {
  try {
    const { employeeId } = req.params;
    const freq = req.query.frequency ? req.query.frequency.toUpperCase() : 'MONTHLY';
    const period = req.query.period || null;
    const cycleIdQuery = req.query.cycleId || null;

    const activeCycle = await ensureActiveCycle(req.tenantId, {
      cycleId: cycleIdQuery,
      frequency: freq,
      periodName: period,
    });
    const cycleId = activeCycle.id;

    const employee = await prisma.tenantUser.findFirst({
      where: { id: employeeId, tenantId: req.tenantId },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const isHrOrAdmin = ['HR', 'SUPER_ADMIN', 'CMD', 'ADMIN', 'OWNER'].includes(req.user.role?.toUpperCase());
    const isManager = employee.managerId === req.user.id;

    if (!isManager && !isHrOrAdmin) {
      return res.status(403).json({ error: 'Access forbidden: you are not the manager of this employee' });
    }

    let review = await prisma.performanceReview.findFirst({
      where: { cycleId, employeeId },
      include: {
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
      },
    });

    if (!review) {
      review = await prisma.performanceReview.create({
        data: {
          cycleId,
          employeeId,
          status: 'DRAFT',
          reviewType: activeCycle.frequency || 'MONTHLY',
          dueDate: activeCycle.endDate,
        },
        include: {
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
        },
      });
    }

    const activeParameters = await prisma.appraisalParameter.findMany({
      where: { cycleId, isActive: true },
      orderBy: { order: 'asc' },
    });

    res.json({ review, activeParameters });
  } catch (err) {
    next(err);
  }
}

export async function updateManagerReview(req, res, next) {
  try {
    const { id } = req.params;

    const parsed = managerReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { managerRemarks, managerComments, managerRating, scores } = parsed.data;
    const remarks = managerRemarks || managerComments;

    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    const isHrOrAdmin = ['HR', 'SUPER_ADMIN', 'CMD'].includes(req.user.role);
    const isManager = review.employee.managerId === req.user.id;

    if (!isManager && !isHrOrAdmin) {
      return res.status(403).json({ error: 'Access forbidden: you are not authorized to evaluate this employee' });
    }

    let totalScore = 0;
    let scoreCount = 0;

    if (Array.isArray(scores)) {
      for (const item of scores) {
        if (item.parameterId && (item.managerScore !== undefined || item.score !== undefined)) {
          const scoreVal = parseInt(item.managerScore ?? item.score, 10);
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

    const { revieweeId, reviewerId, cycleId: passedCycleId } = req.body || {};
    const activeCycle = await ensureActiveCycle(req.tenantId);
    const cycleId = passedCycleId || activeCycle.id;

    const actualRevieweeId = revieweeId || req.user.id;

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
      select: { id: true, name: true, email: true },
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
        select: { id: true, name: true, email: true },
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
    });

    if (existing) {
      return res.status(409).json({ error: 'A nomination for this peer already exists for this cycle' });
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
    const activeCycle = await ensureActiveCycle(req.tenantId);
    const nominations = await prisma.peerNomination.findMany({
      where: {
        tenantId: req.tenantId,
        revieweeId: req.user.id,
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
      nominations: nominations.map((n) => ({
        id: n.id,
        reviewerId: n.reviewerId,
        name: n.reviewer?.name || 'Colleague',
        email: n.reviewer?.email,
        designation: n.reviewer?.designation,
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
    const { id } = req.params;
    const nomination = await prisma.peerNomination.findFirst({
      where: {
        id,
        tenantId: req.tenantId,
        revieweeId: req.user.id,
      },
    });

    if (!nomination) {
      return res.status(404).json({ error: 'Nomination not found or not owned by you' });
    }

    await prisma.peerNomination.delete({
      where: { id },
    });

    res.json({ message: 'Nomination cancelled successfully' });
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
    const { id } = req.params; // nominationId

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

export async function getReceivedPeerFeedback(req, res, next) {
  try {
    const activeCycle = await ensureActiveCycle(req.tenantId);
    const cycleId = req.query.cycleId || activeCycle.id;

    const nominations = await prisma.peerNomination.findMany({
      where: {
        tenantId: req.tenantId,
        cycleId,
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

    // Mask reviewer identity for non-CMD
    const sanitizedItems = stripPeerReviewerIdentity(items, req.user.role);

    const count = sanitizedItems.length;
    const averageRating = count > 0
      ? (sanitizedItems.reduce((acc, curr) => acc + curr.rating, 0) / count).toFixed(1)
      : '0.0';

    res.json({
      count,
      averageRating,
      items: sanitizedItems,
    });
  } catch (err) {
    next(err);
  }
}

export async function getCmdPeerFeedbackForEmployee(req, res, next) {
  try {
    const { employeeId } = req.params;
    const activeCycle = await ensureActiveCycle(req.tenantId);
    const cycleId = req.query.cycleId || activeCycle.id;

    const nominations = await prisma.peerNomination.findMany({
      where: {
        tenantId: req.tenantId,
        cycleId,
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
    const { employeeId } = req.params;
    const activeCycle = await ensureActiveCycle(req.tenantId);
    const cycleId = req.query.cycleId || activeCycle.id;

    const employee = await prisma.tenantUser.findFirst({
      where: { id: employeeId, tenantId: req.tenantId },
      include: { manager: { select: { id: true, name: true, email: true } } },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    let review = await prisma.performanceReview.findFirst({
      where: { cycleId, employeeId },
      include: {
        employee: {
          select: { id: true, name: true, email: true, designation: true, department: true, band: true },
        },
        hrSignedOffBy: {
          select: { id: true, name: true, email: true },
        },
        scores: {
          include: { parameter: true },
        },
      },
    });

    if (!review) {
      review = await prisma.performanceReview.create({
        data: {
          cycleId,
          employeeId,
          status: 'DRAFT',
          reviewType: activeCycle.frequency || 'ANNUAL',
        },
        include: {
          employee: {
            select: { id: true, name: true, email: true, designation: true, department: true, band: true },
          },
          hrSignedOffBy: {
            select: { id: true, name: true, email: true },
          },
          scores: {
            include: { parameter: true },
          },
        },
      });
    }

    const activeParameters = await prisma.appraisalParameter.findMany({
      where: { cycleId, isActive: true },
      orderBy: { order: 'asc' },
    });

    res.json({ review, employee, activeParameters });
  } catch (err) {
    next(err);
  }
}

export async function updateHrAuditReview(req, res, next) {
  try {
    const { id } = req.params;

    const parsed = hrAuditSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { hikePercentage, hrSignoffStatus, hrRemarks, scores } = parsed.data;

    const review = await prisma.performanceReview.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    // Irreversible once RELEASED
    if (review.hrSignoffStatus === 'RELEASED') {
      return res.status(409).json({ error: 'Appraisal audit sign-off has already been released and cannot be modified' });
    }

    if (Array.isArray(scores)) {
      for (const item of scores) {
        if (item.parameterId && item.hrScore !== undefined) {
          const scoreVal = parseInt(item.hrScore, 10);
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

export async function getMyAllReviews(req, res, next) {
  try {
    const parsedQuery = listAppraisalsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Invalid query parameters', details: parsedQuery.error.errors });
    }

    const { page, limit, search, frequency, status } = parsedQuery.data;
    const skip = (page - 1) * limit;

    const whereClause = {
      employeeId: req.user.id,
      cycle: { tenantId: req.tenantId },
    };

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
      },
    });

    if (!review) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    // RBAC:
    // - Employee can view their own review
    // - Manager can view direct reports' reviews
    // - HR, ADMIN, SUPER_ADMIN, CMD, LEADERSHIP, OWNER can view all within tenant
    const allowedRoles = ['HR', 'ADMIN', 'SUPER_ADMIN', 'CMD', 'LEADERSHIP', 'OWNER'];
    const isElevated = allowedRoles.includes(req.user.role?.toUpperCase());
    const isOwner = review.employeeId === req.user.id;
    const isManager = review.employee?.managerId === req.user.id;

    if (!isElevated && !isOwner && !isManager) {
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

    res.json({
      review: {
        ...review,
        averageSelfScore: avgSelf,
        averageManagerScore: avgMgr,
        averageHrScore: avgHr,
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
    });
    const cycleId = activeCycle.id;

    let review = await prisma.performanceReview.findFirst({
       where: {
         cycleId,
         employeeId: req.user.id,
       },
    });

    if (!review) {
      review = await prisma.performanceReview.create({
        data: {
          cycleId,
          employeeId: req.user.id,
          status: 'DRAFT',
          reviewType: activeCycle.frequency || 'MONTHLY',
          dueDate: activeCycle.endDate,
        },
      });
    }

    let totalScore = 0;
    let scoreCount = 0;

    if (Array.isArray(scores)) {
      for (const item of scores) {
        if (item.parameterId && (item.selfScore !== undefined || item.score !== undefined)) {
          const scoreVal = parseInt(item.selfScore ?? item.score, 10);
          totalScore += scoreVal;
          scoreCount++;

          await prisma.reviewScore.upsert({
            where: {
              reviewId_parameterId: {
                reviewId: review.id,
                parameterId: item.parameterId,
              },
            },
            create: {
              reviewId: review.id,
              parameterId: item.parameterId,
              selfScore: scoreVal,
            },
            update: {
              selfScore: scoreVal,
            },
          });
        }
      }
    }

    const finalRating = scoreCount > 0
      ? parseFloat((totalScore / scoreCount).toFixed(2))
      : (selfRating !== undefined ? parseFloat(selfRating) : review.selfRating);

    const updated = await prisma.performanceReview.update({
      where: { id: review.id },
      data: {
        ...(selfAccomplishments !== undefined && { selfAccomplishments }),
        ...(selfWeaknesses !== undefined && { selfWeaknesses }),
        ...(finalRating !== undefined && finalRating !== null && { selfRating: finalRating }),
        ...(submit && {
          status: 'SUBMITTED',
          selfSubmittedAt: new Date(),
        }),
      },
      include: {
        cycle: true,
        scores: {
          include: {
            parameter: true,
          },
        },
      },
    });

    res.json(updated);
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
 */
export async function listAppraisals(req, res, next) {
  return getMyAllReviews(req, res, next);
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

    const role = req.user.role?.toUpperCase() || '';
    const isOwner = review.employeeId === req.user.id;
    const isManager = review.employee.managerId === req.user.id;
    const isElevated = ['HR', 'SUPER_ADMIN', 'CMD', 'ADMIN', 'OWNER', 'LEADERSHIP'].includes(role);

    if (!isOwner && !isManager && !isElevated) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to delete this appraisal record.' });
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
    const { id } = req.params;

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
      },
    });

    if (!review) {
      return res.status(404).json({ error: 'Performance review not found' });
    }

    const role = req.user.role?.toUpperCase() || '';
    const isOwner = review.employeeId === req.user.id;
    const isManager = review.employee.managerId === req.user.id;
    const isElevated = ['HR', 'SUPER_ADMIN', 'CMD', 'ADMIN', 'OWNER', 'LEADERSHIP'].includes(role);

    if (!isOwner && !isManager && !isElevated) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to update this review.' });
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
      if (selfAccomplishments !== undefined) dataToUpdate.selfAccomplishments = selfAccomplishments;
      if (selfWeaknesses !== undefined) dataToUpdate.selfWeaknesses = selfWeaknesses;
      if (selfRating !== undefined) dataToUpdate.selfRating = Number(selfRating);
    }

    if (isManager || isElevated) {
      if (managerRemarks !== undefined) dataToUpdate.managerRemarks = managerRemarks;
      if (managerRating !== undefined) dataToUpdate.managerRating = Number(managerRating);
    }

    if (isElevated) {
      if (hikePercentage !== undefined) dataToUpdate.hikePercentage = Number(hikePercentage);
      if (status !== undefined) dataToUpdate.status = status;
    } else if (status === 'DRAFT' || status === 'SUBMITTED') {
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

