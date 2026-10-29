import { getTenantFinancialYear } from './financialYear.js';

export const APPRAISAL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function financialYearStart(settings, year) {
  return {
    month: Math.min(12, Math.max(1, Number(settings?.financialYearStartMonth) || 4)),
    day: Math.min(31, Math.max(1, Number(settings?.financialYearStartDay) || 1)),
    year,
  };
}

function fiscalYearLabel(startYear) {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function utcBoundary(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

export function getPeriodMetadata(
  frequency = 'MONTHLY',
  targetDate = new Date(),
  customPeriodName = null,
  explicitYear = null,
  explicitMonth = null,
  settings = null,
) {
  const date = targetDate instanceof Date ? targetDate : new Date(targetDate);
  const freq = String(frequency || 'MONTHLY').toUpperCase();
  const startMonth = Math.min(12, Math.max(1, Number(settings?.financialYearStartMonth) || 4));
  const fy = getTenantFinancialYear(settings, date);
  let year = explicitYear ? parseInt(explicitYear, 10) : date.getFullYear();
  if (!explicitYear && customPeriodName) {
    const explicitFiscalYear = String(customPeriodName).match(/\bFY\s*(20\d{2})/i);
    const explicitCalendarYear = String(customPeriodName).match(/\b(20\d{2})\b/);
    if (explicitFiscalYear) year = Number(explicitFiscalYear[1]);
    else if (explicitCalendarYear) year = Number(explicitCalendarYear[1]);
  }

  if (freq === 'MONTHLY') {
    let monthIndex = date.getMonth();
    if (explicitMonth !== null && explicitMonth !== undefined) {
      const monthNumber = Number(explicitMonth);
      if (Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
        monthIndex = monthNumber - 1;
      } else if (typeof explicitMonth === 'string') {
        const index = APPRAISAL_MONTH_NAMES.findIndex(
          (month) => month.toLowerCase() === explicitMonth.trim().toLowerCase(),
        );
        if (index >= 0) monthIndex = index;
      }
    } else if (customPeriodName) {
      const index = APPRAISAL_MONTH_NAMES.findIndex((month) =>
        String(customPeriodName).toLowerCase().includes(month.toLowerCase()));
      if (index >= 0) monthIndex = index;
    }

    const monthName = APPRAISAL_MONTH_NAMES[monthIndex];
    const calendarYear = year;
    const fiscalYearStartYear = monthIndex + 1 >= startMonth ? calendarYear : calendarYear - 1;
    const startDate = new Date(Date.UTC(calendarYear, monthIndex, 1));
    const endDate = new Date(Date.UTC(calendarYear, monthIndex + 1, 1) - 1);
    return {
      name: `${monthName} ${calendarYear}`,
      frequency: 'MONTHLY',
      year: calendarYear,
      month: monthName,
      monthNumber: monthIndex + 1,
      fiscalYearStartYear,
      fiscalYear: fiscalYearLabel(fiscalYearStartYear),
      startDate,
      endDate,
      periodLabel: `${monthName} (${calendarYear})`,
      dueDate: endDate,
    };
  }

  if (freq === 'QUARTERLY') {
    let quarter;
    let fiscalYearStartYear;
    const explicitQuarter = String(explicitMonth || customPeriodName || '').match(/Q([1-4])/i);
    if (explicitQuarter) {
      quarter = Number(explicitQuarter[1]);
      fiscalYearStartYear = explicitYear || (
        /\bFY\s*20\d{2}/i.test(String(customPeriodName || '')) ? year : fy.startYear
      );
    } else {
      fiscalYearStartYear = explicitYear || fy.startYear;
      const monthOffset = (date.getMonth() - (startMonth - 1) + 12) % 12;
      quarter = Math.floor(monthOffset / 3) + 1;
    }

    const start = financialYearStart(settings, fiscalYearStartYear);
    const startDate = utcBoundary(start.year, start.month + (quarter - 1) * 3, start.day);
    const endDate = new Date(utcBoundary(start.year, start.month + quarter * 3, start.day).getTime() - 1);
    const label = fiscalYearLabel(fiscalYearStartYear);
    return {
      name: `Q${quarter} ${label}`,
      frequency: 'QUARTERLY',
      year: fiscalYearStartYear,
      month: `Q${quarter}`,
      monthNumber: quarter,
      fiscalYearStartYear,
      fiscalYear: label,
      startDate,
      endDate,
      periodLabel: `Q${quarter} (${label})`,
      dueDate: endDate,
    };
  }

  const fiscalYearStartYear = explicitYear || (
    /\bFY\s*20\d{2}/i.test(String(customPeriodName || '')) ? year : fy.startYear
  );
  const start = financialYearStart(settings, fiscalYearStartYear);
  const startDate = utcBoundary(start.year, start.month, start.day);
  const endDate = new Date(utcBoundary(start.year + 1, start.month, start.day).getTime() - 1);
  const label = fiscalYearLabel(fiscalYearStartYear);
  return {
    name: label,
    frequency: 'ANNUAL',
    year: fiscalYearStartYear,
    month: 'Annual',
    monthNumber: null,
    fiscalYearStartYear,
    fiscalYear: label,
    startDate,
    endDate,
    periodLabel: `Annual (${label})`,
    dueDate: endDate,
  };
}

export function getFiscalYearPeriods(frequency, fiscalYearStartYear, settings) {
  const startMonth = Math.min(12, Math.max(1, Number(settings?.financialYearStartMonth) || 4));
  if (frequency === 'MONTHLY') {
    return Array.from({ length: 12 }, (_, index) => {
      const monthIndex = (startMonth - 1 + index) % 12;
      const year = fiscalYearStartYear + (startMonth - 1 + index >= 12 ? 1 : 0);
      return getPeriodMetadata('MONTHLY', new Date(Date.UTC(year, monthIndex, 1)), null, year, monthIndex + 1, settings);
    });
  }
  if (frequency === 'QUARTERLY') {
    return Array.from({ length: 4 }, (_, index) =>
      getPeriodMetadata('QUARTERLY', new Date(), null, fiscalYearStartYear, `Q${index + 1}`, settings));
  }
  return [getPeriodMetadata('ANNUAL', new Date(), null, fiscalYearStartYear, null, settings)];
}

/**
 * When a Monthly or Quarterly appraisal can be submitted: only once its period
 * has ended. January's monthly appraisal opens on 1 February; with an April
 * financial year, Q1 (Apr–Jun) opens on 1 July. Annual appraisals are not
 * gated here.
 *
 * @param {{ frequency: string, endDate: Date|string }} cycle
 * @returns {{ available: boolean, opensAt: Date|null }}
 */
export function appraisalAvailability(cycle, now = new Date()) {
  const frequency = String(cycle?.frequency || '').toUpperCase();
  if (!['MONTHLY', 'QUARTERLY'].includes(frequency) || !cycle?.endDate) {
    return { available: true, opensAt: null };
  }
  const opensAt = new Date(new Date(cycle.endDate).getTime() + 1);
  return { available: now >= opensAt, opensAt };
}
