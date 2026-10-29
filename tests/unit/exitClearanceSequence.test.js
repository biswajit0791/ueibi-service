import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEQUENCE_ORDER, CLEARANCE_SEQUENCE, accessBlockStatus, documentsUnlocked } from '../../src/services/exitClearance.service.js';

const cl = (key, cleared) => ({ key, label: CLEARANCE_SEQUENCE.find((c) => c.key === key)?.label || key, cleared });

test('clearance sequence is Manager -> IT -> Product -> HR -> Finance', () => {
  assert.deepEqual(SEQUENCE_ORDER, ['manager', 'it', 'product', 'hr', 'finance']);
  assert.deepEqual(CLEARANCE_SEQUENCE.map((c) => c.sortOrder), [1, 2, 3, 4, 5]);
});

test('access can be blocked once everything except Finance is cleared', () => {
  const r = accessBlockStatus(
    { exitStatus: 'PENDING_CLEARANCE' },
    [cl('manager', true), cl('it', true), cl('product', true), cl('hr', true), cl('finance', false)],
  );
  assert.equal(r.eligible, true);
  assert.equal(r.blocked, false);
  assert.deepEqual(r.pendingBeforeBlock, []);
});

test('access cannot be blocked while a non-Finance clearance is pending', () => {
  const r = accessBlockStatus(
    { exitStatus: 'PENDING_CLEARANCE' },
    [cl('manager', true), cl('it', true), cl('product', false), cl('hr', false), cl('finance', false)],
  );
  assert.equal(r.eligible, false);
  assert.deepEqual(r.pendingBeforeBlock, ['Product Department', 'HR']);
});

test('already blocked or completed exits are not eligible again', () => {
  const all = [cl('manager', true), cl('it', true), cl('product', true), cl('hr', true), cl('finance', false)];
  const blocked = accessBlockStatus({ exitStatus: 'PENDING_CLEARANCE', accessBlockedAt: new Date(), accessBlockedBy: 'HR Admin' }, all);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.blockedBy, 'HR Admin');
  assert.equal(accessBlockStatus({ exitStatus: 'COMPLETED' }, all).eligible, false);
});

test('separation documents unlock once HR has cleared, even with Finance pending', () => {
  const rows = (hr, finance) => [
    { key: 'manager', status: 'CLEARED' }, { key: 'it', status: 'CLEARED' }, { key: 'product', status: 'CLEARED' },
    { key: 'hr', status: hr }, { key: 'finance', status: finance },
  ];
  assert.equal(documentsUnlocked({ exitStatus: 'PENDING_CLEARANCE' }, rows('PENDING', 'PENDING')), false);
  assert.equal(documentsUnlocked({ exitStatus: 'PENDING_CLEARANCE' }, rows('CLEARED', 'PENDING')), true);
  assert.equal(documentsUnlocked({ exitStatus: 'COMPLETED' }, rows('PENDING', 'PENDING')), true);
});
