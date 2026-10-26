import { test } from 'node:test';
import assert from 'node:assert/strict';
import { milestoneBlock, isMilestoneApproved, MILESTONE_GATE } from '../../src/lib/milestoneGate.js';

const active = { status: 'ACTIVE' };
const unlocked = { locked: false, totalWeight: 100 };
const at90 = { locked: true, totalWeight: 90 };
const pending = { status: 'PENDING_APPROVAL' };
const approved = { status: 'APPROVED', approvedById: 'mgr' };

const block = (over) => milestoneBlock({
  action: 'work', goal: active, weightSummary: unlocked, milestone: approved, requireApproval: true, ...over,
});
const codeOf = (over) => block(over)?.code ?? null;

// ── The reported case ─────────────────────────────────────────────────────
test('reported case: 90% allocated, milestone unapproved — assignee cannot move progress', () => {
  const r = block({ weightSummary: at90, milestone: pending });
  assert.equal(r.code, MILESTONE_GATE.GOAL_WEIGHT_INCOMPLETE);
  assert.match(r.message, /total 100% \(currently 90%\)/);
});

test('reported case: 90% allocated — goal owner cannot approve the milestone', () => {
  const r = block({ action: 'approve', weightSummary: at90, milestone: pending });
  assert.equal(r.code, MILESTONE_GATE.GOAL_WEIGHT_INCOMPLETE);
  assert.match(r.message, /can't be approved/);
});

test('even an approved milestone is frozen while weights are below 100%', () => {
  assert.equal(codeOf({ weightSummary: at90, milestone: approved }), MILESTONE_GATE.GOAL_WEIGHT_INCOMPLETE);
});

test('over-allocated weights (110%) also freeze milestones', () => {
  assert.equal(codeOf({ weightSummary: { locked: true, totalWeight: 110 } }), MILESTONE_GATE.GOAL_WEIGHT_INCOMPLETE);
  assert.equal(codeOf({ action: 'approve', weightSummary: { locked: true, totalWeight: 110 }, milestone: pending }),
    MILESTONE_GATE.GOAL_WEIGHT_INCOMPLETE);
});

// ── Goal activation ───────────────────────────────────────────────────────
test('goal awaiting activation blocks approval and work', () => {
  for (const status of ['PENDING_APPROVAL', 'DRAFT', 'pending_approval']) {
    assert.equal(codeOf({ action: 'approve', goal: { status }, milestone: pending }), MILESTONE_GATE.GOAL_NOT_ACTIVE);
    assert.equal(codeOf({ goal: { status } }), MILESTONE_GATE.GOAL_NOT_ACTIVE);
  }
});

test('an inactive goal is reported before its weights', () => {
  assert.equal(codeOf({ goal: { status: 'PENDING_APPROVAL' }, weightSummary: at90 }), MILESTONE_GATE.GOAL_NOT_ACTIVE);
});

test('worked goal statuses count as active', () => {
  for (const status of ['ACTIVE', 'IN_PROGRESS', 'READY_FOR_SUBMISSION', 'CHANGES_REQUESTED']) {
    assert.equal(codeOf({ goal: { status } }), null);
  }
});

// ── Once the plan is complete ─────────────────────────────────────────────
test('100% allocated and active: goal owner may approve', () => {
  assert.equal(codeOf({ action: 'approve', milestone: pending }), null);
});

test('100% allocated but milestone unapproved: assignee still waits for approval', () => {
  assert.equal(codeOf({ milestone: pending }), MILESTONE_GATE.MILESTONE_NOT_APPROVED);
});

test('100% allocated and milestone approved: assignee may work it', () => {
  assert.equal(codeOf({ milestone: approved }), null);
  assert.equal(codeOf({ milestone: { status: 'DONE' } }), null);
});

test('weight-exempt legacy goals are not locked', () => {
  assert.equal(codeOf({ weightSummary: { locked: false, exempt: true, totalWeight: 120 } }), null);
});

// ── Approval requirement and reschedules ──────────────────────────────────
test('a reschedule request does not un-approve an approved milestone', () => {
  assert.equal(codeOf({ milestone: { status: 'RESCHEDULE_REQUESTED', approvedById: 'mgr' } }), null);
});

test('a reschedule request on a never-approved milestone is still unapproved', () => {
  assert.equal(codeOf({ milestone: { status: 'RESCHEDULE_REQUESTED', approvedById: null } }),
    MILESTONE_GATE.MILESTONE_NOT_APPROVED);
});

test('companies that do not require approval may work unapproved milestones', () => {
  assert.equal(codeOf({ requireApproval: false, milestone: pending }), null);
});

test('not requiring approval never bypasses the goal and weight rules', () => {
  assert.equal(codeOf({ requireApproval: false, milestone: pending, weightSummary: at90 }),
    MILESTONE_GATE.GOAL_WEIGHT_INCOMPLETE);
  assert.equal(codeOf({ requireApproval: false, goal: { status: 'PENDING_APPROVAL' } }),
    MILESTONE_GATE.GOAL_NOT_ACTIVE);
});

test('approving never depends on the milestone already being approved', () => {
  assert.equal(codeOf({ action: 'approve', milestone: pending, requireApproval: true }), null);
});

// ── Work outside a goal ───────────────────────────────────────────────────
test('goal-less / standalone tasks skip the goal rules but keep milestone approval', () => {
  assert.equal(codeOf({ goal: null, weightSummary: null, milestone: approved }), null);
  assert.equal(codeOf({ goal: null, weightSummary: null, milestone: pending }), MILESTONE_GATE.MILESTONE_NOT_APPROVED);
  assert.equal(codeOf({ action: 'approve', goal: null, weightSummary: null, milestone: pending }), null);
});

test('isMilestoneApproved', () => {
  assert.equal(isMilestoneApproved({ status: 'APPROVED' }), true);
  assert.equal(isMilestoneApproved({ status: 'DONE' }), true);
  assert.equal(isMilestoneApproved({ status: 'PENDING_APPROVAL' }), false);
  assert.equal(isMilestoneApproved({ status: 'RESCHEDULE_REQUESTED', approvedById: 'x' }), true);
  assert.equal(isMilestoneApproved(null), false);
});
