import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCompanyName,
  validateFullName,
  validateDomainSyntax,
  validateOfficialEmailMatch,
  validatePassword,
  normalizeDomain,
} from '../../src/lib/mouValidation.js';
import {
  registrationSchema,
  otpRequestSchema,
  validateDomainSchema,
  validateOfficialEmailSchema,
} from '../../src/validations/registration.schema.js';

test('1. Company Name Validation', async (t) => {
  await t.test('accepts valid company names', () => {
    assert.equal(validateCompanyName('Shraddha Auro Mira').valid, true);
    assert.equal(validateCompanyName('Acme Technologies Pvt Ltd').valid, true);
    assert.equal(validateCompanyName('L&T Infotech').valid, true);
  });

  await t.test('rejects email addresses as company name', () => {
    const res = validateCompanyName('pratikparida225@gmail.com');
    assert.equal(res.valid, false);
    assert.match(res.message, /cannot be an email address/i);
  });

  await t.test('rejects URLs as company name', () => {
    const res = validateCompanyName('https://acme.com');
    assert.equal(res.valid, false);
    assert.match(res.message, /cannot be a website URL/i);
  });

  await t.test('rejects too short or empty company names', () => {
    assert.equal(validateCompanyName('').valid, false);
    assert.equal(validateCompanyName('A').valid, false);
  });
});

test('2. CMD Contact Full Name Validation', async (t) => {
  await t.test('accepts valid person names with spaces, dots, hyphens, apostrophes', () => {
    assert.equal(validateFullName('Rajesh Kumar').valid, true);
    assert.equal(validateFullName('Rajesh Kumar Singh').valid, true);
    assert.equal(validateFullName('Jean-Luc O\'Connor').valid, true);
    assert.equal(validateFullName('R. K. Sharma').valid, true);
  });

  await t.test('rejects email addresses as full name', () => {
    const res = validateFullName('pratikparida225@gmail.com');
    assert.equal(res.valid, false);
    assert.match(res.message, /cannot be an email address/i);
  });

  await t.test('rejects numbers-only as full name', () => {
    const res = validateFullName('123456789');
    assert.equal(res.valid, false);
    assert.match(res.message, /cannot be numbers only/i);
  });

  await t.test('rejects URLs as full name', () => {
    const res = validateFullName('www.google.com');
    assert.equal(res.valid, false);
    assert.match(res.message, /cannot be a website URL/i);
  });

  await t.test('rejects invalid symbols in full name', () => {
    const res = validateFullName('Rajesh <script>');
    assert.equal(res.valid, false);
    assert.match(res.message, /invalid special characters/i);
  });
});

test('3. Company Domain Syntax & Webmail Validation', async (t) => {
  await t.test('accepts valid company domains and normalizes correctly', () => {
    const res1 = validateDomainSyntax('shraddhaauromira.com');
    assert.equal(res1.valid, true);
    assert.equal(res1.normalizedDomain, 'shraddhaauromira.com');

    const res2 = validateDomainSyntax('https://WWW.MyCompany.CO.IN/');
    assert.equal(res2.valid, true);
    assert.equal(res2.normalizedDomain, 'mycompany.co.in');
  });

  await t.test('rejects garbage domain without dot/TLD (e.g. from user screenshot)', () => {
    const res = validateDomainSyntax('kruthkrtghkhfrgkhrgfh4trg');
    assert.equal(res.valid, false);
    assert.match(res.message, /invalid domain syntax/i);
  });

  await t.test('rejects public free webmail domains for company domain', () => {
    const gmailRes = validateDomainSyntax('gmail.com');
    assert.equal(gmailRes.valid, false);
    assert.match(gmailRes.message, /public email providers/i);

    const yahooRes = validateDomainSyntax('yahoo.com');
    assert.equal(yahooRes.valid, false);
    assert.match(yahooRes.message, /public email providers/i);

    const outlookRes = validateDomainSyntax('outlook.com');
    assert.equal(outlookRes.valid, false);
    assert.match(outlookRes.message, /public email providers/i);
  });
});

test('4. Official Email vs Company Domain Matching', async (t) => {
  const targetDomain = 'shraddhaauromira.com';

  await t.test('allows email matching exact company domain', () => {
    const res1 = validateOfficialEmailMatch('rajesh@shraddhaauromira.com', targetDomain);
    assert.equal(res1.valid, true);

    const res2 = validateOfficialEmailMatch('administrator@shraddhaauromira.com', targetDomain);
    assert.equal(res2.valid, true);
  });

  await t.test('rejects personal webmail domains (gmail, yahoo, outlook)', () => {
    const res = validateOfficialEmailMatch('rajesh@gmail.com', targetDomain);
    assert.equal(res.valid, false);
    assert.match(res.message, /public personal email accounts.*shraddhaauromira\.com/i);
  });

  await t.test('rejects subdomains of company domain', () => {
    const res = validateOfficialEmailMatch('rajesh@sub.shraddhaauromira.com', targetDomain);
    assert.equal(res.valid, false);
    assert.match(res.message, /subdomains.*are not permitted/i);
  });

  await t.test('rejects unrelated company domains', () => {
    const res = validateOfficialEmailMatch('rajesh@anothercompany.com', targetDomain);
    assert.equal(res.valid, false);
    assert.match(res.message, /shraddhaauromira\.com/i);
  });
});

test('5. Password Security & Checklist', async (t) => {
  await t.test('accepts strong compliant password', () => {
    const res = validatePassword('SecurePass@2026');
    assert.equal(res.valid, true);
    assert.equal(res.checks.minLength, true);
    assert.equal(res.checks.hasUpper, true);
    assert.equal(res.checks.hasLower, true);
    assert.equal(res.checks.hasNumber, true);
    assert.equal(res.checks.hasSpecial, true);
    assert.equal(res.checks.noWhitespace, true);
    assert.equal(res.strength, 'Strong');
  });

  await t.test('rejects password missing uppercase', () => {
    const res = validatePassword('securepass@2026');
    assert.equal(res.valid, false);
    assert.equal(res.checks.hasUpper, false);
    assert.match(res.message, /uppercase/i);
  });

  await t.test('rejects password missing special characters', () => {
    const res = validatePassword('SecurePass2026');
    assert.equal(res.valid, false);
    assert.equal(res.checks.hasSpecial, false);
    assert.match(res.message, /special character/i);
  });

  await t.test('rejects password with leading or trailing whitespace', () => {
    const res = validatePassword(' SecurePass@2026 ');
    assert.equal(res.valid, false);
    assert.equal(res.checks.noWhitespace, false);
    assert.match(res.message, /spaces/i);
  });

  await t.test('rejects password shorter than 8 characters', () => {
    const res = validatePassword('Sec@1');
    assert.equal(res.valid, false);
    assert.equal(res.checks.minLength, false);
    assert.match(res.message, /at least 8 characters/i);
  });
});

test('6. Zod Registration Schema Validation', async (t) => {
  await t.test('validates complete valid registration payload', () => {
    const validPayload = {
      companyName: 'Shraddha Auro Mira',
      companyType: 'Private Limited',
      domainName: 'shraddhaauromira.com',
      fullName: 'Rajesh Kumar',
      designation: 'CMD',
      email: 'rajesh@shraddhaauromira.com',
      password: 'SecurePassword@123',
      confirmPassword: 'SecurePassword@123',
      financeEmail: 'finance@shraddhaauromira.com',
      hrEmail: 'hr@shraddhaauromira.com',
      acceptedTerms: true,
      verificationToken: 'valid-test-token-12345',
    };
    const parsed = registrationSchema.safeParse(validPayload);
    assert.equal(parsed.success, true);
  });

  await t.test('rejects registration with email matching wrong domain', () => {
    const invalidPayload = {
      companyName: 'Shraddha Auro Mira',
      companyType: 'Private Limited',
      domainName: 'shraddhaauromira.com',
      fullName: 'Rajesh Kumar',
      designation: 'CMD',
      email: 'rajesh@gmail.com', // Mismatch!
      password: 'SecurePassword@123',
      confirmPassword: 'SecurePassword@123',
      financeEmail: 'finance@shraddhaauromira.com',
      hrEmail: 'hr@shraddhaauromira.com',
      acceptedTerms: true,
      verificationToken: 'valid-test-token-12345',
    };
    const parsed = registrationSchema.safeParse(invalidPayload);
    assert.equal(parsed.success, false);
  });

  await t.test('rejects registration with email in full name', () => {
    const invalidPayload = {
      companyName: 'Shraddha Auro Mira',
      companyType: 'Private Limited',
      domainName: 'shraddhaauromira.com',
      fullName: 'pratikparida225@gmail.com', // Email in full name!
      designation: 'CMD',
      email: 'rajesh@shraddhaauromira.com',
      password: 'SecurePassword@123',
      confirmPassword: 'SecurePassword@123',
      financeEmail: 'finance@shraddhaauromira.com',
      hrEmail: 'hr@shraddhaauromira.com',
      acceptedTerms: true,
      verificationToken: 'valid-test-token-12345',
    };
    const parsed = registrationSchema.safeParse(invalidPayload);
    assert.equal(parsed.success, false);
  });
});

