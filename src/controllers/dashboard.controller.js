import { prisma } from '../lib/prisma.js';
import { buildTeamScopeWhere } from '../services/teamScope.service.js';

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
