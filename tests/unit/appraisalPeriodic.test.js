import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPeriodMetadata, appraisalAvailability, isQuarterEndMonth } from '../../src/lib/appraisalPeriods.js';
import { monthWindowsOf, averageOfMonths } from '../../src/services/appraisalMetrics.service.js';

const april = { financialYearStartMonth: 4 };
const january = { financialYearStartMonth: 1 };

test('January monthly appraisal opens on 1 February', () => {
  const jan = getPeriodMetadata('MONTHLY', new Date(), null, 2026, 1, january);
  assert.equal(appraisalAvailability(jan, new Date('2026-01-31T12:00:00Z')).available, false);
  const { available, opensAt } = appraisalAvailability(jan, new Date('2026-02-01T00:00:00Z'));
  assert.equal(available, true);
  assert.equal(opensAt.toISOString(), '2026-02-01T00:00:00.000Z');
});

test('April FY: Q1 (Apr–Jun) opens in July, April monthly in May', () => {
  const q1 = getPeriodMetadata('QUARTERLY', new Date(), null, 2026, 'Q1', april);
  assert.equal(appraisalAvailability(q1, new Date('2026-06-30T10:00:00Z')).available, false);
  assert.equal(appraisalAvailability(q1, new Date('2026-07-01T00:00:00Z')).available, true);
  const apr = getPeriodMetadata('MONTHLY', new Date(), null, 2026, 4, april);
  assert.equal(appraisalAvailability(apr, new Date('2026-05-01T00:00:00Z')).available, true);
});

test('January FY: Q1 is Jan–Mar and opens in April', () => {
  const q1 = getPeriodMetadata('QUARTERLY', new Date(), null, 2026, 'Q1', january);
  assert.deepEqual(monthWindowsOf(q1).map((m) => m.label), ['January 2026', 'February 2026', 'March 2026']);
  assert.equal(appraisalAvailability(q1, new Date('2026-04-01T00:00:00Z')).available, true);
});

test('quarter month windows are inclusive whole months', () => {
  const q1 = getPeriodMetadata('QUARTERLY', new Date(), null, 2026, 'Q1', april);
  assert.deepEqual(monthWindowsOf(q1).map(({ from, to }) => [from, to]), [
    ['2026-04-01', '2026-04-30'], ['2026-05-01', '2026-05-31'], ['2026-06-01', '2026-06-30'],
  ]);
});

test('quarterly figures average the months that have data', () => {
  assert.equal(averageOfMonths([80, 90, 70]), 80);
  assert.equal(averageOfMonths([4, null, 3.5]), 3.8);
  assert.equal(averageOfMonths([null, null, null]), null);
});

test('annual appraisals are not gated', () => {
  const fy = getPeriodMetadata('ANNUAL', new Date(), null, 2026, null, april);
  assert.equal(appraisalAvailability(fy, new Date('2026-05-01T00:00:00Z')).available, true);
});

test('quarter-end months have no monthly appraisal (January start: Mar, Jun, Sep, Dec)', () => {
  const ends = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => isQuarterEndMonth(m, january));
  assert.deepEqual(ends, [3, 6, 9, 12]);
});

test('quarter-end months follow the company FY (April start: Jun, Sep, Dec, Mar)', () => {
  const ends = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => isQuarterEndMonth(m, april));
  assert.deepEqual(ends, [3, 6, 9, 12]);
  assert.equal(isQuarterEndMonth(6, april), true);
  assert.equal(isQuarterEndMonth(4, april), false);
  const july = { financialYearStartMonth: 7 };
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => isQuarterEndMonth(m, july)), [3, 6, 9, 12]);
  const feb = { financialYearStartMonth: 2 };
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => isQuarterEndMonth(m, feb)), [1, 4, 7, 10]);
});
