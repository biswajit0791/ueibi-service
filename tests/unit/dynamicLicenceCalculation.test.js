import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLicenceBreakdown,
  computeRegistrationPricing,
} from '../../src/services/licenceCalculation.service.js';
import { registrationSchema } from '../../src/validations/registration.schema.js';

test('Scenario A: Solo CMD (HR and Finance marked Not Required)', () => {
  const result = calculateLicenceBreakdown({
    cmdEmail: 'cmd@company.com',
    hrNotRequired: true,
    financeNotRequired: true,
    additionalLicenses: 0,
  });

  assert.equal(result.stakeholderCount, 1);
  assert.equal(result.totalLicenses, 1);
  assert.equal(result.stakeholders.cmd.billable, true);
  assert.equal(result.stakeholders.hr.status, 'NOT_REQUIRED');
  assert.equal(result.stakeholders.hr.billable, false);
  assert.equal(result.stakeholders.finance.status, 'NOT_REQUIRED');
  assert.equal(result.stakeholders.finance.billable, false);
});

test('Scenario B: Solo CMD with 5 additional employee licenses', () => {
  const result = calculateLicenceBreakdown({
    cmdEmail: 'cmd@company.com',
    hrNotRequired: true,
    financeNotRequired: true,
    additionalLicenses: 5,
  });

  assert.equal(result.stakeholderCount, 1);
  assert.equal(result.additionalLicenses, 5);
  assert.equal(result.totalLicenses, 6);
});

test('Scenario C: Standard 3 Stakeholders (CMD, distinct HR, distinct Finance)', () => {
  const result = calculateLicenceBreakdown({
    cmdEmail: 'cmd@company.com',
    hrEmail: 'hr@company.com',
    hrNotRequired: false,
    financeEmail: 'finance@company.com',
    financeNotRequired: false,
    additionalLicenses: 0,
  });

  assert.equal(result.stakeholderCount, 3);
  assert.equal(result.totalLicenses, 3);
  assert.equal(result.stakeholders.cmd.billable, true);
  assert.equal(result.stakeholders.hr.billable, true);
  assert.equal(result.stakeholders.finance.billable, true);
});

test('Scenario D: One Employee Managing Both HR & Finance (1 person = 1 licence)', () => {
  const result = calculateLicenceBreakdown({
    cmdEmail: 'cmd@company.com',
    hrEmail: 'alex@company.com',
    hrNotRequired: false,
    financeEmail: 'alex@company.com', // same email!
    financeNotRequired: false,
    additionalLicenses: 0,
  });

  // Total unique actual users = CMD (1) + Alex (1) = 2, NOT 3!
  assert.equal(result.stakeholderCount, 2, 'Must count 2 unique users, not 3');
  assert.equal(result.totalLicenses, 2, 'Total licenses must be exactly 2');
  assert.equal(result.stakeholders.hr.billable, true);
  assert.equal(result.stakeholders.finance.status, 'COMBINED_WITH_HR');
  assert.equal(result.stakeholders.finance.billable, false);
});

test('Scenario E: One Employee Managing HR & Finance + 10 additional licenses', () => {
  const result = calculateLicenceBreakdown({
    cmdEmail: 'cmd@company.com',
    hrEmail: 'alex@company.com',
    financeEmail: 'alex@company.com',
    additionalLicenses: 10,
  });

  assert.equal(result.stakeholderCount, 2);
  assert.equal(result.additionalLicenses, 10);
  assert.equal(result.totalLicenses, 12);
});

test('Scenario F: CMD + Finance (HR Not Required)', () => {
  const result = calculateLicenceBreakdown({
    cmdEmail: 'cmd@company.com',
    hrNotRequired: true,
    financeEmail: 'finance@company.com',
    financeNotRequired: false,
    additionalLicenses: 0,
  });

  assert.equal(result.stakeholderCount, 2);
  assert.equal(result.totalLicenses, 2);
  assert.equal(result.stakeholders.hr.status, 'NOT_REQUIRED');
  assert.equal(result.stakeholders.finance.billable, true);
});

test('Scenario G: CMD + HR (Finance Not Required, CMD does direct payment)', () => {
  const result = calculateLicenceBreakdown({
    cmdEmail: 'cmd@company.com',
    hrEmail: 'hr@company.com',
    hrNotRequired: false,
    financeNotRequired: true,
    additionalLicenses: 0,
  });

  assert.equal(result.stakeholderCount, 2);
  assert.equal(result.totalLicenses, 2);
  assert.equal(result.stakeholders.hr.billable, true);
  assert.equal(result.stakeholders.finance.status, 'NOT_REQUIRED');
});

test('Dynamic Pricing Math: unit price 3999, GST 18%, 2 licenses', async () => {
  const pricing = await computeRegistrationPricing(
    {
      cmdEmail: 'cmd@company.com',
      hrEmail: 'alex@company.com',
      financeEmail: 'alex@company.com',
      additionalLicenses: 0,
    },
    {
      overrideUnitPrice: 3999,
      overrideGstRate: 0.18,
      taxEnabled: true,
    }
  );

  assert.equal(pricing.totalLicenses, 2);
  assert.equal(pricing.unitPrice, 3999);
  assert.equal(pricing.subtotalAmount, 7998); // 2 * 3999
  assert.equal(pricing.gstAmount, 1439.64); // 7998 * 0.18 = 1439.64
  assert.equal(pricing.totalAmount, 9437.64); // 7998 + 1439.64
});

test('Dynamic Pricing with Tax Disabled', async () => {
  const pricing = await computeRegistrationPricing(
    {
      cmdEmail: 'cmd@company.com',
      hrNotRequired: true,
      financeNotRequired: true,
      additionalLicenses: 0,
    },
    {
      overrideUnitPrice: 3999,
      taxEnabled: false,
    }
  );

  assert.equal(pricing.totalLicenses, 1);
  assert.equal(pricing.subtotalAmount, 3999);
  assert.equal(pricing.gstAmount, 0);
  assert.equal(pricing.totalAmount, 3999);
});

test('Registration Schema allows HR Not Required & Finance Not Required', () => {
  const validData = {
    companyName: 'Acme Technologies Pvt Ltd',
    companyType: 'Private Limited',
    domainName: 'acmetech.com',
    fullName: 'Rajesh Sharma',
    designation: 'CMD',
    email: 'rajesh@acmetech.com',
    password: 'Password123!@#',
    confirmPassword: 'Password123!@#',
    hrNotRequired: true,
    financeNotRequired: true,
    additionalLicenses: 0,
    acceptedTerms: true,
    verificationToken: 'token_12345',
  };

  const parsed = registrationSchema.safeParse(validData);
  assert.equal(parsed.success, true, parsed.error ? JSON.stringify(parsed.error.issues) : '');
});

test('Registration Schema allows same email for HR and Finance (1 employee for both)', () => {
  const validData = {
    companyName: 'Acme Technologies Pvt Ltd',
    companyType: 'Private Limited',
    domainName: 'acmetech.com',
    fullName: 'Rajesh Sharma',
    designation: 'CMD',
    email: 'rajesh@acmetech.com',
    password: 'Password123!@#',
    confirmPassword: 'Password123!@#',
    hrNotRequired: false,
    hrEmail: 'alex@acmetech.com',
    financeNotRequired: false,
    financeEmail: 'alex@acmetech.com', // identical email allowed!
    additionalLicenses: 2,
    acceptedTerms: true,
    verificationToken: 'token_12345',
  };

  const parsed = registrationSchema.safeParse(validData);
  assert.equal(parsed.success, true, parsed.error ? JSON.stringify(parsed.error.issues) : '');
});

