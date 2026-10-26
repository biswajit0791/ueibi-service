/**
 * Drives the real milestone endpoints against an in-memory stand-in for the
 * database, so the wiring of the execution gate is tested — not just the rule.
 * The original bug was there: the rule existed but the update path skipped it
 * for any task already past 'todo' (a pending_approval task counted as started).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { updateMilestone, createMilestone } from '../../src/controllers/taskMilestone.controller.js';

const EMPLOYEE = { id: 'emp', role: 'EMPLOYEE', name: 'Dibyajyoti' };
const MANAGER = { id: 'mgr', role: 'MANAGER', name: 'Goal Owner' };

let db;

function seed({ goalStatus = 'ACTIVE', weights = [30, 60], taskStatus = 'pending_approval', requireApproval = true,
  milestones = [{ status: 'PENDING_APPROVAL' }, { status: 'PENDING_APPROVAL' }] } = {}) {
  const task = {
    id: 't2', tenantId: 'ten', goalId: 'g1', employeeId: 'emp', assigneeIds: ['emp'], title: 'Implement',
    priority: 'critical', isMilestoneTracked: true, isStandalone: false, isPrivate: false,
    status: taskStatus, progress: 0, weight: weights[weights.length - 1],
    startDate: new Date('2026-10-26'), dueDate: new Date('2099-12-31'),
  };
  const others = weights.slice(0, -1).map((w, i) => ({
    id: `t${i + 10}`, goalId: 'g1', employeeId: 'emp2', weight: w, status: 'todo', progress: 0, isStandalone: false,
  }));
  db = {
    settings: { tenantId: 'ten', milestoneRequireApproval: requireApproval },
    task,
    tasks: [...others, task],
    goal: {
      id: 'g1', tenantId: 'ten', title: 'Goal', status: goalStatus, ownerManagerId: 'mgr',
      weightLockExempt: false, assignments: [],
    },
    milestones: milestones.map((m, i) => ({
      id: `m${i + 1}`, taskId: 't2', tenantId: 'ten', order: i + 1, title: `M${i + 1}`,
      dueDate: new Date('2099-01-01'), watcherEmails: [], progress: 0, isDone: false,
      approvedById: null, proposedCompletionDate: null, ...m,
    })),
  };
}

const anything = () => new Proxy({}, {
  get: (_, method) => async () => (String(method).startsWith('findMany') ? [] : (String(method).startsWith('find') ? null : {})),
});
const byId = (args) => db.milestones.find((m) => m.id === args?.where?.id);

function install() {
  const models = {
    task: {
      findFirst: async () => db.task,
      findUnique: async () => db.task,
      findMany: async () => db.tasks,
      update: async ({ data }) => Object.assign(db.task, data),
      updateMany: async () => ({ count: 0 }),
    },
    taskMilestone: {
      findFirst: async (args) => byId(args) || null,
      findUnique: async (args) => byId(args) || null,
      findMany: async () => db.milestones,
      count: async () => db.milestones.length,
      update: async (args) => Object.assign(byId(args), args.data),
      create: async ({ data }) => { const m = { id: 'new', ...data }; db.milestones.push(m); return m; },
    },
    goal: {
      findUnique: async () => ({ ...db.goal, tasks: db.tasks }),
      findFirst: async () => ({ ...db.goal, tasks: db.tasks }),
      update: async ({ data }) => Object.assign(db.goal, data),
    },
    tenantSettings: { findUnique: async () => db.settings },
  };
  for (const name of ['task', 'taskMilestone', 'goal', 'tenantSettings', 'tenantUser', 'goalAssignment',
    'taskAuditLog', 'notification', 'follower', 'goalAuditLog']) {
    Object.defineProperty(prisma, name, { value: models[name] || anything(), configurable: true });
  }
}

async function call(handler, { user, params = { id: 't2', mid: 'm1' }, body }) {
  const res = {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let error;
  await handler({ user, tenantId: 'ten', params, body }, res, (e) => { error = e; });
  if (error) throw error;
  return res;
}

beforeEach(() => { seed(); install(); });

// ── The reported case: weights at 90% ────────────────────────────────────
test('90% allocated: the assignee cannot move a milestone\'s progress', async () => {
  const res = await call(updateMilestone, { user: EMPLOYEE, body: { progress: 75 } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'GOAL_WEIGHT_INCOMPLETE');
  assert.match(res.body.error, /currently 90%/);
  assert.equal(db.milestones[0].progress, 0);
  assert.equal(db.task.status, 'pending_approval');
});

test('90% allocated: refused even when the task is already in progress', async () => {
  seed({ taskStatus: 'in_progress' }); install();
  const res = await call(updateMilestone, { user: EMPLOYEE, body: { progress: 75 } });
  assert.equal(res.statusCode, 409);
  assert.equal(db.milestones[0].progress, 0);
});

test('90% allocated: refused even on an already-approved milestone', async () => {
  seed({ milestones: [{ status: 'APPROVED', approvedById: 'mgr' }] }); install();
  const res = await call(updateMilestone, { user: EMPLOYEE, body: { progress: 40 } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'GOAL_WEIGHT_INCOMPLETE');
});

test('90% allocated: ticking a milestone done is refused', async () => {
  seed({ requireApproval: false }); install();
  const res = await call(updateMilestone, { user: EMPLOYEE, body: { isDone: true } });
  assert.equal(res.statusCode, 409);
  assert.equal(db.milestones[0].status, 'PENDING_APPROVAL');
});

test('90% allocated: the goal owner cannot approve a milestone', async () => {
  const res = await call(updateMilestone, { user: MANAGER, body: { approve: true } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'GOAL_WEIGHT_INCOMPLETE');
  assert.equal(db.milestones[0].status, 'PENDING_APPROVAL');
});

test('90% allocated: the manager cannot move progress either', async () => {
  const res = await call(updateMilestone, { user: MANAGER, body: { progress: 50 } });
  assert.equal(res.statusCode, 409);
});

test('90% allocated: non-work edits (description) are still allowed', async () => {
  const res = await call(updateMilestone, { user: EMPLOYEE, body: { description: 'notes' } });
  assert.equal(res.statusCode, 200);
  assert.equal(db.milestones[0].description, 'notes');
});

test('90% allocated: the manager can still rename a milestone (unchanged progress re-sent)', async () => {
  const res = await call(updateMilestone, { user: MANAGER, body: { title: 'Renamed', progress: 0 } });
  assert.equal(res.statusCode, 200);
  assert.equal(db.milestones[0].title, 'Renamed');
});

test('90% allocated: creating a milestone that starts part-done is refused', async () => {
  const res = await call(createMilestone, {
    user: MANAGER, params: { id: 't2' }, body: { title: 'M3', dueDate: '2099-06-01', progress: 20 },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'GOAL_WEIGHT_INCOMPLETE');
  assert.equal(db.milestones.length, 2);
});

// ── Goal not activated ────────────────────────────────────────────────────
test('goal awaiting activation: approval and progress are both refused', async () => {
  seed({ goalStatus: 'PENDING_APPROVAL', weights: [40, 60] }); install();
  const approve = await call(updateMilestone, { user: MANAGER, body: { approve: true } });
  assert.equal(approve.statusCode, 409);
  assert.equal(approve.body.code, 'GOAL_NOT_ACTIVE');
  const work = await call(updateMilestone, { user: EMPLOYEE, body: { progress: 10 } });
  assert.equal(work.statusCode, 409);
  assert.equal(work.body.code, 'GOAL_NOT_ACTIVE');
});

// ── Weights at 100% ───────────────────────────────────────────────────────
test('100% allocated, milestone unapproved: the assignee still waits for approval', async () => {
  seed({ weights: [40, 60] }); install();
  const res = await call(updateMilestone, { user: EMPLOYEE, body: { progress: 10 } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'MILESTONE_NOT_APPROVED');
});

test('100% allocated: the goal owner approves, then the assignee can work it', async () => {
  seed({ weights: [40, 60] }); install();
  const approve = await call(updateMilestone, { user: MANAGER, body: { approve: true } });
  assert.equal(approve.statusCode, 200);
  assert.equal(db.milestones[0].status, 'APPROVED');

  const work = await call(updateMilestone, { user: EMPLOYEE, body: { progress: 50 } });
  assert.equal(work.statusCode, 200);
  assert.equal(db.milestones[0].progress, 50);
  // The task follows its milestones: in progress at their average (50 + 0) / 2.
  assert.equal(db.task.status, 'in_progress');
  assert.equal(db.task.progress, 25);
});

test('100% allocated, approval not required: unapproved milestones can be worked', async () => {
  seed({ weights: [40, 60], requireApproval: false }); install();
  const res = await call(updateMilestone, { user: EMPLOYEE, body: { progress: 30 } });
  assert.equal(res.statusCode, 200);
  assert.equal(db.milestones[0].progress, 30);
});

test('weights over 100% lock milestones too', async () => {
  seed({ weights: [50, 60], milestones: [{ status: 'APPROVED', approvedById: 'mgr' }] }); install();
  const res = await call(updateMilestone, { user: EMPLOYEE, body: { progress: 30 } });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /currently 110%/);
});
