import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCriticalPriority,
  validateMilestoneDrafts,
  MIN_CRITICAL_MILESTONES,
  MAX_CRITICAL_MILESTONES,
} from '../../src/lib/criticalTask.js';

const NOW = new Date('2026-10-26T10:00:00');
const task = { startDate: '2026-10-26', dueDate: '2026-12-31', now: NOW };
const box = (n, dueDate = '2026-11-15') => ({ title: `M${n}`, dueDate });

test('limits are 1 to 4', () => {
  assert.equal(MIN_CRITICAL_MILESTONES, 1);
  assert.equal(MAX_CRITICAL_MILESTONES, 4);
});

test('detects critical priority case-insensitively', () => {
  assert.equal(isCriticalPriority('critical'), true);
  assert.equal(isCriticalPriority('CRITICAL'), true);
  assert.equal(isCriticalPriority('high'), false);
  assert.equal(isCriticalPriority(undefined), false);
});

test('each milestone keeps its own single assignee (any team)', () => {
  const r = validateMilestoneDrafts([
    { ...box(1), assigneeId: 'emp-a' },
    { ...box(2), assigneeId: 'emp-b' },
    box(3),
  ], task);
  assert.deepEqual(r.items.map((m) => m.assigneeId), ['emp-a', 'emp-b', null]);
});

test('an assignee must be a single id, not a list', () => {
  const r = validateMilestoneDrafts([{ ...box(1), assigneeId: ['a', 'b'] }], task);
  assert.match(r.error, /^Milestone 1:/);
});

test('rejects zero milestones and non-arrays', () => {
  assert.match(validateMilestoneDrafts([], task).error, /at least 1/);
  assert.match(validateMilestoneDrafts(undefined, task).error, /at least 1/);
});

test('rejects more than four milestones', () => {
  const r = validateMilestoneDrafts([1, 2, 3, 4, 5].map((n) => box(n)), task);
  assert.match(r.error, /at most 4/);
});

test('accepts one to four milestones and numbers them in order', () => {
  for (let n = 1; n <= 4; n += 1) {
    const r = validateMilestoneDrafts(Array.from({ length: n }, (_, i) => box(i + 1)), task);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.items.map((m) => m.order), Array.from({ length: n }, (_, i) => i + 1));
  }
});

test('normalises fields', () => {
  const r = validateMilestoneDrafts([{ title: '  Design  ', dueDate: '2026-11-15', watcherEmails: ['a@x.com'] }], task);
  assert.equal(r.items[0].title, 'Design');
  assert.equal(r.items[0].description, null);
  assert.equal(r.items[0].progress, 0);
  assert.deepEqual(r.items[0].watcherEmails, ['a@x.com']);
  assert.ok(r.items[0].dueDate instanceof Date);
});

test('requires a title and a due date on every milestone', () => {
  assert.match(validateMilestoneDrafts([{ title: '', dueDate: '2026-11-15' }], task).error, /^Milestone 1:/);
  assert.match(validateMilestoneDrafts([box(1), { title: 'x' }], task).error, /^Milestone 2:/);
});

test('rejects invalid watcher emails', () => {
  const r = validateMilestoneDrafts([{ ...box(1), watcherEmails: ['nope'] }], task);
  assert.match(r.error, /valid email/);
});

test('milestone cannot be after the task due date', () => {
  const r = validateMilestoneDrafts([box(1, '2027-01-01')], task);
  assert.match(r.error, /later than the task's own due date/);
});

test('milestone due on the task due date is allowed', () => {
  assert.equal(validateMilestoneDrafts([box(1, '2026-12-31')], task).error, undefined);
});

test('milestone cannot precede the task start date', () => {
  const r = validateMilestoneDrafts([box(1, '2026-10-20')], { ...task, startDate: '2026-10-26' });
  assert.match(r.error, /earlier than the task's start date/);
});

test('without a start date a past milestone is rejected unless the task is overdue', () => {
  const noStart = { dueDate: '2026-12-31', now: NOW };
  assert.match(validateMilestoneDrafts([box(1, '2026-10-01')], noStart).error, /in the past/);
  const overdue = { dueDate: '2026-10-20', now: NOW };
  assert.equal(validateMilestoneDrafts([box(1, '2026-10-10')], overdue).error, undefined);
});

test('requires a task due date', () => {
  assert.match(validateMilestoneDrafts([box(1)], { now: NOW }).error, /due date/);
});

test('reports which milestone is at fault', () => {
  const r = validateMilestoneDrafts([box(1), box(2, '2030-01-01')], task);
  assert.match(r.error, /^Milestone 2:/);
});
