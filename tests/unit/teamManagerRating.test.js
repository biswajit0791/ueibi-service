import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseByEmployee, hideManagerWeightage } from '../../src/services/taskWeightage.service.js';

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

const goalTask = (employeeId, weight, extra = {}) => task(employeeId, null, { goalId: 'g1', weight, ...extra });

test('final weightage averages the manager figure where set, the planned weight elsewhere', () => {
  const r = byId(summariseByEmployee([
    goalTask('a', 30), goalTask('a', 20, { managerFinalWeight: 15 }), goalTask('a', 10),
  ], NOW));
  assert.equal(r.a.avgActualWeight, 20);
  assert.equal(r.a.avgFinalWeight, 18.3);
  assert.equal(r.a.completedCount, 3);
  assert.equal(r.a.managerCount, 1);
});

test('no adjustments: the planned weights stand, so final equals actual', () => {
  const r = byId(summariseByEmployee([goalTask('a', 40), goalTask('a', 20)], NOW));
  assert.equal(r.a.managerCount, 0);
  assert.equal(r.a.avgFinalWeight, 30);
  assert.equal(r.a.avgActualWeight, 30);
});

test('unfinished and standalone tasks stay out of the weightage averages', () => {
  const r = byId(summariseByEmployee([
    goalTask('a', 30),
    goalTask('a', 50, { progress: 40, status: 'in_progress' }),
    task('a', null, { weight: 1, isStandalone: true }),
    task('a', null, { weight: 1 }),
  ], NOW));
  assert.equal(r.a.completedCount, 1);
  assert.equal(r.a.avgActualWeight, 30);
  assert.equal(r.a.avgFinalWeight, 30);
});

test('a manager figure of 0 counts and pulls the average down', () => {
  const r = byId(summariseByEmployee([goalTask('a', 20), goalTask('a', 20, { managerFinalWeight: 0 })], NOW));
  assert.equal(r.a.avgFinalWeight, 10);
});

test('an employee sees only the actual weightage of their own work', () => {
  const [item] = summariseByEmployee([goalTask('a', 30), goalTask('a', 20, { managerFinalWeight: 15 })], NOW);
  const own = hideManagerWeightage(item);
  assert.equal(own.avgActualWeight, 25);
  assert.equal(own.avgFinalWeight, null);
  assert.equal(own.managerCount, null);
  assert.equal(own.finalWeight, null);
  assert.equal(own.plannedWeight, 50);
});
