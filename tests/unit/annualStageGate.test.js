import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annualStageBlock } from '../../src/controllers/appraisal.controller.js';

const annual = (status) => ({ status, cycle: { frequency: 'ANNUAL' } });

test('manager cannot rate an annual appraisal before the self-appraisal is submitted', () => {
  assert.equal(annualStageBlock(annual('DRAFT'), 'MANAGER').code, 'SELF_APPRAISAL_PENDING');
  assert.equal(annualStageBlock(annual('SUBMITTED'), 'MANAGER'), null);
  assert.equal(annualStageBlock(annual('MANAGER_REVIEWED'), 'MANAGER'), null);
});

test('HR cannot act on an annual appraisal until self-appraisal and manager review are done', () => {
  assert.equal(annualStageBlock(annual('DRAFT'), 'HR').code, 'SELF_APPRAISAL_PENDING');
  assert.equal(annualStageBlock(annual('SUBMITTED'), 'HR').code, 'MANAGER_REVIEW_PENDING');
  assert.equal(annualStageBlock(annual('MANAGER_REVIEWED'), 'HR'), null);
  assert.equal(annualStageBlock(annual('COMPLETED'), 'HR'), null);
});

test('monthly and quarterly appraisals are not gated', () => {
  assert.equal(annualStageBlock({ status: 'DRAFT', cycle: { frequency: 'MONTHLY' } }, 'HR'), null);
  assert.equal(annualStageBlock({ status: 'SUBMITTED', reviewType: 'QUARTERLY' }, 'HR'), null);
});
