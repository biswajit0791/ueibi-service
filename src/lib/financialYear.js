/**
 * financialYear.js
 *
 * Indian fiscal year runs April 1 → March 31.
 * Returns a label like "FY 2026-27" for a given date (defaults to now).
 */
export function getCurrentFinancialYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0 = Jan
  const startYear = month >= 3 ? year : year - 1; // Apr (index 3) onwards = current FY
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `FY ${startYear}-${endYearShort}`;
}

/** Current calendar quarter label: Q1..Q4 */
export function getCurrentQuarter(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `Q${Math.floor(d.getMonth() / 3) + 1}`;
}

/**
 * Bridges the two financial-year conventions in this codebase.
 *
 * Appraisal cycles (and the Team pages) use the 4-digit form "FY 2026-2027",
 * produced by getPeriodMetadata('ANNUAL'). Goal and Task rows use the 2-digit
 * form "FY 2026-27", produced by getCurrentFinancialYear() above. Both mark the
 * same Apr 1 → Mar 31 window, so only the label differs — convert at the query
 * boundary rather than trying to normalise one of them everywhere.
 *
 * Mirrors toGoalsFinancialYear() in team.controller.js / TeamMemberDetail.jsx.
 */
export function toGoalsFinancialYear(fy) {
  const match = (fy || '').match(/(\d{4})/);
  if (!match) return fy;
  const start = parseInt(match[1], 10);
  return `FY ${start}-${String(start + 1).slice(-2)}`;
}
