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

test('completeGoalIfAllApproved returns null if not all reviewed tasks are approved', async () => {
  const { completeGoalIfAllApproved } = await import('../../src/services/taskReview.service.js');
  const { prisma } = await import('../../src/lib/prisma.js');

  const mockGoal = {
    id: 'g1',
    tenantId: 't1',
    status: 'ACTIVE',
    assignments: [
      { id: 'a1', employeeId: 'emp1', status: 'ACTIVE', progress: 0 },
      { id: 'a2', employeeId: 'emp2', status: 'ACTIVE', progress: 0 },
    ],
    tasks: [
      { id: 'task1', employeeId: 'emp1', status: 'todo', progress: 0, isStandalone: false, isPrivate: false, reviewStatus: null },
      { id: 'task2', employeeId: 'emp2', status: 'done', progress: 100, isStandalone: false, isPrivate: false, reviewStatus: REVIEW_STATUS.APPROVED },
    ],
  };

  const origGoal = prisma.goal;
  const origAssignment = prisma.goalAssignment;

  try {
    Object.defineProperty(prisma, 'goal', {
      value: {
        findFirst: async () => mockGoal,
        update: async () => { throw new Error('Should not update goal to completed!'); },
      },
      configurable: true,
    });
    Object.defineProperty(prisma, 'goalAssignment', {
      value: {
        updateMany: async () => ({ count: 1 }),
        findMany: async () => [
          { status: 'ACTIVE', progress: 0 },
          { status: 'COMPLETED', progress: 100 },
        ],
      },
      configurable: true,
    });

    const res = await completeGoalIfAllApproved({ goalId: 'g1', tenantId: 't1', actor: { id: 'owner' } });
    assert.equal(res, null);
  } finally {
    if (origGoal) Object.defineProperty(prisma, 'goal', { value: origGoal, configurable: true });
    if (origAssignment) Object.defineProperty(prisma, 'goalAssignment', { value: origAssignment, configurable: true });
  }
});
