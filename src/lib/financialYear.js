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
