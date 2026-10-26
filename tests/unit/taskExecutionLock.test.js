/**
 * The goal execution lock for plain tasks: no work is recorded against a goal
 * until it is approved AND its task weights total exactly 100%.
 * Runs the real service / endpoint against an in-memory stand-in for the DB.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { assertGoalUnlocked } from '../../src/services/goalWeight.service.js';
import { updateTaskStatus } from '../../src/controllers/task.controller.js';

const EMPLOYEE = { id: 'emp', role: 'EMPLOYEE', name: 'Member' };
let db;

function seed({ status = 'ACTIVE', weights = [30, 60], exempt = false } = {}) {
  const tasks = weights.map((w, i) => ({
    id: `t${i + 1}`, tenantId: 'ten', goalId: 'g1', employeeId: 'emp', assigneeIds: ['emp'], title: `Task ${i + 1}`,
    weight: w, status: 'todo', progress: 0, isStandalone: false, isPrivate: false, isMilestoneTracked: false,
  }));
  db = {
    goal: { id: 'g1', title: 'Goal', status, weightLockExempt: exempt, ownerManagerId: 'mgr', tasks },
    task: tasks[0],
  };
}

const anything = () => new Proxy({}, {
  get: (_, method) => async () => (String(method).startsWith('findMany') ? [] : (String(method).startsWith('find') ? null : {})),
});

function install() {
  const models = {
    goal: {
      findUnique: async () => db.goal,
      findFirst: async () => db.goal,
      update: async ({ data }) => Object.assign(db.goal, data),
    },
    task: {
      findFirst: async () => db.task,
      findUnique: async () => db.task,
      findMany: async () => db.goal.tasks,
      update: async ({ data }) => Object.assign(db.task, data),
    },
  };
  for (const name of ['goal', 'task', 'taskMilestone', 'goalAssignment', 'taskAuditLog', 'tenantUser', 'notification']) {
    Object.defineProperty(prisma, name, { value: models[name] || anything(), configurable: true });
  }
}

async function setStatus(body) {
  const res = {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let error;
  await updateTaskStatus({ user: EMPLOYEE, tenantId: 'ten', params: { id: 't1' }, body }, res, (e) => { error = e; });
  if (error) throw error;
  return res;
}

beforeEach(() => { seed(); install(); });

// ── assertGoalUnlocked ────────────────────────────────────────────────────
test('weights at 90%: locked with GOAL_WEIGHT_INCOMPLETE', async () => {
  await assert.rejects(assertGoalUnlocked('g1'), (e) => e.status === 409 && e.code === 'GOAL_WEIGHT_INCOMPLETE');
});

test('weights over 100%: locked', async () => {
  seed({ weights: [50, 60] }); install();
  await assert.rejects(assertGoalUnlocked('g1'), (e) => e.code === 'GOAL_WEIGHT_INCOMPLETE');
});

test('goal awaiting approval: locked with GOAL_AWAITING_APPROVAL, whatever the weights', async () => {
  seed({ status: 'PENDING_APPROVAL', weights: [40, 60] }); install();
  await assert.rejects(assertGoalUnlocked('g1'), (e) => e.code === 'GOAL_AWAITING_APPROVAL');
});

test('active goal at exactly 100%: unlocked', async () => {
  seed({ weights: [40, 60] }); install();
  const summary = await assertGoalUnlocked('g1');
  assert.equal(summary.locked, false);
});

test('weight-exempt legacy goal: unlocked below 100%', async () => {
  seed({ exempt: true }); install();
  const summary = await assertGoalUnlocked('g1');
  assert.equal(summary.locked, false);
});

test('no goal: nothing to lock', async () => {
  assert.equal(await assertGoalUnlocked(null), null);
});

// ── PATCH /tasks/:id/status ───────────────────────────────────────────────
test('weights at 90%: a member cannot start a task', async () => {
  const res = await setStatus({ status: 'in_progress' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'GOAL_WEIGHT_INCOMPLETE');
  assert.equal(db.task.status, 'todo');
});

test('weights at 90%: a member cannot record progress', async () => {
  const res = await setStatus({ status: 'in_progress', progress: 40 });
  assert.equal(res.statusCode, 409);
  assert.equal(db.task.progress, 0);
});

test('weights at 90%: moving a task back to To Do is still allowed', async () => {
  db.task.status = 'in_progress';
  db.task.progress = 20;
  const res = await setStatus({ status: 'todo' });
  assert.equal(res.statusCode, 200);
  assert.equal(db.task.status, 'todo');
});

test('weights at 100%: the member can start the task', async () => {
  seed({ weights: [40, 60] }); install();
  const res = await setStatus({ status: 'in_progress' });
  assert.equal(res.statusCode, 200);
  assert.equal(db.task.status, 'in_progress');
});
