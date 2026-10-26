import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MILESTONE_ALERT_SETTINGS,
  escapeMilestoneAlertHtml,
  milestoneAlertContext,
  renderMilestoneAlertTemplate,
  shouldSendMilestoneAlert,
} from '../../src/lib/milestoneAlertPolicy.js';
import { defaultManagerWatcherEmail } from '../../src/services/milestoneWatcher.service.js';

const now = new Date('2026-10-26T12:00:00.000Z');
const baseMilestone = {
  dueDate: new Date('2026-10-27T00:00:00.000Z'),
  progress: 0,
  status: 'PENDING_APPROVAL',
  isDone: false,
  lastEscalatedAt: null,
};

test('starts the default reminder one day before due date for zero-progress work', () => {
  assert.equal(shouldSendMilestoneAlert(baseMilestone, DEFAULT_MILESTONE_ALERT_SETTINGS, now), true);
  assert.equal(shouldSendMilestoneAlert({
    ...baseMilestone,
    dueDate: new Date('2026-10-28T00:00:00.000Z'),
  }, DEFAULT_MILESTONE_ALERT_SETTINGS, now), false);
});

test('only sends while progress remains zero when the tenant policy requires no progress', () => {
  assert.equal(shouldSendMilestoneAlert({
    ...baseMilestone,
    progress: 5,
  }, DEFAULT_MILESTONE_ALERT_SETTINGS, now), false);
  assert.equal(shouldSendMilestoneAlert({
    ...baseMilestone,
    progress: 5,
  }, { ...DEFAULT_MILESTONE_ALERT_SETTINGS, milestoneAlertOnlyNoProgress: false }, now), true);
});

test('respects enabled state, completion, and configured resend cadence', () => {
  assert.equal(shouldSendMilestoneAlert(baseMilestone, {
    ...DEFAULT_MILESTONE_ALERT_SETTINGS,
    milestoneAlertEnabled: false,
  }, now), false);
  assert.equal(shouldSendMilestoneAlert({
    ...baseMilestone,
    isDone: true,
  }, DEFAULT_MILESTONE_ALERT_SETTINGS, now), false);
  assert.equal(shouldSendMilestoneAlert({
    ...baseMilestone,
    lastEscalatedAt: new Date('2026-10-26T02:00:00.000Z'),
  }, DEFAULT_MILESTONE_ALERT_SETTINGS, now), false);
  assert.equal(shouldSendMilestoneAlert({
    ...baseMilestone,
    lastEscalatedAt: new Date('2026-10-25T11:59:59.000Z'),
  }, DEFAULT_MILESTONE_ALERT_SETTINGS, now), true);
});

test('renders supported template values and escapes HTML output', () => {
  const context = milestoneAlertContext({
    ...baseMilestone,
    title: '<Checkpoint>',
    order: 2,
  }, { title: 'Task & Plan', employee: { name: 'Owner' } }, now);
  const body = renderMilestoneAlertTemplate('{{milestoneTitle}} on {{taskTitle}} is {{progress}}%', context);
  assert.equal(body, '<Checkpoint> on Task & Plan is 0%');
  assert.equal(escapeMilestoneAlertHtml(body), '&lt;Checkpoint&gt; on Task &amp; Plan is 0%');
});

test('does not make CMD a default watcher, but accepts an active direct manager', () => {
  assert.equal(defaultManagerWatcherEmail({
    email: 'manager@example.com',
    role: 'MANAGER',
    status: 'ACTIVE',
  }), 'manager@example.com');
  assert.equal(defaultManagerWatcherEmail({
    email: 'cmd@example.com',
    role: 'CMD',
    status: 'ACTIVE',
  }), null);
  assert.equal(defaultManagerWatcherEmail({
    email: 'inactive@example.com',
    role: 'MANAGER',
    status: 'INACTIVE',
  }), null);
});
