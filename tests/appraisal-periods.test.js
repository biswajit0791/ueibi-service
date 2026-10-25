import assert from 'node:assert/strict';
import test from 'node:test';
import { getFiscalYearPeriods, getPeriodMetadata } from '../src/lib/appraisalPeriods.js';

test('April fiscal year drives quarterly and annual appraisal boundaries', () => {
  const settings = { financialYearStartMonth: 4, financialYearStartDay: 1 };
  const q1 = getPeriodMetadata('QUARTERLY', new Date('2026-10-25T00:00:00Z'), null, 2026, 'Q1', settings);
  const annual = getPeriodMetadata('ANNUAL', new Date('2026-10-25T00:00:00Z'), null, 2026, null, settings);

  assert.equal(q1.name, 'Q1 FY 2026-27');
  assert.equal(q1.startDate.toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(q1.endDate.toISOString(), '2026-06-30T23:59:59.999Z');
  assert.equal(annual.startDate.toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(annual.endDate.toISOString(), '2027-03-31T23:59:59.999Z');
});

test('January fiscal year maps quarters and monthly periods to calendar year', () => {
  const settings = { financialYearStartMonth: 1, financialYearStartDay: 1 };
  const q3 = getPeriodMetadata('QUARTERLY', new Date('2026-10-25T00:00:00Z'), null, 2026, 'Q3', settings);
  const december = getPeriodMetadata('MONTHLY', new Date('2026-10-25T00:00:00Z'), null, 2026, 'December', settings);

  assert.equal(q3.name, 'Q3 FY 2026-27');
  assert.equal(q3.startDate.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(q3.endDate.toISOString(), '2026-09-30T23:59:59.999Z');
  assert.equal(december.fiscalYearStartYear, 2026);
});

test('period tracker produces all twelve fiscal months in fiscal order', () => {
  const periods = getFiscalYearPeriods('MONTHLY', 2026, {
    financialYearStartMonth: 4,
    financialYearStartDay: 1,
  });

  assert.equal(periods.length, 12);
  assert.equal(periods[0].name, 'April 2026');
  assert.equal(periods[8].name, 'December 2026');
  assert.equal(periods[9].name, 'January 2027');
  assert.equal(periods[11].name, 'March 2027');
});
