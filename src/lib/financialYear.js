/**
 * financialYear.js
 *
 * Configurable Financial Year support.
 * Default: 1 April → 31 March of following year.
 * Company Admin can configure start month and day in TenantSettings.
 */

/**
 * Returns a label like "FY 2026-27" for a given date (defaults to now).
 */
export function getCurrentFinancialYear(date = new Date(), settings = null) {
  return getTenantFinancialYear(settings, date).label;
}

/** Current calendar quarter label: Q1..Q4 */
export function getCurrentQuarter(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `Q${Math.floor(d.getMonth() / 3) + 1}`;
}

/**
 * Returns the full Financial Year window for the tenant:
 * { label, startDate, endDate, startDateStr, endDateStr, startYear, endYear }
 */
export function getTenantFinancialYear(settings = null, date = new Date()) {
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (isNaN(d.getTime())) {
    return getTenantFinancialYear(settings, new Date());
  }

  const startMonth = Math.min(12, Math.max(1, Number(settings?.financialYearStartMonth) || 4)); // 1-12, default 4 (April)
  const startDay = Math.min(31, Math.max(1, Number(settings?.financialYearStartDay) || 1));     // 1-31, default 1

  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate();

  let fyStartYear;
  if (month > startMonth || (month === startMonth && day >= startDay)) {
    fyStartYear = year;
  } else {
    fyStartYear = year - 1;
  }
  const fyEndYear = fyStartYear + 1;

  // FY start: YYYY-MM-DD 00:00:00 UTC
  const startDate = new Date(Date.UTC(fyStartYear, startMonth - 1, startDay, 0, 0, 0, 0));
  // Next FY start minus 1 millisecond
  const nextFyStart = new Date(Date.UTC(fyEndYear, startMonth - 1, startDay, 0, 0, 0, 0));
  const endDate = new Date(nextFyStart.getTime() - 1);

  const pad = (n) => String(n).padStart(2, '0');
  const startDateStr = `${startDate.getUTCFullYear()}-${pad(startDate.getUTCMonth() + 1)}-${pad(startDate.getUTCDate())}`;
  const endDateStr = `${endDate.getUTCFullYear()}-${pad(endDate.getUTCMonth() + 1)}-${pad(endDate.getUTCDate())}`;

  const endYearShort = String(fyEndYear % 100).padStart(2, '0');
  const label = `FY ${fyStartYear}-${endYearShort}`;

  return {
    label,
    startDate,
    endDate,
    startDateStr,
    endDateStr,
    startYear: fyStartYear,
    endYear: fyEndYear,
    startMonth,
    startDay,
  };
}

/**
 * Validates Goal dates according to corporate policy:
 * - Start date cannot be backdated (must be today or future date)
 * - End date cannot extend beyond the current Financial Year
 * - Target date cannot be earlier than start date
 */
export function validateGoalDates({ startDate, targetDate, dueDate, settings, now = new Date() }) {
  const effectiveDue = dueDate || targetDate;
  const fy = getTenantFinancialYear(settings, now);

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // 1. Goal Start Date: No backdating
  if (startDate) {
    const startStr = typeof startDate === 'string'
      ? (startDate.includes('T') ? startDate.split('T')[0] : startDate).trim()
      : new Date(startDate).toISOString().split('T')[0];

    if (startStr < todayStr) {
      return {
        isValid: false,
        field: 'startDate',
        message: 'Goal start date cannot be backdated. It must be today or a future date.',
      };
    }
  }

  // 2. Goal End Date: Cannot extend beyond current Financial Year
  if (effectiveDue) {
    const dueStr = typeof effectiveDue === 'string'
      ? (effectiveDue.includes('T') ? effectiveDue.split('T')[0] : effectiveDue).trim()
      : new Date(effectiveDue).toISOString().split('T')[0];

    if (dueStr > fy.endDateStr) {
      return {
        isValid: false,
        field: 'targetDate',
        message: `Goal target completion date cannot extend beyond the current Financial Year (ending ${fy.endDateStr}).`,
      };
    }

    // 3. Due date vs Start date
    if (startDate) {
      const startStr = typeof startDate === 'string'
        ? (startDate.includes('T') ? startDate.split('T')[0] : startDate).trim()
        : new Date(startDate).toISOString().split('T')[0];

      if (dueStr < startStr) {
        return {
          isValid: false,
          field: 'targetDate',
          message: 'Target completion date cannot be earlier than start date.',
        };
      }
    }
  }

  return { isValid: true, fy };
}

/**
 * Bridges the two financial-year conventions in this codebase.
 */
export function toGoalsFinancialYear(fy) {
  const match = (fy || '').match(/(\d{4})/);
  if (!match) return fy;
  const start = parseInt(match[1], 10);
  return `FY ${start}-${String(start + 1).slice(-2)}`;
}

