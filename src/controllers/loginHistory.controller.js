import { prisma } from '../lib/prisma.js';
import {
  getLoginHistoryListing,
  getUserSessionsBreakdown,
  terminateSession,
  blockUser,
  unblockUser,
} from '../services/sessionTracking.service.js';
import {
  getServerAndDbMetrics,
  getLoginAnalyticsMatrix,
} from '../services/serverMonitoring.service.js';

/**
 * Returns real-time server load, memory, database and concurrent session metrics.
 */
export async function getLiveMonitoringMetrics(req, res, next) {
  try {
    const { companyId } = req.query;
    const metrics = await getServerAndDbMetrics({ companyId });
    res.json(metrics);
  } catch (err) {
    next(err);
  }
}

/**
 * Returns peak usage matrix, hourly/daily activity, and trend analytics.
 */
export async function getLoginAnalytics(req, res, next) {
  try {
    const { range = '7d', fromDate, toDate, companyId, userId } = req.query;
    const analytics = await getLoginAnalyticsMatrix({
      range,
      fromDate,
      toDate,
      companyId,
      userId,
    });
    res.json(analytics);
  } catch (err) {
    next(err);
  }
}

/**
 * Lists login history and usage summary for Platform Owner.
 */
export async function getLoginHistory(req, res, next) {
  try {
    const {
      page = 1,
      limit = 20,
      fromDate,
      toDate,
      companyId,
      userId,
      search,
      sortBy,
      sortOrder,
    } = req.query;

    const result = await getLoginHistoryListing({
      page,
      limit,
      fromDate,
      toDate,
      companyId,
      userId,
      search,
      sortBy,
      sortOrder,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Returns companies list for searchable filter dropdown.
 */
export async function getLoginHistoryCompanies(req, res, next) {
  try {
    const companies = await prisma.tenant.findMany({
      where: {
        isPlatform: false,
      },
      select: {
        id: true,
        companyName: true,
        tenantCode: true,
      },
      orderBy: {
        companyName: 'asc',
      },
    });

    res.json({ companies });
  } catch (err) {
    next(err);
  }
}

/**
 * Returns users list for searchable filter dropdown, dependent on selected company.
 */
export async function getLoginHistoryUsers(req, res, next) {
  try {
    const { companyId } = req.query;

    const where = { isDeleted: false };
    if (companyId) {
      where.tenantId = companyId;
    }

    const users = await prisma.tenantUser.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        designation: true,
        tenantId: true,
        tenant: {
          select: {
            companyName: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
      take: 200,
    });

    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        designation: u.designation || '—',
        companyId: u.tenantId,
        companyName: u.tenant?.companyName || '—',
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Returns complete session and device history for a single user (details popup).
 */
export async function getUserSessionsDetail(req, res, next) {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const result = await getUserSessionsBreakdown({
      userId,
      page,
      limit,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Ends an individual active session immediately.
 */
export async function terminateUserSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { reason } = req.body || {};

    const updated = await terminateSession({
      sessionId,
      operator: req.user,
      req,
      reason: reason || 'Terminated by Platform Owner',
    });

    res.json({
      success: true,
      message: 'Active session terminated successfully.',
      session: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Blocks a user, immediately revoking active sessions and preventing further login.
 */
export async function blockPlatformUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { reason } = req.body || {};

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Please provide a reason for blocking the user.' });
    }

    const updated = await blockUser({
      userId,
      operator: req.user,
      req,
      reason: reason.trim(),
    });

    res.json({
      success: true,
      message: `${updated.name} has been blocked and all active sessions have been terminated.`,
      user: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Unblocks a user, restoring account login capability.
 */
export async function unblockPlatformUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { reason } = req.body || {};

    const updated = await unblockUser({
      userId,
      operator: req.user,
      req,
      reason: reason || 'Account unblocked by Platform Owner',
    });

    res.json({
      success: true,
      message: `${updated.name} has been unblocked successfully.`,
      user: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Exports login history & usage summary as CSV respecting active filters.
 */
export async function exportLoginHistoryCsv(req, res, next) {
  try {
    const {
      fromDate,
      toDate,
      companyId,
      userId,
      search,
    } = req.query;

    // Fetch up to 5,000 matching rows
    const { rows } = await getLoginHistoryListing({
      page: 1,
      limit: 5000,
      fromDate,
      toDate,
      companyId,
      userId,
      search,
    });

    const csvHeaders = [
      'Company Name',
      'User Name',
      'User Email',
      'Designation',
      'Total Login Count',
      'Last Login Date & Time',
      'Last Login Duration',
      'IP Address',
      'Last Password Change',
      'Total Hours Login Time',
      'Account Status',
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    const csvLines = [csvHeaders.join(',')];

    for (const r of rows) {
      const line = [
        escapeCsv(r.companyName),
        escapeCsv(r.userName),
        escapeCsv(r.userEmail),
        escapeCsv(r.designation),
        escapeCsv(r.totalLogins),
        escapeCsv(r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString('en-IN') : '—'),
        escapeCsv(r.lastLoginDuration),
        escapeCsv(r.ipAddress),
        escapeCsv(r.lastPasswordChange ? new Date(r.lastPasswordChange).toLocaleString('en-IN') : 'Never / Initial'),
        escapeCsv(r.totalHoursLoginTime),
        escapeCsv(r.isBlocked ? 'BLOCKED' : r.isCurrentlyActive ? 'ACTIVE SESSION' : 'INACTIVE'),
      ];
      csvLines.push(line.join(','));
    }

    const csvContent = csvLines.join('\r\n');
    const filename = `login-history-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
}
