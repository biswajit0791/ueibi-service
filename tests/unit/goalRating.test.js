import test from 'node:test';
import assert from 'node:assert/strict';
import { goalRatingGate, isTaskSettled } from '../../src/lib/goalRating.js';

test('isTaskSettled treats done/completed/approved as settled', () => {
  assert.equal(isTaskSettled({ status: 'done' }), true);
  assert.equal(isTaskSettled({ status: 'Completed' }), true);
  assert.equal(isTaskSettled({ status: 'in_progress' }), false);
  assert.equal(isTaskSettled(null), false);
});

test('goalRatingGate is not ready while any task is open', () => {
  const g = goalRatingGate([{ status: 'done' }, { status: 'in_review' }]);
  assert.deepEqual(g, { ready: false, total: 2, remaining: 1 });
});

test('goalRatingGate is ready only when every task is settled', () => {
  assert.equal(goalRatingGate([{ status: 'done' }, { status: 'done' }]).ready, true);
  assert.equal(goalRatingGate([]).ready, false);
});
