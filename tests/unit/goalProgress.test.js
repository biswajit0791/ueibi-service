import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateWeightedTaskProgress,
  weightedCompletion,
  countsTowardsTotal,
} from '../../src/services/goalWeight.service.js';
import { rollUpGoalProgress, rollUpGoalStatus } from '../../src/services/goal.service.js';

test('countsTowardsTotal correctly excludes deleted, standalone, and private tasks', () => {
  assert.equal(countsTowardsTotal({ isStandalone: false, isDeleted: false, isPrivate: false }), true);
  assert.equal(countsTowardsTotal({ isStandalone: true, isDeleted: false, isPrivate: false }), false);
  assert.equal(countsTowardsTotal({ isStandalone: false, isDeleted: true, isPrivate: false }), false);
  assert.equal(countsTowardsTotal({ isStandalone: false, isDeleted: false, isPrivate: true }), false);
});

test('2 tasks, 50% weight each, 1 completed (100%) and 1 todo (0%) -> Goal Progress is 50%, not 100%', () => {
  const tasks = [
    { id: 't1', title: 'Task 1', weight: 50, progress: 0, status: 'todo' },
    { id: 't2', title: 'Task 2', weight: 50, progress: 100, status: 'done' },
  ];

  const result = calculateWeightedTaskProgress(tasks);
  assert.equal(result.progress, 50);
  assert.equal(result.completedCount, 1);
  assert.equal(result.totalCount, 2);
  assert.equal(result.allCompleted, false);

  assert.equal(weightedCompletion(tasks), 50);
});

test('Goal progress NEVER incorrectly shows 100% when tasks remain incomplete (rounding cap at 99%)', () => {
  const tasks = [
    { id: 't1', title: 'Huge task', weight: 99.8, progress: 100, status: 'done' },
    { id: 't2', title: 'Tiny incomplete task', weight: 0.2, progress: 0, status: 'todo' },
  ];

  const result = calculateWeightedTaskProgress(tasks);
  assert.equal(result.allCompleted, false);
  // Math.round((99.8 / 100) * 100) = 100, but incomplete task remains -> must be capped at 99!
  assert.equal(result.progress, 99);
  assert.equal(weightedCompletion(tasks), 99);
});

test('Handles unweighted tasks correctly using equal weights (1 of 2 done -> 50%)', () => {
  const tasks = [
    { id: 't1', title: 'Task 1', weight: 0, progress: 100, status: 'done' },
    { id: 't2', title: 'Task 2', weight: 0, progress: 0, status: 'todo' },
  ];

  const result = calculateWeightedTaskProgress(tasks);
  assert.equal(result.progress, 50);
  assert.equal(result.completedCount, 1);
  assert.equal(result.totalCount, 2);
  assert.equal(result.allCompleted, false);
});

test('Handles all tasks completed -> 100%', () => {
  const tasks = [
    { id: 't1', title: 'Task 1', weight: 40, progress: 100, status: 'done' },
    { id: 't2', title: 'Task 2', weight: 60, progress: 100, status: 'completed' },
  ];

  const result = calculateWeightedTaskProgress(tasks);
  assert.equal(result.progress, 100);
  assert.equal(result.completedCount, 2);
  assert.equal(result.totalCount, 2);
  assert.equal(result.allCompleted, true);
});

test('Handles zero tasks -> 0%', () => {
  assert.equal(calculateWeightedTaskProgress([]).progress, 0);
  assert.equal(calculateWeightedTaskProgress([]).totalCount, 0);
  assert.equal(calculateWeightedTaskProgress([]).allCompleted, false);
  assert.equal(weightedCompletion([]), 0);
});

test('Handles partially completed tasks accurately', () => {
  const tasks = [
    { id: 't1', title: 'Task 1', weight: 50, progress: 50, status: 'in_progress' },
    { id: 't2', title: 'Task 2', weight: 50, progress: 20, status: 'in_progress' },
  ];

  // (50 * 50 / 100) + (50 * 20 / 100) = 25 + 10 = 35%
  const result = calculateWeightedTaskProgress(tasks);
  assert.equal(result.progress, 35);
  assert.equal(result.completedCount, 0);
  assert.equal(result.allCompleted, false);
});

test('Ignores standalone, private, and deleted tasks in calculation', () => {
  const tasks = [
    { id: 't1', title: 'Valid task 1', weight: 50, progress: 100, status: 'done' },
    { id: 't2', title: 'Valid task 2', weight: 50, progress: 0, status: 'todo' },
    { id: 't3', title: 'Deleted task', weight: 50, progress: 100, status: 'done', isDeleted: true },
    { id: 't4', title: 'Standalone task', weight: 50, progress: 100, status: 'done', isStandalone: true },
    { id: 't5', title: 'Private task', weight: 50, progress: 100, status: 'done', isPrivate: true },
  ];

  const result = calculateWeightedTaskProgress(tasks);
  assert.equal(result.totalCount, 2);
  assert.equal(result.completedCount, 1);
  assert.equal(result.progress, 50);
  assert.equal(result.allCompleted, false);
});

test('Respects managerFinalWeight override when present', () => {
  const tasks = [
    { id: 't1', title: 'Task 1', weight: 50, progress: 100, status: 'done', managerFinalWeight: 35 },
    { id: 't2', title: 'Task 2', weight: 50, progress: 0, status: 'todo' },
  ];

  const result = calculateWeightedTaskProgress(tasks);
  assert.equal(result.progress, 35);
});

test('rollUpGoalProgress caps at 99% unless every assignee is at 100%', () => {
  // 1 assignee done (100%), 2 assignees untouched (0%)
  const rows = [
    { progress: 100, status: 'COMPLETED' },
    { progress: 0, status: 'ACTIVE' },
    { progress: 0, status: 'ACTIVE' },
  ];
  assert.equal(rollUpGoalProgress(rows, 0), 33);

  // High average (99.6%) but one assignee incomplete -> cannot round to 100
  const highRows = [
    { progress: 100, status: 'COMPLETED' },
    { progress: 100, status: 'COMPLETED' },
    { progress: 99, status: 'IN_PROGRESS' },
  ];
  assert.equal(rollUpGoalProgress(highRows, 0), 99);

  // All 100% -> 100%
  const completeRows = [
    { progress: 100, status: 'COMPLETED' },
    { progress: 100, status: 'COMPLETED' },
  ];
  assert.equal(rollUpGoalProgress(completeRows, 0), 100);
});

test('rollUpGoalStatus holds goal back when co-assignees remain active', () => {
  const rows = [
    { progress: 100, status: 'COMPLETED' },
    { progress: 0, status: 'ACTIVE' },
    { progress: 0, status: 'ACTIVE' },
  ];
  // Lowest status among COMPLETED and ACTIVE is ACTIVE
  assert.equal(rollUpGoalStatus(rows, 'DRAFT'), 'ACTIVE');
});
