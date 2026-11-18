import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_TYPES,
  normalizeDayType,
  isHalfDay,
  calculateLeaveDuration,
  getAuthoritativeDuration,
} from '../../src/services/leaveCalculation.service.js';

test('Leave Calculation Service Unit & Regression Tests', async (t) => {
  await t.test('1. Normalizes day types accurately', () => {
    assert.equal(normalizeDayType('FIRST_HALF'), DAY_TYPES.FIRST_HALF);
    assert.equal(normalizeDayType('1st Half'), DAY_TYPES.FIRST_HALF);
    assert.equal(normalizeDayType('SECOND_HALF'), DAY_TYPES.SECOND_HALF);
    assert.equal(normalizeDayType('2nd Half'), DAY_TYPES.SECOND_HALF);
    assert.equal(normalizeDayType('FULL'), DAY_TYPES.FULL);
    assert.equal(normalizeDayType('FULL_DAY'), DAY_TYPES.FULL);
    assert.equal(normalizeDayType('Full Day'), DAY_TYPES.FULL);
    assert.equal(normalizeDayType('UNKNOWN'), DAY_TYPES.FULL);
  });

  await t.test('2. Accurately determines isHalfDay', () => {
    assert.equal(isHalfDay('FIRST_HALF'), true);
    assert.equal(isHalfDay('SECOND_HALF'), true);
    assert.equal(isHalfDay('FULL'), false);
    assert.equal(isHalfDay(''), false);
  });

  await t.test('3. Calculates single half-day duration as exactly 0.5', () => {
    // October 8 - 1st Half = 0.5 day
    const oct8 = calculateLeaveDuration({
      startDate: '2026-10-08',
      endDate: '2026-10-08',
      dayType: 'FIRST_HALF',
    });
    assert.equal(oct8, 0.5);

    // October 10 - 1st Half = 0.5 day
    const oct10 = calculateLeaveDuration({
      startDate: '2026-10-10',
      endDate: '2026-10-10',
      dayType: 'FIRST_HALF',
    });
    assert.equal(oct10, 0.5);

    // October 20 - 2nd Half = 0.5 day
    const oct20 = calculateLeaveDuration({
      startDate: '2026-10-20',
      endDate: '2026-10-20',
      dayType: 'SECOND_HALF',
    });
    assert.equal(oct20, 0.5);
  });

  await t.test('4. Calculates single and multi-day full leaves correctly', () => {
    // Single full day = 1.0
    const singleFull = calculateLeaveDuration({
      startDate: '2026-10-08',
      endDate: '2026-10-08',
      dayType: 'FULL',
    });
    assert.equal(singleFull, 1.0);

    // October 14 (Wed) to October 16 (Fri) = 3 full working days
    const multiFull = calculateLeaveDuration({
      startDate: '2026-10-14',
      endDate: '2026-10-16',
      dayType: 'FULL',
    });
    assert.equal(multiFull, 3.0);
  });

  await t.test('5. getAuthoritativeDuration resolves half-day requests even if DB stores totalDays: 1', () => {
    // Legacy corrupted record: dayType is SECOND_HALF but totalDays was 1
    const legacyCorruptedReq = {
      id: 'legacy-1',
      dayType: 'SECOND_HALF',
      totalDays: 1,
      startDate: new Date('2026-10-20'),
      endDate: new Date('2026-10-20'),
    };
    assert.equal(getAuthoritativeDuration(legacyCorruptedReq), 0.5);

    // Legitimate 1-day full request: dayType is FULL and totalDays is 1
    const legitFullReq = {
      id: 'legit-1',
      dayType: 'FULL',
      totalDays: 1,
      startDate: new Date('2026-10-08'),
      endDate: new Date('2026-10-08'),
    };
    assert.equal(getAuthoritativeDuration(legitFullReq), 1.0);

    // Multi-day request with totalDays: 3
    const multiReq = {
      id: 'multi-3',
      dayType: 'FULL',
      totalDays: 3,
      startDate: new Date('2026-10-14'),
      endDate: new Date('2026-10-16'),
    };
    assert.equal(getAuthoritativeDuration(multiReq), 3.0);
  });

  await t.test('6. Fractional mixed day calculations', () => {
    // 3 working days with 1 half day boundary (e.g., starting second half) = 2.5 days
    const mixed = calculateLeaveDuration({
      startDate: '2026-10-14',
      endDate: '2026-10-16',
      startHalf: 'SECOND_HALF',
      endHalf: null,
    });
    assert.equal(mixed, 2.5);

    // 3 working days with both start and end as half days = 2.0 days
    const mixedBoth = calculateLeaveDuration({
      startDate: '2026-10-14',
      endDate: '2026-10-16',
      startHalf: 'SECOND_HALF',
      endHalf: 'FIRST_HALF',
    });
    assert.equal(mixedBoth, 2.0);
  });
});
