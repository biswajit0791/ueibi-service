import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConfigValue,
  validateConfigValue,
  getRegistrationConfig,
  updateRegistrationConfig,
  bulkUpdateRegistrationConfigs,
  restoreDefaultConfigurations,
  getConfigurationAuditHistory,
  getAllRegistrationConfigs,
} from '../../src/services/registrationConfig.service.js';

test('Dynamic Registration & Billing Configuration Service Tests', async (t) => {
  await t.test('1. parseConfigValue data type casting', () => {
    assert.equal(parseConfigValue('3999', 'NUMBER'), 3999);
    assert.equal(parseConfigValue('0.18', 'PERCENT'), 0.18);
    assert.equal(parseConfigValue('true', 'BOOLEAN'), true);
    assert.equal(parseConfigValue('false', 'BOOLEAN'), false);
    assert.equal(parseConfigValue('INR', 'STRING'), 'INR');
    assert.equal(parseConfigValue(null, 'STRING'), null);
  });

  await t.test('2. validateConfigValue enforcement', () => {
    // Pricing bounds
    assert.equal(validateConfigValue('LICENSE_UNIT_PRICE', '4999'), '4999');
    assert.throws(() => validateConfigValue('LICENSE_UNIT_PRICE', '-500'), /positive number/);
    assert.throws(() => validateConfigValue('LICENSE_UNIT_PRICE', '0'), /positive number/);

    // GST bounds
    assert.equal(validateConfigValue('GST_RATE', '0.12'), '0.12');
    assert.throws(() => validateConfigValue('GST_RATE', '1.5'), /between 0 and 1/);
    assert.throws(() => validateConfigValue('GST_RATE', '-0.05'), /between 0 and 1/);

    // OTP TTL bounds
    assert.equal(validateConfigValue('OTP_TTL_MINUTES', '15'), '15');
    assert.throws(() => validateConfigValue('OTP_TTL_MINUTES', '0'), /between 1 and 120/);
    assert.throws(() => validateConfigValue('OTP_TTL_MINUTES', '150'), /between 1 and 120/);

    // OTP Attempts bounds
    assert.equal(validateConfigValue('OTP_MAX_ATTEMPTS', '3'), '3');
    assert.throws(() => validateConfigValue('OTP_MAX_ATTEMPTS', '0'), /between 1 and 20/);

    // Action Token TTL bounds
    assert.equal(validateConfigValue('ACTION_TOKEN_TTL_DAYS', '30'), '30');
    assert.throws(() => validateConfigValue('ACTION_TOKEN_TTL_DAYS', '0'), /between 1 and 365/);
  });

  await t.test('3. Dynamic Config Read, Update & Cache Invalidation', async () => {
    // Read initial license price
    const initialPrice = await getRegistrationConfig('LICENSE_UNIT_PRICE');
    assert.equal(typeof initialPrice, 'number');

    // Update to 4500
    const updated = await updateRegistrationConfig({
      key: 'LICENSE_UNIT_PRICE',
      value: '4500',
      actor: 'platform.owner@ueibi.com',
      reason: 'Pricing revision Q4',
    });
    assert.equal(updated.parsedValue, 4500);

    // Immediate read reflects updated value (cache invalidated)
    const readAfterUpdate = await getRegistrationConfig('LICENSE_UNIT_PRICE');
    assert.equal(readAfterUpdate, 4500);

    // Check audit trail
    const auditLogs = await getConfigurationAuditHistory({ key: 'LICENSE_UNIT_PRICE', limit: 5 });
    assert.ok(auditLogs.length > 0);
    assert.equal(auditLogs[0].newValue, '4500');
    assert.equal(auditLogs[0].changedBy, 'platform.owner@ueibi.com');
  });

  await t.test('4. Bulk Update Multiple Settings in Atomic Transaction', async () => {
    const bulkResult = await bulkUpdateRegistrationConfigs({
      configs: [
        { key: 'GST_RATE', value: '0.12' },
        { key: 'OTP_TTL_MINUTES', value: '15' },
      ],
      actor: 'platform.owner@ueibi.com',
      reason: 'Tax & security policy update',
    });

    assert.equal(bulkResult.length, 2);

    const newGst = await getRegistrationConfig('GST_RATE');
    assert.equal(newGst, 0.12);

    const newOtpTtl = await getRegistrationConfig('OTP_TTL_MINUTES');
    assert.equal(newOtpTtl, 15);
  });

  await t.test('5. Restore System Defaults', async () => {
    const restored = await restoreDefaultConfigurations({
      actor: 'platform.owner@ueibi.com',
      reason: 'Reset testing configs to standard defaults',
    });

    assert.ok(restored.length >= 10);

    const defaultPrice = await getRegistrationConfig('LICENSE_UNIT_PRICE');
    assert.equal(defaultPrice, 3999);

    const defaultGst = await getRegistrationConfig('GST_RATE');
    assert.equal(defaultGst, 0.18);

    const defaultOtpTtl = await getRegistrationConfig('OTP_TTL_MINUTES');
    assert.equal(defaultOtpTtl, 10);
  });
});

