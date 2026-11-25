import os from 'node:os';
import { prisma } from '../lib/prisma.js';
import { getIO } from '../lib/socket.js';

// In-memory concurrency tracking
let peakConcurrentUsersToday = 0;
let peakDateStr = new Date().toISOString().slice(0, 10);

// Active socket connection registry: socketId -> { userId, tenantId, role, connectedAt, lastPing }
const connectedSockets = new Map();
// User to active sockets set: userId -> Set of socketIds
const userSockets = new Map();

// CPU measurement helper
let prevCpuTimes = getCpuTimes();

function getCpuTimes() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times)) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

/**
 * Calculates current CPU usage percentage across all cores.
 */
export function getCpuUsagePercent() {
  const current = getCpuTimes();
  const idleDiff = current.idle - prevCpuTimes.idle;
  const totalDiff = current.total - prevCpuTimes.total;
  prevCpuTimes = current;

  if (totalDiff <= 0) return 0;
  const usage = 100 - (100 * idleDiff) / totalDiff;
  return Math.min(100, Math.max(0, Math.round(usage * 10) / 10));
}

/**
 * Registers an active socket connection.
 */
export function registerSocketConnection(socket) {
  if (!socket || !socket.id || !socket.user) return;
  const { userId, tenantId, role } = socket.user;

  connectedSockets.set(socket.id, {
    socketId: socket.id,
    userId,
    tenantId,
    role,
    connectedAt: new Date(),
    lastPing: Date.now(),
  });

  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socket.id);

  updatePeakConcurrency();
}

/**
 * Unregisters a disconnected socket.
 */
export function unregisterSocketConnection(socketId) {
  const record = connectedSockets.get(socketId);
  if (record) {
    connectedSockets.delete(socketId);
    const set = userSockets.get(record.userId);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) {
        userSockets.delete(record.userId);
      }
    }
  }
}

/**
 * Heartbeat update for a socket.
 */
export function touchSocketHeartbeat(socketId) {
  const record = connectedSockets.get(socketId);
  if (record) {
    record.lastPing = Date.now();
  }
}

/**
 * Updates peak concurrency tracking for today.
 */
function updatePeakConcurrency() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== peakDateStr) {
    peakDateStr = today;
    peakConcurrentUsersToday = userSockets.size;
  } else {
    if (userSockets.size > peakConcurrentUsersToday) {
      peakConcurrentUsersToday = userSockets.size;
    }
  }
}

/**
 * Cleans up expired sessions in the database to prevent stale active counts.
 */
export async function reconcileExpiredSessions() {
  try {
    const now = new Date();
    await prisma.userSession.updateMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lte: now },
      },
      data: {
        status: 'EXPIRED',
        endedAt: now,
        endReason: 'SESSION_TIMEOUT',
      },
    });
  } catch (err) {
    console.warn('[MONITORING] reconcileExpiredSessions warning:', err.message);
  }
}

/**
 * Fetches real server, memory, database, and concurrency metrics.
 */
export async function getServerAndDbMetrics({ companyId } = {}) {
  await reconcileExpiredSessions();

  const now = new Date();
  const cpus = os.cpus() || [];
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const usedRam = totalRam - freeRam;
  const ramPercent = Math.round((usedRam / totalRam) * 100);
  const cpuPercent = getCpuUsagePercent();

  // Query PostgreSQL connection stats
  let dbActiveConnections = 1;
  let dbMaxConnections = 100;
  let dbLatencyMs = 0;

  try {
    const t0 = Date.now();
    const [activeRes, maxRes] = await Promise.all([
      prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM pg_stat_activity WHERE state IS NOT NULL'),
      prisma.$queryRawUnsafe('SHOW max_connections'),
    ]);
    dbLatencyMs = Date.now() - t0;
    if (activeRes && activeRes[0]) dbActiveConnections = Number(activeRes[0].count);
    if (maxRes && maxRes[0]) dbMaxConnections = parseInt(maxRes[0].max_connections, 10) || 100;
  } catch (err) {
    console.warn('[MONITORING] DB connection query fallback:', err.message);
  }

  // Active Sessions & Users Query
  const sessionWhere = {
    status: 'ACTIVE',
    expiresAt: { gt: now },
  };

  if (companyId) {
    sessionWhere.tenantId = companyId;
  }

  const [activeSessionsCount, activeUsersList] = await Promise.all([
    prisma.userSession.count({ where: sessionWhere }),
    prisma.userSession.findMany({
      where: sessionWhere,
      distinct: ['userId'],
      select: { userId: true, tenantId: true },
    }),
  ]);

  const activeUsersCount = activeUsersList.length;

  // Concurrent Users (connected live sockets or database active users)
  let liveConcurrentUsers = userSockets.size;
  if (companyId) {
    let companyUsersCount = 0;
    for (const record of connectedSockets.values()) {
      if (record.tenantId === companyId) companyUsersCount++;
    }
    liveConcurrentUsers = companyUsersCount;
  }

  // Ensure concurrent users reflects either socket connections or active session users
  const concurrentUsers = Math.max(liveConcurrentUsers, activeUsersCount);

  if (concurrentUsers > peakConcurrentUsersToday) {
    peakConcurrentUsersToday = concurrentUsers;
  }

  return {
    serverLoad: {
      cpuPercent,
      cores: cpus.length,
      model: cpus[0]?.model || 'Generic CPU',
      loadAvg: os.loadavg(),
    },
    memoryUsage: {
      totalBytes: totalRam,
      usedBytes: usedRam,
      freeBytes: freeRam,
      percent: ramPercent,
      formatted: `${(usedRam / 1073741824).toFixed(1)} GB / ${(totalRam / 1073741824).toFixed(1)} GB`,
      processRssBytes: process.memoryUsage().rss,
      processRssFormatted: `${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`,
    },
    databaseConnections: {
      active: dbActiveConnections,
      max: dbMaxConnections,
      latencyMs: dbLatencyMs,
      status: dbLatencyMs < 100 ? 'OPTIMAL' : 'MODERATE',
    },
    activeSessions: activeSessionsCount,
    activeUsers: activeUsersCount,
    concurrentUsers,
    peakConcurrentUsers: Math.max(peakConcurrentUsersToday, concurrentUsers),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Calculates date range boundaries based on preset or custom dates.
 */
function parseDateRange({ range = '7d', fromDate, toDate }) {
  const now = new Date();
  let start = new Date();
  let end = new Date();

  switch (range) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case '7d':
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case '30d':
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case '90d':
      start.setDate(start.getDate() - 89);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'custom':
      if (fromDate) {
        start = new Date(fromDate);
        start.setHours(0, 0, 0, 0);
      } else {
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
      }
      if (toDate) {
        end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
      } else {
        end.setHours(23, 59, 59, 999);
      }
      break;
    default:
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

/**
 * Calculates peak usage matrix and login analytics across tenants or for a specific company.
 */
export async function getLoginAnalyticsMatrix({ range = '7d', fromDate, toDate, companyId, userId }) {
  const { start, end } = parseDateRange({ range, fromDate, toDate });

  const where = {
    loginAt: {
      gte: start,
      lte: end,
    },
  };

  if (companyId) {
    where.tenantId = companyId;
  }

  if (userId) {
    where.userId = userId;
  }

  // 1. Hourly Distribution (00:00 - 23:00)
  const hourlyRaw = await prisma.$queryRawUnsafe(`
    SELECT EXTRACT(HOUR FROM "loginAt")::int AS hour, count(*)::int AS count
    FROM "login_histories"
    WHERE "loginAt" >= $1 AND "loginAt" <= $2
    ${companyId ? `AND "tenantId" = '${companyId.replace(/'/g, '')}'` : ''}
    ${userId ? `AND "userId" = '${userId.replace(/'/g, '')}'` : ''}
    GROUP BY hour
    ORDER BY hour ASC
  `, start, end);

  const hourlyMap = {};
  for (let h = 0; h < 24; h++) hourlyMap[h] = 0;
  for (const item of hourlyRaw) {
    if (item.hour != null) hourlyMap[item.hour] = Number(item.count || 0);
  }

  const hourlyDistribution = [];
  let peakHourNum = 0;
  let peakHourCount = 0;

  for (let h = 0; h < 24; h++) {
    const count = hourlyMap[h];
    const hourLabel = `${String(h).padStart(2, '0')}:00`;
    hourlyDistribution.push({
      hour: h,
      label: hourLabel,
      count,
    });
    if (count > peakHourCount) {
      peakHourCount = count;
      peakHourNum = h;
    }
  }

  const peakHourFormatted = `${String(peakHourNum).padStart(2, '0')}:00 - ${String((peakHourNum + 1) % 24).padStart(2, '0')}:00`;

  // 2. Daily Distribution (Monday - Sunday)
  // PostgreSQL DOW: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const dailyRaw = await prisma.$queryRawUnsafe(`
    SELECT EXTRACT(DOW FROM "loginAt")::int AS dow, count(*)::int AS count
    FROM "login_histories"
    WHERE "loginAt" >= $1 AND "loginAt" <= $2
    ${companyId ? `AND "tenantId" = '${companyId.replace(/'/g, '')}'` : ''}
    ${userId ? `AND "userId" = '${userId.replace(/'/g, '')}'` : ''}
    GROUP BY dow
    ORDER BY dow ASC
  `, start, end);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayShortNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dailyMap = {};
  for (let d = 0; d < 7; d++) dailyMap[d] = 0;
  for (const item of dailyRaw) {
    if (item.dow != null) dailyMap[item.dow] = Number(item.count || 0);
  }

  // Re-order starting from Monday (1) to Sunday (0)
  const orderedDows = [1, 2, 3, 4, 5, 6, 0];
  const dailyDistribution = [];
  let peakDayDow = 1;
  let peakDayCount = 0;

  for (const dow of orderedDows) {
    const count = dailyMap[dow];
    dailyDistribution.push({
      dow,
      day: dayNames[dow],
      shortDay: dayShortNames[dow],
      count,
    });
    if (count > peakDayCount) {
      peakDayCount = count;
      peakDayDow = dow;
    }
  }

  const peakDayFormatted = dayNames[peakDayDow];

  // 3. Trends Over Time (Daily timeline for selected period)
  const trendRaw = await prisma.$queryRawUnsafe(`
    SELECT TO_CHAR("loginAt", 'YYYY-MM-DD') AS date_str, count(*)::int AS count, count(DISTINCT "userId")::int AS unique_users
    FROM "login_histories"
    WHERE "loginAt" >= $1 AND "loginAt" <= $2
    ${companyId ? `AND "tenantId" = '${companyId.replace(/'/g, '')}'` : ''}
    ${userId ? `AND "userId" = '${userId.replace(/'/g, '')}'` : ''}
    GROUP BY date_str
    ORDER BY date_str ASC
  `, start, end);

  // Fill all calendar days in range
  const trendMap = {};
  for (const t of trendRaw) {
    trendMap[t.date_str] = { count: Number(t.count || 0), uniqueUsers: Number(t.unique_users || 0) };
  }

  const trends = [];
  const curr = new Date(start);
  while (curr <= end) {
    const key = curr.toISOString().slice(0, 10);
    const item = trendMap[key] || { count: 0, uniqueUsers: 0 };
    trends.push({
      date: key,
      label: curr.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      logins: item.count,
      uniqueUsers: item.uniqueUsers,
    });
    curr.setDate(curr.getDate() + 1);
  }

  // 4. Company-wise Login Distribution
  const companyWise = await prisma.$queryRawUnsafe(`
    SELECT t.id, t."companyName", t."tenantCode",
           count(lh.id)::int AS "loginCount",
           count(DISTINCT lh."userId")::int AS "uniqueUsers",
           count(DISTINCT CASE WHEN s.status = 'ACTIVE' AND s."expiresAt" > NOW() THEN s."userId" END)::int AS "activeUsers"
    FROM "tenants" t
    LEFT JOIN "login_histories" lh ON lh."tenantId" = t.id AND lh."loginAt" >= $1 AND lh."loginAt" <= $2
    LEFT JOIN "user_sessions" s ON s."tenantId" = t.id
    WHERE t."isPlatform" = false
    GROUP BY t.id, t."companyName", t."tenantCode"
    ORDER BY "loginCount" DESC, "activeUsers" DESC
    LIMIT 12
  `, start, end);

  // 5. Aggregate Summary KPIs
  const [totalLogins, totalUniqueUsers, activeSessionsCount] = await Promise.all([
    prisma.loginHistory.count({ where }),
    prisma.loginHistory.findMany({
      where,
      distinct: ['userId'],
      select: { userId: true },
    }).then((res) => res.length),
    prisma.userSession.count({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        ...(companyId ? { tenantId: companyId } : {}),
      },
    }),
  ]);

  return {
    range,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    summary: {
      totalLogins,
      uniqueUsers: totalUniqueUsers,
      activeSessions: activeSessionsCount,
      peakHour: peakHourFormatted,
      peakHourCount,
      peakDay: peakDayFormatted,
      peakDayCount,
    },
    hourlyDistribution,
    dailyDistribution,
    trends,
    companyWise: companyWise.map((c) => ({
      id: c.id,
      companyName: c.companyName,
      companyCode: c.tenantCode || '',
      loginCount: Number(c.loginCount || 0),
      uniqueUsers: Number(c.uniqueUsers || 0),
      activeUsers: Number(c.activeUsers || 0),
    })),
  };
}

/**
 * Broadcasts real-time metrics update to the PLATFORM_OWNER monitoring room.
 */
export async function broadcastMonitoringMetrics() {
  const io = getIO();
  if (!io) return;

  const room = io.sockets.adapter.rooms.get('platform_monitoring');
  // Only calculate and emit if at least one client is listening in the monitoring room
  if (!room || room.size === 0) return;

  try {
    const metrics = await getServerAndDbMetrics();
    io.to('platform_monitoring').emit('monitoring:metrics_update', metrics);
  } catch (err) {
    console.warn('[MONITORING] broadcastMonitoringMetrics error:', err.message);
  }
}

/**
 * Broadcasts a live session event (LOGIN, LOGOUT, TERMINATED, BLOCKED).
 */
export async function broadcastSessionEvent(eventType, payload) {
  const io = getIO();
  if (!io) return;

  try {
    io.to('platform_monitoring').emit('monitoring:session_event', {
      type: eventType,
      payload,
      timestamp: new Date().toISOString(),
    });

    // Also send updated metrics immediately
    const metrics = await getServerAndDbMetrics();
    io.to('platform_monitoring').emit('monitoring:metrics_update', metrics);
  } catch (err) {
    console.warn('[MONITORING] broadcastSessionEvent error:', err.message);
  }
}

// Start periodic broadcast (every 5 seconds) if clients are connected
let broadcastInterval = null;
export function startMonitoringBroadcaster() {
  if (broadcastInterval) return;
  broadcastInterval = setInterval(() => {
    broadcastMonitoringMetrics().catch(() => {});
  }, 5000);
}
