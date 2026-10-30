/**
 * workSchedule.service.js
 *
 * Centralized, reusable dynamic time and work-schedule validation service.
 * Determines real-time availability of half-day (First Half / Second Half) and full-day
 * leave & WFH requests based on organization working hours, break timings, cutoff rules,
 * weekends, holidays, and organization-specific timezone.
 */
import { prisma } from '../lib/prisma.js';

export const DEFAULT_WORK_SCHEDULE = {
  timezone: 'Asia/Kolkata',
  workStartTime: '09:00',
  workEndTime: '18:00',
  breakStartTime: '13:00',
  breakEndTime: '14:00',
  firstHalfEndTime: '13:30',   // Cutoff time after which 1st Half is elapsed
  secondHalfEndTime: '18:00',  // Cutoff time after which 2nd Half & same-day leaves close
  workingDays: [1, 2, 3, 4, 5], // Monday (1) to Friday (5)
  holidays: [],                // Array of YYYY-MM-DD
};

/**
 * Parses "HH:MM" into total minutes from 00:00.
 * @param {string} timeStr - e.g. "13:30"
 * @returns {number}
 */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.trim().split(':').map((v) => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/**
 * Formats minutes from 00:00 into 12-hour display string (e.g. "1:30 PM").
 * @param {number} totalMinutes
 * @returns {string}
 */
export function formatMinutesToDisplay(totalMinutes) {
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mStr = String(m).padStart(2, '0');
  return `${h12}:${mStr} ${period}`;
}

/**
 * Formats "HH:MM" into 12-hour display string (e.g. "13:30" -> "1:30 PM").
 */
export function formatTimeToDisplay(timeStr) {
  return formatMinutesToDisplay(parseTimeToMinutes(timeStr));
}

/**
 * Returns normalized YYYY-MM-DD string.
 */
export function toDateString(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    if (d.includes('T')) return d.split('T')[0];
    const parsed = new Date(d);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return d.slice(0, 10);
  }
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return '';
}

/**
 * Extracts date, time, total minutes, and day-of-week in the specified IANA timezone.
 * @param {Date} date
 * @param {string} timezone - e.g. "Asia/Kolkata"
 */
export function getZonedTimeParts(date = new Date(), timezone = 'Asia/Kolkata') {
  const safeTimezone = timezone || 'Asia/Kolkata';
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((p) => [p.type, p.value]),
    );

    const year = parts.year;
    const month = parts.month;
    const day = parts.day;
    const hour = parts.hour === '24' ? '00' : parts.hour;
    const minute = parts.minute;
    const second = parts.second;

    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${hour}:${minute}`;
    const totalMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);

    // Day of week in the target timezone
    const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTimezone,
      weekday: 'narrow',
    });
    // Or compute day of week from year, month, day in target zone
    const zonedDateObj = new Date(`${dateStr}T${hour}:${minute}:${second}`);
    const dayOfWeek = zonedDateObj.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

    return {
      dateStr,
      timeStr,
      totalMinutes,
      dayOfWeek,
      timezone: safeTimezone,
    };
  } catch (err) {
    // Fallback if timezone string is invalid
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return {
      dateStr: `${year}-${month}-${day}`,
      timeStr: `${hour}:${minute}`,
      totalMinutes: date.getHours() * 60 + date.getMinutes(),
      dayOfWeek: date.getDay(),
      timezone: 'UTC',
    };
  }
}

/**
 * Retrieves the effective work schedule for a tenant, merging configured settings with defaults.
 * @param {string} tenantId
 * @returns {Promise<typeof DEFAULT_WORK_SCHEDULE>}
 */
export async function getEffectiveWorkSchedule(tenantId) {
  if (!tenantId) return { ...DEFAULT_WORK_SCHEDULE };

  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { workingHours: true },
  });

  const raw = (settings?.workingHours && typeof settings.workingHours === 'object')
    ? settings.workingHours
    : {};

  return {
    timezone: raw.timezone || DEFAULT_WORK_SCHEDULE.timezone,
    workStartTime: raw.workStartTime || DEFAULT_WORK_SCHEDULE.workStartTime,
    workEndTime: raw.workEndTime || DEFAULT_WORK_SCHEDULE.workEndTime,
    breakStartTime: raw.breakStartTime || DEFAULT_WORK_SCHEDULE.breakStartTime,
    breakEndTime: raw.breakEndTime || DEFAULT_WORK_SCHEDULE.breakEndTime,
    firstHalfEndTime: raw.firstHalfEndTime || DEFAULT_WORK_SCHEDULE.firstHalfEndTime,
    secondHalfEndTime: raw.secondHalfEndTime || raw.workEndTime || DEFAULT_WORK_SCHEDULE.secondHalfEndTime,
    workingDays: Array.isArray(raw.workingDays) && raw.workingDays.length > 0
      ? raw.workingDays
      : DEFAULT_WORK_SCHEDULE.workingDays,
    holidays: Array.isArray(raw.holidays) ? raw.holidays : DEFAULT_WORK_SCHEDULE.holidays,
  };
}

/**
 * Evaluates dynamic day-type availability for a target leave date against the organization's work schedule.
 *
 * @param {Object} params
 * @param {Object} params.schedule - Work schedule object
 * @param {string} params.targetDate - Requested start date (YYYY-MM-DD)
 * @param {string} [params.targetEndDate] - Requested end date (YYYY-MM-DD)
 * @param {Date} [params.referenceTime=new Date()] - Reference point for current time
 * @returns {Object} Availability report
 */
export function evaluateDayTypeAvailability({
  schedule = DEFAULT_WORK_SCHEDULE,
  targetDate,
  targetEndDate = null,
  referenceTime = new Date(),
}) {
  const current = getZonedTimeParts(referenceTime, schedule.timezone);
  const todayStr = current.dateStr;
  const targetDateStr = toDateString(targetDate);
  const targetEndStr = targetEndDate ? toDateString(targetEndDate) : targetDateStr;

  const firstHalfCutoffMinutes = parseTimeToMinutes(schedule.firstHalfEndTime);
  const secondHalfCutoffMinutes = parseTimeToMinutes(schedule.secondHalfEndTime);
  const workStartMinutes = parseTimeToMinutes(schedule.workStartTime);

  const firstHalfCutoffDisplay = formatTimeToDisplay(schedule.firstHalfEndTime);
  const secondHalfCutoffDisplay = formatTimeToDisplay(schedule.secondHalfEndTime);

  // ── 1. PAST DATE ───────────────────────────────────────────────────────────
  if (targetDateStr && targetDateStr < todayStr) {
    return {
      date: targetDateStr,
      today: todayStr,
      currentTime: current.timeStr,
      timezone: schedule.timezone,
      isPast: true,
      isToday: false,
      isFuture: false,
      isWorkingDay: false,
      fullDay: {
        available: false,
        reason: 'Leaves cannot be applied for past dates.',
      },
      firstHalf: {
        available: false,
        reason: 'First Half leave cannot be applied for past dates.',
      },
      secondHalf: {
        available: false,
        reason: 'Second Half leave cannot be applied for past dates.',
      },
      message: 'Start Date cannot be in the past. Please select today or a future date.',
    };
  }

  // ── 2. FUTURE DATE ─────────────────────────────────────────────────────────
  if (targetDateStr && targetDateStr > todayStr) {
    return {
      date: targetDateStr,
      today: todayStr,
      currentTime: current.timeStr,
      timezone: schedule.timezone,
      isPast: false,
      isToday: false,
      isFuture: true,
      isWorkingDay: true,
      fullDay: { available: true },
      firstHalf: { available: true },
      secondHalf: { available: true },
      message: null,
    };
  }

  // ── 3. TODAY'S DATE (Dynamic Real-Time Evaluation) ─────────────────────────
  const isHoliday = (schedule.holidays || []).includes(todayStr);
  const isWeekend = !(schedule.workingDays || []).includes(current.dayOfWeek);

  if (isHoliday || isWeekend) {
    const nonWorkingReason = isHoliday
      ? 'Today is an organization holiday.'
      : 'Today is a configured non-working weekend.';
    return {
      date: targetDateStr || todayStr,
      today: todayStr,
      currentTime: current.timeStr,
      timezone: schedule.timezone,
      isPast: false,
      isToday: true,
      isFuture: false,
      isWorkingDay: false,
      fullDay: { available: false, reason: nonWorkingReason },
      firstHalf: { available: false, reason: nonWorkingReason },
      secondHalf: { available: false, reason: nonWorkingReason },
      message: nonWorkingReason,
    };
  }

  const currentMinutes = current.totalMinutes;

  // Case A: Before First Half Ends
  // Both half-day options and full-day can be selected.
  if (currentMinutes < firstHalfCutoffMinutes) {
    return {
      date: todayStr,
      today: todayStr,
      currentTime: current.timeStr,
      timezone: schedule.timezone,
      isPast: false,
      isToday: true,
      isFuture: false,
      isWorkingDay: true,
      fullDay: { available: true },
      firstHalf: { available: true },
      secondHalf: { available: true },
      message: null,
    };
  }

  // Case B: After First Half Ends, but Before Second Half Ends
  // First Half has elapsed. Second Half is available. Full Day for single-day today is disabled.
  if (currentMinutes < secondHalfCutoffMinutes) {
    return {
      date: todayStr,
      today: todayStr,
      currentTime: current.timeStr,
      timezone: schedule.timezone,
      isPast: false,
      isToday: true,
      isFuture: false,
      isWorkingDay: true,
      fullDay: {
        available: false,
        reason: `Full Day leave is no longer available for today because the first half of the working day has already elapsed (cutoff was ${firstHalfCutoffDisplay}). You may apply for 2nd Half leave.`,
      },
      firstHalf: {
        available: false,
        reason: 'First Half leave is no longer available because the time has already passed.',
      },
      secondHalf: {
        available: true,
      },
      message: 'First Half leave is no longer available because the time has already passed. You may apply for 2nd Half leave.',
    };
  }

  // Case C: After Second Half Ends (End of working day)
  // Both half-day options disabled, same-day leave applications closed.
  return {
    date: todayStr,
    today: todayStr,
    currentTime: current.timeStr,
    timezone: schedule.timezone,
    isPast: false,
    isToday: true,
    isFuture: false,
    isWorkingDay: true,
    fullDay: {
      available: false,
      reason: `Same-day leave applications are closed for today because the working day has already ended (closed at ${secondHalfCutoffDisplay}). Please apply for future dates.`,
    },
    firstHalf: {
      available: false,
      reason: 'First Half leave is no longer available because the time has already passed.',
    },
    secondHalf: {
      available: false,
      reason: `Second Half leave is no longer available because the working day has already ended (closed at ${secondHalfCutoffDisplay}).`,
    },
    message: 'Working hours for today have ended. Same-day leave applications are closed. Please apply for future dates.',
  };
}

/**
 * Validates leave application timing server-side.
 * Rejects invalid same-day or past-date requests with standard HTTP 400 errors.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.startDate
 * @param {string} params.endDate
 * @param {string} params.dayType - 'FULL' | 'FIRST_HALF' | 'SECOND_HALF'
 * @param {Date} [params.referenceTime=new Date()]
 * @throws {{ status: number, message: string }}
 */
export async function validateLeaveRequestTiming({
  tenantId,
  startDate,
  endDate,
  dayType = 'FULL',
  referenceTime = new Date(),
}) {
  const schedule = await getEffectiveWorkSchedule(tenantId);
  const availability = evaluateDayTypeAvailability({
    schedule,
    targetDate: startDate,
    targetEndDate: endDate,
    referenceTime,
  });

  const startStr = toDateString(startDate);
  const endStr = toDateString(endDate);

  // 1. Past Date Check
  if (availability.isPast) {
    throw {
      status: 400,
      message: 'Start Date cannot be in the past. Leaves must be applied for today or future dates.',
    };
  }

  // 2. Today's Date Dynamic Checks
  if (availability.isToday) {
    if (!availability.isWorkingDay) {
      throw {
        status: 400,
        message: availability.message || 'Cannot apply same-day leave on a non-working day or holiday.',
      };
    }

    if (dayType === 'FIRST_HALF' && !availability.firstHalf.available) {
      throw {
        status: 400,
        message: availability.firstHalf.reason || 'First Half leave is no longer available because the time has already passed.',
      };
    }

    if (dayType === 'SECOND_HALF' && !availability.secondHalf.available) {
      throw {
        status: 400,
        message: availability.secondHalf.reason || 'Second Half leave is no longer available because the working day has already ended.',
      };
    }

    // Full day starting today: if start is today and full day is disabled for today
    if (dayType === 'FULL' && startStr === availability.today && !availability.fullDay.available) {
      throw {
        status: 400,
        message: availability.fullDay.reason || 'Full Day leave cannot be applied starting today because the first half of the working day has already elapsed.',
      };
    }

    // If both half days and full day are closed (end of working day)
    if (!availability.firstHalf.available && !availability.secondHalf.available && !availability.fullDay.available) {
      throw {
        status: 400,
        message: availability.message || 'Working hours for today have ended. Same-day leave applications are closed. Please apply for future dates.',
      };
    }
  }

  return availability;
}

/**
 * Returns complete timing policy and availability snapshot for frontend consumption.
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} [params.targetDate]
 * @param {Date} [params.referenceTime=new Date()]
 */
export async function getLeaveTimingPolicy({
  tenantId,
  targetDate = null,
  referenceTime = new Date(),
}) {
  const schedule = await getEffectiveWorkSchedule(tenantId);
  const current = getZonedTimeParts(referenceTime, schedule.timezone);
  const effectiveTargetDate = targetDate ? toDateString(targetDate) : current.dateStr;

  const availability = evaluateDayTypeAvailability({
    schedule,
    targetDate: effectiveTargetDate,
    referenceTime,
  });

  return {
    schedule,
    today: current.dateStr,
    currentTime: current.timeStr,
    timezone: schedule.timezone,
    serverTimeIso: referenceTime.toISOString(),
    availability,
  };
}
