import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_STATUS,
  isGoalActive,
  reviewFieldsForTransition,
} from '../../src/services/taskReview.service.js';

const NOW = new Date('2026-10-27T10:00:00Z');
const goal = { ownerManagerId: 'owner' };
const open = { goalId: 'g1', status: 'in_progress', progress: 50, reviewStatus: null };

test('a goal is active once it leaves PENDING_APPROVAL / DRAFT', () => {
  assert.equal(isGoalActive({ status: 'PENDING_APPROVAL' }), false);
  assert.equal(isGoalActive({ status: 'DRAFT' }), false);
  assert.equal(isGoalActive({ status: 'ACTIVE' }), true);
  assert.equal(isGoalActive({ status: 'IN_PROGRESS' }), true);
  assert.equal(isGoalActive(null), true);
});

test('the goal owner completing a task approves it at once', () => {
  const r = reviewFieldsForTransition({
    existing: open, next: { status: 'done', progress: 100 }, goal, actorId: 'owner', now: NOW,
  });
  assert.equal(r.reviewStatus, REVIEW_STATUS.APPROVED);
  assert.equal(r.reviewedById, 'owner');
  assert.equal(r.reviewedAt, NOW);
});

test('a member completing a task leaves it waiting to be submitted', () => {
  const r = reviewFieldsForTransition({
    existing: open, next: { status: 'done', progress: 100 }, goal, actorId: 'member',
  });
  assert.equal(r.reviewStatus, null);
});

test('reopening a reviewed task clears its review', () => {
  const r = reviewFieldsForTransition({
    existing: { ...open, status: 'done', progress: 100, reviewStatus: REVIEW_STATUS.SUBMITTED },
    next: { status: 'in_progress', progress: 80 },
    goal,
    actorId: 'member',
  });
  assert.equal(r.reviewStatus, null);
  assert.equal(r.reviewSubmittedAt, null);
});

test('edits that keep a task complete leave its review alone', () => {
  const r = reviewFieldsForTransition({
    existing: { ...open, status: 'done', progress: 100, reviewStatus: REVIEW_STATUS.APPROVED },
    next: { status: 'done', progress: 100 },
    goal,
    actorId: 'owner',
  });
  assert.deepEqual(r, {});
});

test('private, standalone and goal-less tasks are never reviewed', () => {
  for (const existing of [
    { ...open, isPrivate: true },
    { ...open, isStandalone: true },
    { ...open, goalId: null },
  ]) {
    const r = reviewFieldsForTransition({
      existing, next: { status: 'done', progress: 100 }, goal, actorId: 'owner',
    });
    assert.deepEqual(r, {});
  }
});
