import test from 'node:test';
import assert from 'node:assert/strict';
import { updateCompanySettingsSchema } from '../../src/validations/companySettings.schema.js';

test('accepts supported milestone alert settings', () => {
  const result = updateCompanySettingsSchema.safeParse({
    milestoneAlertEnabled: true,
    milestoneAlertDaysBefore: 1,
    milestoneAlertFrequencyDays: 1,
    milestoneAlertOnlyNoProgress: true,
    milestoneAlertSubject: 'Due: {{milestoneTitle}}',
    milestoneAlertBody: 'Task {{taskTitle}} is due {{dueDate}}.',
  });
  assert.equal(result.success, true);
});

test('rejects invalid alert timing and empty templates', () => {
  const result = updateCompanySettingsSchema.safeParse({
    milestoneAlertDaysBefore: 31,
    milestoneAlertFrequencyDays: 0,
    milestoneAlertSubject: ' ',
  });
  assert.equal(result.success, false);
});
