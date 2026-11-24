import { prisma } from '../lib/prisma.js';
import { getIO } from '../lib/socket.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from './platformAudit.service.js';

/**
 * Parses user-agent header to extract device type, browser and OS.
 */
export function parseUserAgent(uaString = '') {
  if (!uaString || typeof uaString !== 'string') {
    return {
      device: 'Desktop',
      browser: 'Unknown Browser',
      os: 'Unknown OS',
      deviceSummary: 'Desktop · Unknown',
    };
  }

  const ua = uaString.toLowerCase();

  // 1. Detect Device
  let device = 'Desktop';
  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(ua)) {
    device = 'Mobile';
  } else if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) {
    device = 'Tablet';
  }

  // 2. Detect OS
  let os = 'Unknown OS';
  if (/windows nt 10\.0/i.test(ua)) os = 'Windows 10/11';
  else if (/windows nt 6\.3/i.test(ua)) os = 'Windows 8.1';
  else if (/windows nt 6\.1/i.test(ua)) os = 'Windows 7';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone os ([0-9_.]+)/i.test(ua)) {
    const v = ua.match(/iphone os ([0-9_.]+)/i)?.[1]?.replace(/_/g, '.') || '';
    os = v ? `iOS ${v}` : 'iOS';
  } else if (/ipad.*os ([0-9_.]+)/i.test(ua)) {
    const v = ua.match(/os ([0-9_.]+)/i)?.[1]?.replace(/_/g, '.') || '';
    os = v ? `iPadOS ${v}` : 'iPadOS';
  } else if (/mac os x ([0-9_.]+)/i.test(ua)) {
    const v = ua.match(/mac os x ([0-9_.]+)/i)?.[1]?.replace(/_/g, '.') || '';
    os = v ? `macOS ${v}` : 'macOS';
  } else if (/android ([0-9.]+)/i.test(ua)) {
    const v = ua.match(/android ([0-9.]+)/i)?.[1] || '';
    os = v ? `Android ${v}` : 'Android';
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
  }

  // 3. Detect Browser
  let browser = 'Unknown Browser';
  if (/edg\/([0-9.]+)/i.test(ua)) {
    browser = `Edge ${ua.match(/edg\/([0-9.]+)/i)?.[1]?.split('.')[0] || ''}`.trim();
  } else if (/opr\/([0-9.]+)|opera/i.test(ua)) {
    browser = 'Opera';
  } else if (/chrome\/([0-9.]+)/i.test(ua)) {
    browser = `Chrome ${ua.match(/chrome\/([0-9.]+)/i)?.[1]?.split('.')[0] || ''}`.trim();
  } else if (/firefox\/([0-9.]+)/i.test(ua)) {
    browser = `Firefox ${ua.match(/firefox\/([0-9.]+)/i)?.[1]?.split('.')[0] || ''}`.trim();
  } else if (/version\/([0-9.]+).*safari/i.test(ua)) {
    browser = 'Safari';
  } else if (/safari/i.test(ua)) {
    browser = 'Safari';
  }

  const deviceSummary = `${browser} on ${os} (${device})`;

  return { device, browser, os, deviceSummary };
}

/**
 * Extracts client IP address robustly from headers or socket.
 */
export function getClientIp(req) {
  if (!req) return '127.0.0.1';
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
}

/**
 * Records a new login session and history record upon successful login.
 */
export async function recordLoginSession({ user, req, loginType = 'PASSWORD' }) {
  if (!user || !user.id || !user.tenantId) return null;

  const ipAddress = getClientIp(req);
  const userAgentStr = req?.headers?.['user-agent'] || 'Unknown';
  const { device, browser, os, deviceSummary } = parseUserAgent(userAgentStr);

  const loginAt = new Date();
  const expiresAt = new Date(loginAt.getTime() + 24 * 60 * 60 * 1000); // 24 hours standard session

  // Create UserSession
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      tenantId: user.tenantId,
      ipAddress,
      userAgent: userAgentStr.slice(0, 500),
      device,
      browser,
      os,
      status: 'ACTIVE',
      loginAt,
      lastActiveAt: loginAt,
      expiresAt,
    },
  });

  // Create corresponding LoginHistory record
  const loginHistory = await prisma.loginHistory.create({
    data: {
      userId: user.id,
      tenantId: user.tenantId,
      sessionId: session.id,
      ipAddress,
      userAgent: userAgentStr.slice(0, 500),
      device,
      browser,
      os,
      status: 'SUCCESS',
      loginType,
      loginAt,
    },
  });

  // Update user with last login details
  await prisma.tenantUser.update({
    where: { id: user.id },
    data: {
      lastLoginAt: loginAt,
      activeSessionAt: loginAt,
      activeSessionIp: ipAddress,
      activeSessionDevice: deviceSummary.slice(0, 255),
    },
  }).catch((err) => console.warn('[SESSION] Stamping TenantUser failed:', err.message));

  return { session, loginHistory };
}

/**
 * Records logout event and finalizes session duration.
 */
export async function recordUserLogout({ userId, sessionId }) {
  const logoutAt = new Date();

  let targetSession = null;
  if (sessionId) {
    targetSession = await prisma.userSession.findUnique({ where: { id: sessionId } });
  } else if (userId) {
    targetSession = await prisma.userSession.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { loginAt: 'desc' },
    });
  }

  if (!targetSession) return null;

  const durationSeconds = Math.max(0, Math.floor((logoutAt.getTime() - new Date(targetSession.loginAt).getTime()) / 1000));

  const updatedSession = await prisma.userSession.update({
    where: { id: targetSession.id },
    data: {
      status: 'LOGGED_OUT',
      logoutAt,
      endedAt: logoutAt,
      endReason: 'USER_LOGOUT',
      durationSeconds,
    },
  });

  // Update corresponding login history
  await prisma.loginHistory.updateMany({
    where: { sessionId: targetSession.id },
    data: {
      logoutAt,
      durationSeconds,
    },
  });

  return updatedSession;
}

/**
 * Terminates an individual active session (Platform Owner action).
 */
export async function terminateSession({ sessionId, operator, req, reason = 'Terminated by Platform Owner' }) {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: { id: true, name: true, email: true, tenantId: true },
      },
    },
  });

  if (!session) {
    throw new Error('Session not found.');
  }

  const endedAt = new Date();
  const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - new Date(session.loginAt).getTime()) / 1000));

  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.userSession.update({
      where: { id: sessionId },
      data: {
        status: 'TERMINATED',
        endedAt,
        logoutAt: endedAt,
        endReason: reason,
        endedBy: operator?.name || operator?.email || 'Platform Owner',
        durationSeconds,
      },
    });

    await tx.loginHistory.updateMany({
      where: { sessionId },
      data: {
        logoutAt: endedAt,
        durationSeconds,
      },
    });

    // Record audit trail
    if (req) {
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.SESSION_TERMINATED || 'SESSION_TERMINATED',
        targetType: 'USER_SESSION',
        targetId: session.id,
        tenantId: session.tenantId,
        beforeValue: { status: session.status, userId: session.userId, userEmail: session.user?.email },
        afterValue: { status: 'TERMINATED', endedAt, reason, endedBy: operator?.name || 'Platform Owner', durationSeconds },
        reason: reason || 'Platform operator terminated active session',
      });
    }

    return s;
  });

  // Invalidate Socket.IO connection for this user
  try {
    const io = getIO();
    if (io) {
      io.in(`tenant:${session.tenantId}:user:${session.userId}`).disconnectSockets(true);
    }
  } catch (err) {
    console.warn('[SESSION] Socket disconnect failed:', err.message);
  }

  return updated;
}

/**
 * Blocks a user, terminating all their active sessions and preventing further login.
 */
export async function blockUser({ userId, operator, req, reason = 'Administrative block by Platform Owner' }) {
  const user = await prisma.tenantUser.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, tenantId: true, isBlocked: true },
  });

  if (!user) throw new Error('User not found.');
  if (user.isBlocked) throw new Error(`${user.name} is already blocked.`);

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    // 1. Mark user blocked
    const u = await tx.tenantUser.update({
      where: { id: userId },
      data: {
        isBlocked: true,
        blockedAt: now,
        blockedReason: reason,
        blockedBy: operator?.name || operator?.email || 'Platform Owner',
      },
      select: { id: true, name: true, email: true, isBlocked: true, blockedAt: true, blockedReason: true },
    });

    // 2. Terminate all active sessions for this user
    const activeSessions = await tx.userSession.findMany({
      where: { userId, status: 'ACTIVE' },
    });

    for (const s of activeSessions) {
      const dur = Math.max(0, Math.floor((now.getTime() - new Date(s.loginAt).getTime()) / 1000));
      await tx.userSession.update({
        where: { id: s.id },
        data: {
          status: 'TERMINATED',
          endedAt: now,
          logoutAt: now,
          endReason: `USER_BLOCKED: ${reason}`,
          endedBy: operator?.name || 'Platform Owner',
          durationSeconds: dur,
        },
      });

      await tx.loginHistory.updateMany({
        where: { sessionId: s.id },
        data: { logoutAt: now, durationSeconds: dur },
      });
    }

    // 3. Record audit trail
    if (req) {
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.USER_BLOCKED || 'USER_BLOCKED',
        targetType: 'USER',
        targetId: user.id,
        tenantId: user.tenantId,
        beforeValue: { isBlocked: false, email: user.email, name: user.name },
        afterValue: { isBlocked: true, blockedAt: now, reason, blockedBy: operator?.name || 'Platform Owner' },
        reason: reason || 'User blocked & sessions revoked by Platform Owner',
      });
    }

    return u;
  });

  // Force-disconnect all live sockets
  try {
    const io = getIO();
    if (io) {
      io.in(`tenant:${user.tenantId}:user:${user.id}`).disconnectSockets(true);
    }
  } catch (err) {
    console.warn('[SESSION] Socket disconnect on block failed:', err.message);
  }

  return updated;
}

/**
 * Unblocks a user, restoring account login capability.
 */
export async function unblockUser({ userId, operator, req, reason = 'Unblocked by Platform Owner' }) {
  const user = await prisma.tenantUser.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, tenantId: true, isBlocked: true },
  });

  if (!user) throw new Error('User not found.');
  if (!user.isBlocked) throw new Error(`${user.name} is not blocked.`);

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.tenantUser.update({
      where: { id: userId },
      data: {
        isBlocked: false,
        blockedAt: null,
        blockedReason: null,
        blockedBy: null,
      },
      select: { id: true, name: true, email: true, isBlocked: true },
    });

    if (req) {
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.USER_UNBLOCKED || 'USER_UNBLOCKED',
        targetType: 'USER',
        targetId: user.id,
        tenantId: user.tenantId,
        beforeValue: { isBlocked: true, email: user.email },
        afterValue: { isBlocked: false, unblockedBy: operator?.name || 'Platform Owner' },
        reason: reason || 'User unblocked by Platform Owner',
      });
    }

    return u;
  });

  return updated;
}

/**
 * Formats duration in seconds to human-readable format e.g. "2h 45m" or "18m 10s".
 */
export function formatDuration(seconds = 0) {
  if (!seconds || seconds <= 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Formats total hours float e.g. 14.52 hrs.
 */
export function formatTotalHours(seconds = 0) {
  if (!seconds || seconds <= 0) return '0.0 hrs';
  const hours = seconds / 3600;
  return `${hours.toFixed(1)} hrs`;
}

/**
 * Retrieves the paginated login history & usage summary for Platform Owner.
 */
export async function getLoginHistoryListing({
  page = 1,
  limit = 20,
  fromDate,
  toDate,
  companyId,
  userId,
  search,
  sortBy = 'lastLoginAt',
  sortOrder = 'desc',
}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (p - 1) * lim;

  // Build TenantUser filter
  const userWhere = {
    isDeleted: false,
  };

  if (companyId) {
    userWhere.tenantId = companyId;
  }

  if (userId) {
    userWhere.id = userId;
  }

  if (search && search.trim()) {
    const s = search.trim();
    userWhere.OR = [
      { name: { contains: s, mode: 'insensitive' } },
      { email: { contains: s, mode: 'insensitive' } },
      { designation: { contains: s, mode: 'insensitive' } },
      { tenant: { companyName: { contains: s, mode: 'insensitive' } } },
    ];
  }

  // Date range filter: if supplied, filter to users who have sessions within range
  const sessionDateFilter = {};
  if (fromDate) {
    const start = new Date(fromDate);
    start.setHours(0, 0, 0, 0);
    sessionDateFilter.gte = start;
  }
  if (toDate) {
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    sessionDateFilter.lte = end;
  }

  if (fromDate || toDate) {
    userWhere.sessions = {
      some: {
        loginAt: sessionDateFilter,
      },
    };
  }

  const [totalCount, users] = await Promise.all([
    prisma.tenantUser.count({ where: userWhere }),
    prisma.tenantUser.findMany({
      where: userWhere,
      include: {
        tenant: {
          select: { id: true, companyName: true, tenantCode: true },
        },
        sessions: {
          orderBy: { loginAt: 'desc' },
          take: 200, // sample recent sessions for aggregation
        },
        _count: {
          select: {
            sessions: true,
            loginHistories: true,
          },
        },
      },
      skip,
      take: lim,
      orderBy: sortBy === 'name' ? { name: sortOrder } : { lastLoginAt: sortOrder },
    }),
  ]);

  const now = Date.now();

  const rows = users.map((u) => {
    const allSessions = u.sessions || [];
    const totalLoginCount = u._count.sessions || u._count.loginHistories || (u.lastLoginAt ? 1 : 0);

    // Active session
    const activeSession = allSessions.find(
      (s) => s.status === 'ACTIVE' && new Date(s.expiresAt).getTime() > now
    );

    // Most recent session
    const lastSession = allSessions[0] || null;

    // Calculate last login duration
    let lastLoginDurationStr = '—';
    let isCurrentlyActive = false;
    let activeSessionId = null;

    if (activeSession) {
      isCurrentlyActive = true;
      activeSessionId = activeSession.id;
      const elapsedSec = Math.max(0, Math.floor((now - new Date(activeSession.loginAt).getTime()) / 1000));
      lastLoginDurationStr = `${formatDuration(elapsedSec)} (Active)`;
    } else if (lastSession) {
      if (lastSession.durationSeconds > 0) {
        lastLoginDurationStr = formatDuration(lastSession.durationSeconds);
      } else if (lastSession.endedAt) {
        const sec = Math.max(0, Math.floor((new Date(lastSession.endedAt).getTime() - new Date(lastSession.loginAt).getTime()) / 1000));
        lastLoginDurationStr = formatDuration(sec);
      } else {
        lastLoginDurationStr = '—';
      }
    }

    // Cumulative total seconds
    let totalSeconds = 0;
    for (const s of allSessions) {
      if (s.status === 'ACTIVE' && new Date(s.expiresAt).getTime() > now) {
        totalSeconds += Math.max(0, Math.floor((now - new Date(s.loginAt).getTime()) / 1000));
      } else if (s.durationSeconds > 0) {
        totalSeconds += s.durationSeconds;
      } else if (s.endedAt) {
        totalSeconds += Math.max(0, Math.floor((new Date(s.endedAt).getTime() - new Date(s.loginAt).getTime()) / 1000));
      }
    }

    const ipAddress = activeSession?.ipAddress || lastSession?.ipAddress || u.activeSessionIp || '—';
    const lastLoginTime = activeSession?.loginAt || lastSession?.loginAt || u.lastLoginAt || null;

    return {
      userId: u.id,
      companyId: u.tenantId,
      companyName: u.tenant?.companyName || '—',
      companyCode: u.tenant?.tenantCode || '—',
      userName: u.name,
      userEmail: u.email,
      designation: u.designation || u.role || '—',
      role: u.role,
      totalLogins: totalLoginCount,
      lastLoginAt: lastLoginTime,
      lastLoginDuration: lastLoginDurationStr,
      ipAddress,
      device: activeSession?.device || lastSession?.device || u.activeSessionDevice || '—',
      lastPasswordChange: u.passwordChangedAt || null,
      totalSeconds,
      totalHoursLoginTime: formatTotalHours(totalSeconds),
      totalHoursRaw: (totalSeconds / 3600).toFixed(2),
      isBlocked: Boolean(u.isBlocked),
      blockedAt: u.blockedAt || null,
      blockedReason: u.blockedReason || null,
      isCurrentlyActive,
      activeSessionId,
    };
  });

  return {
    rows,
    pagination: {
      page: p,
      limit: lim,
      total: totalCount,
      totalPages: Math.ceil(totalCount / lim) || 1,
    },
  };
}

/**
 * Detailed session breakdown for a specific user.
 */
export async function getUserSessionsBreakdown({ userId, page = 1, limit = 50 }) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (p - 1) * lim;

  const user = await prisma.tenantUser.findUnique({
    where: { id: userId },
    include: {
      tenant: { select: { id: true, companyName: true } },
    },
  });

  if (!user) throw new Error('User not found.');

  const [totalSessions, sessions] = await Promise.all([
    prisma.userSession.count({ where: { userId } }),
    prisma.userSession.findMany({
      where: { userId },
      orderBy: { loginAt: 'desc' },
      skip,
      take: lim,
    }),
  ]);

  const now = Date.now();

  const formattedSessions = sessions.map((s) => {
    const isLive = s.status === 'ACTIVE' && new Date(s.expiresAt).getTime() > now;
    let durationSec = s.durationSeconds;
    if (isLive) {
      durationSec = Math.max(0, Math.floor((now - new Date(s.loginAt).getTime()) / 1000));
    }

    let displayStatus = s.status;
    if (s.status === 'ACTIVE' && new Date(s.expiresAt).getTime() <= now) {
      displayStatus = 'EXPIRED';
    }

    return {
      id: s.id,
      sessionId: s.id,
      ipAddress: s.ipAddress || '—',
      device: s.device || 'Desktop',
      browser: s.browser || '—',
      os: s.os || '—',
      userAgent: s.userAgent || '—',
      status: displayStatus,
      isLive,
      loginAt: s.loginAt,
      logoutAt: s.logoutAt || s.endedAt,
      endedAt: s.endedAt,
      endReason: s.endReason || '—',
      endedBy: s.endedBy || '—',
      durationSeconds: durationSec,
      durationFormatted: formatDuration(durationSec),
    };
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      designation: user.designation || user.role,
      companyName: user.tenant?.companyName,
      isBlocked: user.isBlocked,
      blockedAt: user.blockedAt,
      blockedReason: user.blockedReason,
      passwordChangedAt: user.passwordChangedAt,
    },
    sessions: formattedSessions,
    pagination: {
      page: p,
      limit: lim,
      total: totalSessions,
      totalPages: Math.ceil(totalSessions / lim) || 1,
    },
  };
}
