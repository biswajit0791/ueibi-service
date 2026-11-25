import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import {
  updateRegistrationRecipientEmail,
  sendRegistrationRoleLink,
} from '../../src/controllers/platform.controller.js';

test.describe('Editable HR & Finance Recipient Email Suite', () => {
  let testRegId = null;
  const initialPrimaryEmail = `director-${Date.now()}@example.com`;
  const initialHrEmail = `hr-old-${Date.now()}@example.com`;
  const initialFinanceEmail = `finance-old-${Date.now()}@example.com`;

  test.before(async () => {
    // Create a mock CompanyRegistration
    const reg = await prisma.companyRegistration.create({
      data: {
        companyName: 'Test Recipient Email Corp',
        companyType: 'Private Limited',
        domainName: `test-email-${Date.now()}.com`,
        tenantCode: `TRE${Date.now().toString().slice(-4)}`,
        fullName: 'Test Director',
        designation: 'Director',
        email: initialPrimaryEmail,
        hrEmail: initialHrEmail,
        financeEmail: initialFinanceEmail,
        passwordHash: '$2b$10$hashedpassword1234567890',
        licenseQuantity: 5,
        unitPrice: 2000,
        subtotalAmount: 10000,
        gstRate: 0.18,
        gstAmount: 1800,
        totalAmount: 11800,
        status: 'PENDING_FINANCE_REVIEW',
        paymentStatus: 'PENDING',
        acceptedTermsAt: new Date(),
      },
    });
    testRegId = reg.id;

    // Create an initial active action token for HR
    await prisma.registrationActionToken.create({
      data: {
        registrationId: testRegId,
        role: 'HR',
        tokenHash: `test-token-hash-hr-${Date.now()}`,
        expiresAt: new Date(Date.now() + 86400000), // 24 hours in future
      },
    });
  });

  test.after(async () => {
    if (testRegId) {
      await prisma.registrationActionToken.deleteMany({ where: { registrationId: testRegId } }).catch(() => {});
      await prisma.platformAuditLog.deleteMany({ where: { targetId: testRegId } }).catch(() => {});
      await prisma.notificationLog.deleteMany({ where: { registrationId: testRegId } }).catch(() => {});
      await prisma.companyRegistration.delete({ where: { id: testRegId } }).catch(() => {});
    }
  });

  test('1. Rejects invalid email syntax with HTTP 400', async () => {
    let statusCode = null;
    let jsonResult = null;
    const req = {
      params: { id: testRegId },
      body: { role: 'HR', email: 'not-a-valid-email' },
      user: { id: 'PLATFORM_OWNER' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResult = data; return this; },
    };

    await updateRegistrationRecipientEmail(req, res, (err) => { if (err) throw err; });
    assert.equal(statusCode, 400, 'Expected 400 Bad Request');
    assert.ok(jsonResult?.error, 'Should return validation error');
  });

  test('2. Rejects invalid role with HTTP 400', async () => {
    let statusCode = null;
    let jsonResult = null;
    const req = {
      params: { id: testRegId },
      body: { role: 'UNKNOWN_ROLE', email: 'valid@example.com' },
      user: { id: 'PLATFORM_OWNER' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResult = data; return this; },
    };

    await updateRegistrationRecipientEmail(req, res, (err) => { if (err) throw err; });
    assert.equal(statusCode, 400, 'Expected 400 Bad Request');
  });

  test('3. Updates HR email independently without altering primary email or finance email', async () => {
    const newHrEmail = `hr-new-${Date.now()}@example.com`;
    let statusCode = null;
    let jsonResult = null;
    const req = {
      params: { id: testRegId },
      body: { role: 'HR', email: newHrEmail, sendLinkImmediately: false },
      user: { id: 'PLATFORM_OWNER' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResult = data; return this; },
    };

    await updateRegistrationRecipientEmail(req, res, (err) => { if (err) throw err; });
    assert.equal(statusCode, null, 'Expected default 200 OK');
    assert.equal(jsonResult?.success, true);
    assert.equal(jsonResult?.role, 'HR');
    assert.equal(jsonResult?.email, newHrEmail);

    // Verify DB persistence
    const reg = await prisma.companyRegistration.findUnique({ where: { id: testRegId } });
    assert.equal(reg.hrEmail, newHrEmail, 'HR email must be updated');
    assert.equal(reg.email, initialPrimaryEmail, 'Primary company email must NOT be modified');
    assert.equal(reg.financeEmail, initialFinanceEmail, 'Finance email must remain independent');

    // Verify previous pending HR token was invalidated
    const tokens = await prisma.registrationActionToken.findMany({
      where: { registrationId: testRegId, role: 'HR' },
    });
    for (const t of tokens) {
      assert.ok(new Date(t.expiresAt).getTime() <= Date.now() + 5000, 'Previous pending token should be expired/invalidated');
    }

    // Verify Audit Trail entry was written
    const audit = await prisma.platformAuditLog.findFirst({
      where: {
        targetId: testRegId,
        action: 'REGISTRATION_RECIPIENT_EMAIL_UPDATED',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(audit, 'Audit log entry must be created');
    assert.equal(audit.afterValue?.email, newHrEmail);
    assert.equal(audit.beforeValue?.email, initialHrEmail);
  });

  test('4. Updates Finance email independently and sends link immediately', async () => {
    const newFinanceEmail = `finance-new-${Date.now()}@example.com`;
    let statusCode = null;
    let jsonResult = null;
    const req = {
      params: { id: testRegId },
      body: { role: 'FINANCE', email: newFinanceEmail, sendLinkImmediately: true },
      user: { id: 'PLATFORM_OWNER' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResult = data; return this; },
    };

    await updateRegistrationRecipientEmail(req, res, (err) => { if (err) throw err; });
    assert.equal(statusCode, null);
    assert.equal(jsonResult?.success, true);
    assert.equal(jsonResult?.role, 'FINANCE');
    assert.equal(jsonResult?.email, newFinanceEmail);
    assert.equal(jsonResult?.linkSent, true);

    // Verify DB
    const reg = await prisma.companyRegistration.findUnique({ where: { id: testRegId } });
    assert.equal(reg.financeEmail, newFinanceEmail);
    assert.equal(reg.email, initialPrimaryEmail);

    // Verify a fresh valid token was minted for FINANCE
    const activeFinanceToken = await prisma.registrationActionToken.findFirst({
      where: { registrationId: testRegId, role: 'FINANCE', expiresAt: { gt: new Date() } },
    });
    assert.ok(activeFinanceToken, 'A fresh unexpired action token must exist for FINANCE');
  });

  test('5. sendRegistrationRoleLink sends to newly updated recipient email', async () => {
    let jsonResult = null;
    const req = {
      params: { id: testRegId },
      body: { target: 'FINANCE' },
      user: { id: 'PLATFORM_OWNER' },
    };
    const res = {
      status() { return this; },
      json(data) { jsonResult = data; return this; },
    };

    await sendRegistrationRoleLink(req, res, (err) => { if (err) throw err; });
    assert.equal(jsonResult?.success, true);
    assert.ok(jsonResult?.recipient.includes('finance-new'), 'Recipient should be the updated Finance email');
  });
});
