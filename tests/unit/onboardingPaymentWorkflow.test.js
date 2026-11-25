import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { confirmPaymentRegistration, listOnboarding } from '../../src/controllers/platform.controller.js';
import { activateTenantFromRegistration } from '../../src/services/tenantActivation.service.js';

test.describe('Onboarding Payment Workflow & Persistence Suite', () => {
  let testRegId = null;
  let testCompanyDomain = `test-payment-${Date.now()}.com`;

  test.before(async () => {
    // Create a mock CompanyRegistration in PENDING_FINANCE_REVIEW state
    const reg = await prisma.companyRegistration.create({
      data: {
        companyName: 'Test Payment Corp',
        companyType: 'Private Limited',
        domainName: testCompanyDomain,
        tenantCode: `TPC${Date.now().toString().slice(-4)}`,
        fullName: 'Test Director',
        designation: 'Director',
        email: `director-${Date.now()}@example.com`,
        passwordHash: '$2b$10$hashedpassword1234567890',
        licenseQuantity: 10,
        unitPrice: 3999,
        subtotalAmount: 39990,
        gstRate: 0.18,
        gstAmount: 7198.2,
        totalAmount: 47188.2,
        status: 'PENDING_FINANCE_REVIEW',
        paymentStatus: 'PENDING',
        acceptedTermsAt: new Date(),
      },
    });
    testRegId = reg.id;
  });

  test.after(async () => {
    if (testRegId) {
      // Clean up tenant, subscription, payments, invoice, users, and registration
      const tenant = await prisma.tenant.findFirst({ where: { registrationId: testRegId } });
      if (tenant) {
        await prisma.payment.deleteMany({ where: { tenantId: tenant.id } });
        await prisma.invoice.deleteMany({ where: { tenantId: tenant.id } });
        await prisma.subscription.deleteMany({ where: { tenantId: tenant.id } });
        await prisma.tenantSettings.deleteMany({ where: { tenantId: tenant.id } });
        await prisma.tenantUser.deleteMany({ where: { tenantId: tenant.id } });
        await prisma.tenant.delete({ where: { id: tenant.id } });
      }
      await prisma.companyRegistration.delete({ where: { id: testRegId } }).catch(() => {});
    }
  });

  test('1. Rejects invalid payment mode with HTTP 400', async () => {
    let statusCode = null;
    let jsonResult = null;
    const req = {
      params: { id: testRegId },
      body: { paymentMethod: 'BITCOIN_INVALID' },
      user: { id: 'PLATFORM_OWNER' },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonResult = data;
        return this;
      },
    };
    const next = (err) => { if (err) throw err; };

    await confirmPaymentRegistration(req, res, next);
    assert.equal(statusCode, 400);
    assert.match(jsonResult.error, /Invalid payment mode/);
  });

  test('2. Bank Transfer requires transaction reference / UTR', async () => {
    let statusCode = null;
    let jsonResult = null;
    const req = {
      params: { id: testRegId },
      body: { paymentMethod: 'BANK_TRANSFER', transactionReference: '' },
      user: { id: 'PLATFORM_OWNER' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResult = data; return this; },
    };
    const next = (err) => { if (err) throw err; };

    await confirmPaymentRegistration(req, res, next);
    assert.equal(statusCode, 400);
    assert.match(jsonResult.error, /requires a valid transaction reference/);
  });

  test('3. Confirms payment with CASH without requiring UTR and persists CASH mode', async () => {
    let statusCode = null;
    let jsonResult = null;
    const req = {
      params: { id: testRegId },
      body: {
        paymentMethod: 'CASH',
        transactionReference: '', // Cash has no UTR
        paymentDate: '2026-11-25',
        amount: 47188.2,
        remarks: 'Collected at counter with receipt #0041',
      },
      user: { id: 'PLATFORM_OWNER' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { jsonResult = data; return this; },
    };
    const next = (err) => { if (err) throw err; };

    await confirmPaymentRegistration(req, res, next);
    assert.equal(jsonResult.success, true);
    assert.equal(jsonResult.paymentMethod, 'CASH');
    assert.equal(jsonResult.paymentStatus, 'COMPLETED');

    // Verify in database that paymentMethod is CASH and NOT overwritten to ONLINE
    const updated = await prisma.companyRegistration.findUnique({
      where: { id: testRegId },
      include: { tenant: { include: { invoices: true } } },
    });
    assert.equal(updated.paymentMethod, 'CASH');
    assert.equal(updated.paymentStatus, 'COMPLETED');
    assert.equal(updated.status, 'ACTIVE');
    assert.ok(updated.paymentVerifiedAt != null);

    // Verify tenant and invoice were created with PAID status
    assert.ok(updated.tenant != null);
    const invoice = updated.tenant.invoices[0];
    assert.ok(invoice != null);
    assert.equal(invoice.state, 'PAID');

    // Verify Payment table record has method CASH
    const payment = await prisma.payment.findFirst({
      where: { invoiceId: invoice.id },
    });
    assert.ok(payment != null);
    assert.equal(payment.method, 'CASH');
  });

  test('4. listOnboarding returns genuine paymentStatus without synthetic fallback', async () => {
    // Create an active company registration with PENDING paymentStatus
    const domain2 = `test-pending-${Date.now()}.com`;
    const pendingReg = await prisma.companyRegistration.create({
      data: {
        companyName: 'Pending Pay Corp',
        companyType: 'Private Limited',
        domainName: domain2,
        tenantCode: `PPC${Date.now().toString().slice(-4)}`,
        fullName: 'Pending Director',
        designation: 'Director',
        email: `pending-${Date.now()}@example.com`,
        passwordHash: '$2b$10$hashedpassword1234567890',
        licenseQuantity: 5,
        totalAmount: 23594.1,
        status: 'ACTIVE', // Company is active
        paymentStatus: 'PENDING', // But payment is still pending!
        acceptedTermsAt: new Date(),
      },
    });

    try {
      let jsonResult = null;
      const req = {
        query: { search: domain2 },
      };
      const res = {
        json(data) { jsonResult = data; return this; },
      };
      const next = (err) => { if (err) throw err; };

      await listOnboarding(req, res, next);
      assert.ok(jsonResult.items != null);
      const item = jsonResult.items.find((i) => i.domainName === domain2);
      assert.ok(item != null);
      // It must NOT be fabricated to COMPLETED; it must accurately reflect PENDING
      assert.equal(item.paymentStatus, 'PENDING');
    } finally {
      await prisma.companyRegistration.delete({ where: { id: pendingReg.id } }).catch(() => {});
    }
  });
});
