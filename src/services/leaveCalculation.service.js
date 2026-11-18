import { prisma } from '../lib/prisma.js';

/**
 * Centralized Leave Duration & Day-Type Calculation Service
 *
 * Provides a single authoritative calculation for:
 * - Leave application
 * - Manager approval
 * - HR approval
 * - Leave balance deduction
 * - Leave history
 * - Team Leave Requests
 * - Attendance integration
 * - Reports and analytics
 */

export const DAY_TYPES = Object.freeze({
  FULL: 'FULL',
  FIRST_HALF: 'FIRST_HALF',
  SECOND_HALF: 'SECOND_HALF',
});

/**
 * Normalizes any dayType string variant into standard 'FULL' | 'FIRST_HALF' | 'SECOND_HALF'.
 */
export function normalizeDayType(dayType) {
  if (!dayType) return DAY_TYPES.FULL;
  const str = String(dayType).trim().toUpperCase().replace(/[-\s]/g, '_');
  if (
    str === 'FIRST_HALF' ||
    str === '1ST_HALF' ||
    str === '1STHALF' ||
    str === 'FIRST' ||
    str === '1ST' ||
    str === 'FIRSTHALF'
  ) {
    return DAY_TYPES.FIRST_HALF;
  }
  if (
    str === 'SECOND_HALF' ||
    str === '2ND_HALF' ||
    str === '2NDHALF' ||
    str === 'SECOND' ||
    str === '2ND' ||
    str === 'SECONDHALF'
  ) {
    return DAY_TYPES.SECOND_HALF;
  }
  if (str === 'HALF' || str === 'HALF_DAY' || str === 'HALFDAY') {
    return DAY_TYPES.FIRST_HALF;
  }
  return DAY_TYPES.FULL;
}

/**
 * Checks whether a given dayType represents a half day.
 */
export function isHalfDay(dayType) {
  const norm = normalizeDayType(dayType);
  return norm === DAY_TYPES.FIRST_HALF || norm === DAY_TYPES.SECOND_HALF;
}

/**
 * Centralized leave-duration calculation function.
 *
 * Expected rules:
 * - Full Day = 1.0
 * - 1st Half = 0.5
 * - 2nd Half = 0.5
 * - Multiple full days = Number of working days
 * - Mixed full and half days = Correct fractional total
 *
 * Examples:
 * - October 8 – 1st Half = 0.5 day
 * - October 10 – 1st Half = 0.5 day
 * - October 20 – 2nd Half = 0.5 day
 * - October 16 to October 18 – Full Day = 3 days
 */
export function calculateLeaveDuration({
  startDate,
  endDate,
  dayType = DAY_TYPES.FULL,
  startHalf = null,
  endHalf = null,
  totalDays = null,
} = {}) {
  const normDayType = normalizeDayType(dayType);

  // 1. Explicit Half-Day rule: strictly 0.5
  if (isHalfDay(normDayType)) {
    return 0.5;
  }

  // 2. Date parsing and validation
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    if (typeof totalDays === 'number' && totalDays > 0) return totalDays;
    return 0;
  }

  // Formatted YYYY-MM-DD keys to prevent UTC/local day-boundary skews
  const toDateKey = (d) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const startKey = toDateKey(start);
  const endKey = toDateKey(end);

  // 3. Single-day request
  if (startKey === endKey) {
    if (isHalfDay(normDayType)) return 0.5;
    return 1.0;
  }

  // 4. Multi-day request: calculate working days (skipping Saturday and Sunday)
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dayOfWeek = cur.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count += 1.0;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // Guarantee minimum 1 working day if date span is positive
  let duration = Math.max(1.0, count);

  // 5. Support mixed full & half days (fractional bounds)
  if (startHalf && isHalfDay(startHalf)) {
    duration -= 0.5;
  }
  if (endHalf && isHalfDay(endHalf)) {
    duration -= 0.5;
  }

  return Math.max(0.5, duration);
}

/**
 * Returns the authoritative duration for an existing or incoming leave request record.
 * Guarantees that any request marked as FIRST_HALF or SECOND_HALF always evaluates to 0.5,
 * correcting any legacy database records that had 1.0.
 */
export function getAuthoritativeDuration(req) {
  if (!req) return 1.0;
  const normDayType = normalizeDayType(req.dayType);
  if (isHalfDay(normDayType)) {
    return 0.5;
  }
  if (typeof req.totalDays === 'number' && req.totalDays > 0 && req.totalDays !== 1) {
    return req.totalDays;
  }
  return calculateLeaveDuration({
    startDate: req.startDate,
    endDate: req.endDate,
    dayType: req.dayType,
    totalDays: req.totalDays,
  });
}

/**
 * Audit existing half-day records and safely reconcile balances.
 *
 * - Identifies half-day requests recorded as 1 day.
 * - Sets their correct duration to 0.5 without changing approval statuses.
 * - Reconciles leave and WFH balances to prevent negative or double deductions.
 * - Preserves original approval history and audit trail.
 */
export async function reconcileLegacyHalfDayRecords(customPrisma = prisma) {
  const p = customPrisma;
  console.log('[LeaveService] Checking for legacy half-day records requiring reconciliation...');

  // 1. Identify half-day requests recorded with totalDays != 0.5
  const allHalfDayCandidates = await p.leaveRequest.findMany({
    where: {
      OR: [
        { dayType: 'FIRST_HALF' },
        { dayType: 'SECOND_HALF' },
        { dayType: { contains: 'HALF', mode: 'insensitive' } },
        { dayType: { contains: '1st', mode: 'insensitive' } },
        { dayType: { contains: '2nd', mode: 'insensitive' } },
      ],
    },
    include: {
      employee: { select: { id: true, name: true, tenantId: true } },
    },
  });

  const mismatched = allHalfDayCandidates.filter((r) => isHalfDay(r.dayType) && r.totalDays !== 0.5);

  if (mismatched.length === 0) {
    console.log('[LeaveService] All half-day requests are properly calibrated to 0.5 days.');
    return { reconciledRequests: 0, reconciledBalances: 0 };
  }

  console.log(`[LeaveService] Found ${mismatched.length} half-day request(s) with incorrect duration. Reconciling...`);

  const affectedEmployeeYearKeys = new Set();

  await p.$transaction(async (tx) => {
    for (const r of mismatched) {
      const oldDays = r.totalDays;
      const normalizedType = normalizeDayType(r.dayType);

      // Safe update: calibrate duration to 0.5, preserve all approvals, IDs, comments & timestamps
      await tx.leaveRequest.update({
        where: { id: r.id },
        data: {
          totalDays: 0.5,
          dayType: normalizedType,
        },
      });

      // Audit log entry for system reconciliation
      if (r.tenantId && r.employeeId) {
        await tx.leaveAuditLog.create({
          data: {
            tenantId: r.tenantId,
            leaveRequestId: r.id,
            leaveTypeId: r.leaveTypeId || null,
            actorUserId: r.employeeId,
            action: 'BALANCE_RECONCILED',
            details: `[System Migration] Reconciled half-day request duration from ${oldDays} day(s) to 0.5 day(s). Approval status "${r.status}" preserved.`,
            metadata: {
              previousTotalDays: oldDays,
              newTotalDays: 0.5,
              dayType: normalizedType,
              status: r.status,
            },
          },
        }).catch(() => {});
      }

      const year = new Date(r.startDate).getFullYear();
      affectedEmployeeYearKeys.add(JSON.stringify({ tenantId: r.tenantId, employeeId: r.employeeId, year }));
    }
  });

  // 2. Reconcile balances for all affected employees so pending and used reflect exact actuals
  let reconciledBalanceCount = 0;

  for (const rawKey of affectedEmployeeYearKeys) {
    const { tenantId, employeeId, year } = JSON.parse(rawKey);
    if (!tenantId || !employeeId) continue;

    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

    const yearRequests = await p.leaveRequest.findMany({
      where: {
        tenantId,
        employeeId,
        startDate: { gte: startOfYear },
        endDate: { lte: endOfYear },
        status: { in: ['PENDING', 'APPROVED'] },
      },
      select: {
        id: true,
        requestType: true,
        leaveTypeId: true,
        type: true,
        totalDays: true,
        dayType: true,
        status: true,
      },
    });

    // Reconcile WFH Balance
    const wfhReqs = yearRequests.filter(
      (r) => r.requestType === 'WFH' || (r.type && r.type.toLowerCase().includes('wfh'))
    );
    const actualWfhUsed = wfhReqs
      .filter((r) => r.status === 'APPROVED')
      .reduce((sum, r) => sum + getAuthoritativeDuration(r), 0);
    const actualWfhPending = wfhReqs
      .filter((r) => r.status === 'PENDING')
      .reduce((sum, r) => sum + getAuthoritativeDuration(r), 0);

    await p.wfhBalance.updateMany({
      where: { tenantId, employeeId, year },
      data: {
        used: actualWfhUsed,
        pending: Math.max(0, actualWfhPending),
      },
    });

    // Reconcile Leave Balances for each leave type
    const leaveBalances = await p.leaveBalance.findMany({
      where: { tenantId, employeeId, year },
    });

    for (const lb of leaveBalances) {
      const typeReqs = yearRequests.filter(
        (r) =>
          r.requestType !== 'WFH' &&
          (r.leaveTypeId === lb.leaveTypeId || (r.type && r.type.toLowerCase().includes(lb.leaveTypeId.toLowerCase())))
      );
      const actualTypeUsed = typeReqs
        .filter((r) => r.status === 'APPROVED')
        .reduce((sum, r) => sum + getAuthoritativeDuration(r), 0);
      const actualTypePending = typeReqs
        .filter((r) => r.status === 'PENDING')
        .reduce((sum, r) => sum + getAuthoritativeDuration(r), 0);

      await p.leaveBalance.update({
        where: { id: lb.id },
        data: {
          used: actualTypeUsed,
          pending: Math.max(0, actualTypePending),
        },
      });
      reconciledBalanceCount++;
    }
  }

  console.log(`[LeaveService] Successfully reconciled ${mismatched.length} requests and ${reconciledBalanceCount} balances.`);
  return {
    reconciledRequests: mismatched.length,
    reconciledBalances: reconciledBalanceCount,
  };
}
