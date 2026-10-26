import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseByEmployee } from '../../src/services/taskWeightage.service.js';

const NOW = new Date('2026-10-27T10:00:00Z');
const task = (employeeId, managerRating, extra = {}) => ({
  id: `${employeeId}-${Math.random()}`, employeeId, employee: { name: employeeId },
  weight: 20, progress: 100, status: 'done', managerRating, ...extra,
});
const byId = (items) => Object.fromEntries(items.map((i) => [i.employeeId, i]));

test('manager rating is the mean of the rated tasks, to one decimal', () => {
  const r = byId(summariseByEmployee([task('a', 4), task('a', 5), task('a', 4)], NOW));
  assert.equal(r.a.managerRating, 4.3);
  assert.equal(r.a.ratedCount, 3);
});

test('unrated tasks are left out of the average', () => {
  const r = byId(summariseByEmployee([task('a', 3), task('a', null), task('a', undefined)], NOW));
  assert.equal(r.a.managerRating, 3);
  assert.equal(r.a.ratedCount, 1);
  assert.equal(r.a.taskCount, 3);
});

test('nobody rated yet: rating is null, not 0', () => {
  const r = byId(summariseByEmployee([task('a', null)], NOW));
  assert.equal(r.a.managerRating, null);
  assert.equal(r.a.ratedCount, 0);
});

test('each member is averaged separately', () => {
  const r = byId(summariseByEmployee([task('a', 5), task('b', 2), task('b', 3)], NOW));
  assert.equal(r.a.managerRating, 5);
  assert.equal(r.b.managerRating, 2.5);
});

test('a 0 rating counts as a rating', () => {
  const r = byId(summariseByEmployee([task('a', 0), task('a', 4)], NOW));
  assert.equal(r.a.managerRating, 2);
});

test('the weightage totals are unchanged by the rating', () => {
  const r = byId(summariseByEmployee([task('a', 4, { weight: 30 }), task('a', null, { weight: 10, progress: 50, status: 'in_progress' })], NOW));
  assert.equal(r.a.plannedWeight, 40);
  assert.equal(r.a.taskCount, 2);
  assert.equal('ratingTotal' in r.a, false);
});
