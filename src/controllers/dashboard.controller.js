import { prisma } from '../lib/prisma.js';
import { buildTeamScopeWhere } from '../services/teamScope.service.js';
import { computeCycleRollup, computeGoalStats } from '../services/reportAggregation.service.js';
import { ELEVATED_ROLES, hasRole } from '../lib/roles.js';

/**
 * GET /api/dashboard/super-admin
 * Platform Command Center data — strictly accessible only by SUPER_ADMIN.
 */
export async function getSuperAdminDashboardData(req, res, next) {
  try {
    const [totalTenants, totalUsers, totalRegistrations] = await Promise.all([
      prisma.tenant.count(),
      prisma.tenantUser.count({ where: { isDeleted: false } }),
      prisma.companyRegistration.count().catch(() => 0),
    ]);

    const activeTenants = await prisma.tenant.findMany({
      select: {
        id: true,
        companyName: true,
        domainName: true,
        licenseLimit: true,
        createdAt: true,
        _count: {
          select: { users: { where: { isDeleted: false, status: 'ACTIVE' } } },
        },
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      dashboard: 'SUPER_ADMIN',
      totalTenants,
      totalUsers,
      totalRegistrations,
      recentTenants: activeTenants.map((t) => ({
        id: t.id,
        name: t.companyName,
        domain: t.domainName,
        licenseLimit: t.licenseLimit,
        activeUsers: t._count.users,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/dashboard/admin
 * Organization Administrator overview — accessible by SUPER_ADMIN and ADMIN.
 * Strictly scoped to req.tenantId.
 */
export async function getAdminDashboardData(req, res, next) {
  try {
    const tenantId = req.tenantId;

    const [totalHeadcount, activeCycle, activeUsers] = await Promise.all([
      prisma.tenantUser.count({
        where: { tenantId, isDeleted: false, status: 'ACTIVE' },
      }),
      prisma.appraisalCycle.findFirst({
        where: { tenantId, status: 'ACTIVE' },
        include: { parameters: { select: { id: true, name: true, weight: true } } },
      }),
      prisma.tenantUser.findMany({
        where: { tenantId, isDeleted: false, status: 'ACTIVE' },
        select: { id: true, name: true, role: true, department: true, designation: true },
        take: 20,
        orderBy: { name: 'asc' },
      }),
    ]);

    res.json({
      dashboard: 'ADMIN',
      tenantId,
      totalHeadcount,
      activeCycle: activeCycle
        ? {
            id: activeCycle.id,
            name: activeCycle.name,
            frequency: activeCycle.frequency,
            startDate: activeCycle.startDate,
            endDate: activeCycle.endDate,
            parameterCount: activeCycle.parameters.length,
          }
        : null,
      activeUsers,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/dashboard/hr
 * HR workforce & appraisal cycle overview — accessible by SUPER_ADMIN, ADMIN, HR.
 * Strictly scoped to req.tenantId.
 */
export async function getHrDashboardData(req, res, next) {
  try {
    const tenantId = req.tenantId;

    const [totalEmployees, activeCycle, departmentGroups] = await Promise.all([
      prisma.tenantUser.count({
        where: { tenantId, isDeleted: false, status: { in: ['ACTIVE', 'INVITED'] } },
      }),
      prisma.appraisalCycle.findFirst({
        where: { tenantId, status: 'ACTIVE' },
      }),
      prisma.tenantUser.groupBy({
        by: ['department'],
        where: { tenantId, isDeleted: false, status: 'ACTIVE' },
        _count: { id: true },
      }),
    ]);

    let reviewsSummary = null;
    if (activeCycle) {
      const [completedReviews, totalReviews] = await Promise.all([
        prisma.performanceReview.count({
          where: { cycleId: activeCycle.id, status: 'COMPLETED' },
        }),
        prisma.performanceReview.count({
          where: { cycleId: activeCycle.id },
        }),
      ]);
      reviewsSummary = {
        totalReviews,
        completedReviews,
        pendingReviews: Math.max(0, totalReviews - completedReviews),
        completionRate: totalReviews > 0 ? Math.round((completedReviews / totalReviews) * 100) : 0,
      };
    }

    res.json({
      dashboard: 'HR',
      tenantId,
      totalEmployees,
      activeCycle: activeCycle ? { id: activeCycle.id, name: activeCycle.name } : null,
      reviewsSummary,
      departmentBreakdown: departmentGroups.map((d) => ({
        department: d.department || 'General',
        headcount: d._count.id,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/dashboard/finance
 * Finance licensing & subscription overview — accessible by SUPER_ADMIN, ADMIN, HR, FINANCE.
 * Strictly scoped to req.tenantId.
 */
export async function getFinanceDashboardData(req, res, next) {
  try {
    const tenantId = req.tenantId;

    const [tenant, activeSeats] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { companyName: true, licenseLimit: true },
      }),
      prisma.tenantUser.count({
        where: { tenantId, isDeleted: false, status: 'ACTIVE' },
      }),
    ]);

    const licenseLimit = tenant?.licenseLimit || 50;
    const utilizationRate = licenseLimit > 0 ? Math.round((activeSeats / licenseLimit) * 100) : 0;
    const seatsRemaining = Math.max(0, licenseLimit - activeSeats);

    res.json({
      dashboard: 'FINANCE',
      tenantId,
      companyName: tenant?.companyName || 'Enterprise',
      licenseLimit,
      activeSeats,
      seatsRemaining,
      utilizationRate,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/dashboard/manager
 * Manager team overview & direct reports — accessible by SUPER_ADMIN, ADMIN, HR, FINANCE, MANAGER.
 * Strictly scoped to req.tenantId.
 */
export async function getManagerDashboardData(req, res, next) {
  try {
    const { where } = buildTeamScopeWhere(req.user, req.tenantId);

    const directReports = await prisma.tenantUser.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        designation: true,
        role: true,
        status: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      dashboard: 'MANAGER',
      tenantId: req.tenantId,
      totalDirectReports: directReports.length,
      directReports,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/dashboard/employee
 * Employee personal headquarters — accessible by all authenticated roles.
 * Strictly scoped to req.user.id and req.tenantId.
 */
export async function getEmployeeDashboardData(req, res, next) {
  try {
    const userId = req.user.id;
    const tenantId = req.tenantId;

    const [myGoalsCount, myTasksCount, latestReview] = await Promise.all([
      prisma.goal.count({
        where: { employeeId: userId },
      }).catch(() => 0),
      prisma.task.count({
        where: { tenantId, employeeId: userId },
      }).catch(() => 0),
      prisma.performanceReview.findFirst({
        where: { employeeId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          averageSelfScore: true,
          averageManagerScore: true,
          cycle: { select: { id: true, name: true } },
        },
      }).catch(() => null),
    ]);

    res.json({
      dashboard: 'EMPLOYEE',
      user: {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role,
      },
      myGoalsCount,
      myTasksCount,
      latestReview,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/summary
// ─────────────────────────────────────────────────────────────────────────────

/** "Nihar Ranjan Rout" -> "NR". Matches the initials the Hub already renders. */
function initialsOf(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * How many days away a stored birthday is, or null if outside the next week.
 *
 * hubBirthday is free text in the format the Company Hub saves, e.g.
 * "September 13 1990" (the year is optional), so it is parsed rather than
 * compared as a date.
 */
function matchBirthdayWindow(hubBirthday, now, windowDays = 7) {
  const parts = String(hubBirthday || '').trim().split(/\s+/);
  const monthIdx = MONTHS.indexOf((parts[0] || '').toLowerCase());
  const day = Number(parts[1]);
  if (monthIdx < 0 || !Number.isInteger(day) || day < 1 || day > 31) return null;

  // Compare against this year's occurrence, rolling into next year in late December.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), monthIdx, day);
  if (next < today) next = new Date(now.getFullYear() + 1, monthIdx, day);
  const days = Math.round((next - today) / 864e5);
  return days <= windowDays ? days : null;
}

/**
 * Everything the Common Dashboard (/uer/dashboard) renders, in one request.
 *
 * That page previously ran entirely on src/data/mockData.js — invented goals,
 * tasks, ratings and team members, plus literals hardcoded in the JSX such as a
 * "4.2" rating and a birthday for a person who does not exist. This replaces
 * all of it with real tenant data.
 *
 * SCOPING IS THE LOAD-BEARING PART. The page is shared by every corporate role,
 * so the audience is resolved first and every query below is filtered by it:
 *
 *   SELF   - employees (and student/mentor): their own goals, tasks, reviews.
 *   TEAM   - managers: themselves plus their direct reports.
 *   TENANT - SUPER_ADMIN / ADMIN / CMD / HR: the whole company.
 *
 * An employee must never see tenant-wide figures through this endpoint, so the
 * permitted employee-id list is computed once and reused for every aggregate.
 */
export async function getDashboardSummary(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const viewerId = req.user.id;
    const role = String(req.user.role || '').toUpperCase();

    const isTenantWide = hasRole(role, ELEVATED_ROLES);
    const audience = isTenantWide ? 'TENANT' : role === 'MANAGER' ? 'TEAM' : 'SELF';

    // null means "every employee in the tenant"; an array narrows every query.
    let scopeIds = null;
    if (audience === 'SELF') {
      scopeIds = [viewerId];
    } else if (audience === 'TEAM') {
      // Reuse the Team directory predicate so "my team" means the same thing
      // on both screens rather than being defined twice.
      const { where } = buildTeamScopeWhere(req.user, tenantId, { includeSelf: true });
      const reports = await prisma.tenantUser.findMany({ where, select: { id: true } });
      scopeIds = [...new Set([viewerId, ...reports.map((r) => r.id)])];
    }
    const userFilter = scopeIds ? { in: scopeIds } : undefined;

    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 864e5);
    const quarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0, 23, 59, 59);

    // ── Goals ──────────────────────────────────────────────────────────────
    const goalWhere = scopeIds
      ? { tenantId, assignments: { some: { employeeId: { in: scopeIds } } } }
      : { tenantId };

    const [goalStats, dueThisQuarter, goalRows] = await Promise.all([
      computeGoalStats(goalWhere),
      prisma.goal.count({
        where: { ...goalWhere, targetDate: { gte: now, lte: quarterEnd }, status: { not: 'COMPLETED' } },
      }),
      prisma.goal.findMany({ where: goalWhere, select: { status: true, targetDate: true } }),
    ]);

    // On track = completed, or not yet past its target date. Derived, not guessed.
    const onTrack = goalRows.filter(
      (g) => String(g.status).toUpperCase() === 'COMPLETED' || !g.targetDate || g.targetDate >= now,
    ).length;

    // ── Tasks ──────────────────────────────────────────────────────────────
    // Tasks marked private belong to their owner alone, so an aggregate shown to
    // a manager or HR must exclude everyone else's. The viewer's own private
    // tasks still count towards their own numbers.
    const taskWhere = {
      tenantId,
      ...(userFilter ? { employeeId: userFilter } : {}),
      ...(audience === 'SELF'
        ? {}
        : { OR: [{ isPrivate: false }, { employeeId: viewerId }] }),
    };
    const [taskTotal, taskDone, highPriority, dueThisWeek] = await Promise.all([
      prisma.task.count({ where: taskWhere }),
      prisma.task.count({ where: { ...taskWhere, status: 'done' } }),
      prisma.task.count({
        where: { ...taskWhere, status: { not: 'done' }, priority: { in: ['high', 'critical'] } },
      }),
      prisma.task.count({
        where: { ...taskWhere, status: { not: 'done' }, dueDate: { gte: now, lte: weekAhead } },
      }),
    ]);

    // ── The viewer's own latest rated review ───────────────────────────────
    // Never defaulted to a number: no rated review means null, which the UI
    // renders as an em dash instead of inventing a score.
    const latestRated = await prisma.performanceReview.findFirst({
      where: {
        employeeId: viewerId,
        cycle: { tenantId },
        OR: [{ managerRating: { not: null } }, { selfRating: { not: null } }],
      },
      orderBy: { updatedAt: 'desc' },
      select: { managerRating: true, selfRating: true },
    });
    const rating = latestRated ? Number(latestRated.managerRating ?? latestRated.selfRating) : null;

    // ── Rating trajectory ──────────────────────────────────────────────────
    // Only cycles that actually carry ratings contribute a point, matching the
    // rule in /reports/trend so the two screens never disagree.
    const cycles = await prisma.appraisalCycle.findMany({
      where: { tenantId },
      orderBy: { startDate: 'desc' },
      take: 8,
      select: { id: true, name: true },
    });

    // Pick the cycles that actually CARRY ratings, rather than the most recent
    // ones and hoping they do. Cycles are ordered by startDate, and a tenant can
    // hold far-future or empty cycles that would otherwise crowd out the only
    // cycle with data and leave the chart blank.
    const ratedCycleRows = await prisma.performanceReview.findMany({
      where: {
        cycle: { tenantId },
        ...(userFilter ? { employeeId: userFilter } : {}),
        OR: [{ managerRating: { not: null } }, { selfRating: { not: null } }],
      },
      select: { cycleId: true },
      distinct: ['cycleId'],
    });
    const trendCycles = ratedCycleRows.length
      ? await prisma.appraisalCycle.findMany({
          where: { tenantId, id: { in: ratedCycleRows.map((r) => r.cycleId) } },
          orderBy: { startDate: 'desc' },
          take: 8,
          select: { id: true, name: true },
        })
      : [];

    const trend = [];
    for (const c of trendCycles.slice().reverse()) {
      const reviews = await prisma.performanceReview.findMany({
        where: {
          cycleId: c.id,
          ...(userFilter ? { employeeId: userFilter } : {}),
          OR: [{ managerRating: { not: null } }, { selfRating: { not: null } }],
        },
        select: { managerRating: true, selfRating: true },
      });
      if (reviews.length === 0) continue;
      const mean = (key) => {
        const vals = reviews.map((r) => r[key]).filter((v) => v != null).map(Number);
        return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : null;
      };
      // `quarter` is the key the page's existing recharts XAxis already reads.
      trend.push({
        quarter: c.name,
        label: c.name,
        avgSelfScore: mean('selfRating'),
        avgManagerScore: mean('managerRating'),
      });
    }

    // ── Attention Required: policies genuinely awaiting this viewer ────────
    const pendingPolicies = await prisma.policyAssignment.findMany({
      where: { tenantId, userId: viewerId, status: 'PENDING' },
      orderBy: { assignedAt: 'desc' },
      take: 3,
      select: { dueAt: true, policy: { select: { id: true, title: true, status: true } } },
    });
    const attention = pendingPolicies
      .filter((a) => a.policy && a.policy.status === 'PUBLISHED')
      .map((a) => ({ type: 'POLICY', id: a.policy.id, title: a.policy.title, dueAt: a.dueAt }));

    // ── Hub highlights: real birthdays and events ──────────────────────────
    const hubPeople = await prisma.tenantUser.findMany({
      where: { tenantId, isDeleted: false, status: 'ACTIVE', hubBirthday: { not: null } },
      select: { id: true, name: true, hubBirthday: true },
    });
    const birthdays = hubPeople
      .map((u) => ({ u, days: matchBirthdayWindow(u.hubBirthday, now) }))
      .filter((x) => x.days !== null)
      .sort((a, b) => a.days - b.days)
      .slice(0, 3)
      .map((x) => ({ id: x.u.id, name: x.u.name, date: x.u.hubBirthday, daysAway: x.days }));

    let events = [];
    try {
      events = await prisma.$queryRawUnsafe(
        'SELECT "id", "title", "startsAt" FROM "hub_events" WHERE "tenantId" = $1 AND "startsAt" >= $2 ORDER BY "startsAt" ASC LIMIT 3',
        tenantId,
        now,
      );
    } catch {
      // hub_events is created lazily by the Hub module. An absent table is not
      // an error here — it just means there is nothing to show yet.
      events = [];
    }

    // ── Team list + department performance (TEAM / TENANT only) ────────────
    let team = [];
    let departments = [];
    if (audience !== 'SELF') {
      const { where } = buildTeamScopeWhere(req.user, tenantId, { includeSelf: true });
      const members = await prisma.tenantUser.findMany({
        where,
        select: { id: true, name: true, designation: true, department: true },
        orderBy: { name: 'asc' },
        take: 25,
      });

      team = await Promise.all(members.map(async (m) => {
        const [assignments, review] = await Promise.all([
          prisma.goalAssignment.findMany({
            where: { tenantId, employeeId: m.id },
            select: { status: true },
          }),
          prisma.performanceReview.findFirst({
            where: {
              employeeId: m.id,
              cycle: { tenantId },
              OR: [{ managerRating: { not: null } }, { selfRating: { not: null } }],
            },
            orderBy: { updatedAt: 'desc' },
            select: { managerRating: true, selfRating: true },
          }),
        ]);
        return {
          id: m.id,
          name: m.name,
          initials: initialsOf(m.name),
          designation: m.designation || '',
          department: m.department || 'Unassigned',
          rating: review ? Number(review.managerRating ?? review.selfRating) : null,
          goalsTotal: assignments.length,
          goalsCompleted: assignments.filter((a) => String(a.status).toUpperCase() === 'COMPLETED').length,
        };
      }));

      // Department chart comes from the newest cycle that has reviews, reusing
      // the Reports rollup so both screens show identical numbers.
      for (const c of cycles) {
        const rollup = await computeCycleRollup({ tenantId, cycleId: c.id });
        if (rollup.totalReviews === 0) continue;
        departments = rollup.departmentBreakdown.map((d) => ({
          dept: d.department,
          score: d.avgManagerScore ?? d.avgSelfScore ?? 0,
          employees: d.headcount ?? d.total ?? 0,
          completionRate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
        }));
        break;
      }
    }

    res.json({
      audience,
      hero: {
        rating,
        ratingSource: latestRated ? (latestRated.managerRating != null ? 'manager' : 'self') : null,
        goalSync: goalStats.averageGoalProgress,
      },
      goals: {
        total: goalStats.totalGoals,
        completed: goalStats.completedGoals,
        averageProgress: goalStats.averageGoalProgress,
        completionRate: goalStats.goalCompletionRate,
        dueThisQuarter,
        onTrack,
        behind: Math.max(0, goalStats.totalGoals - onTrack),
      },
      tasks: {
        total: taskTotal,
        done: taskDone,
        percent: taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0,
        highPriority,
        dueThisWeek,
      },
      trend,
      attention,
      hub: { birthdays, events },
      team,
      departments,
    });
  } catch (err) {
    next(err);
  }
}
