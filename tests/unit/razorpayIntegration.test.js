import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';

import { env } from '../../src/config/env.js';
import { prisma } from '../../src/lib/prisma.js';
import { handleRazorpayWebhook } from '../../src/controllers/webhook.controller.js';

test('Razorpay Payment Gateway Integration & Lifecycle Tests', async (t) => {
  await t.test('1. Razorpay Key ID and Secret configuration & Mode detection', () => {
    assert.ok(env.razorpayKeyId, 'RAZORPAY_KEY_ID should be configured');
    assert.ok(env.razorpayKeySecret, 'RAZORPAY_KEY_SECRET should be configured');

    const isTestMode = env.razorpayKeyId.startsWith('rzp_test_');
    const isLiveMode = env.razorpayKeyId.startsWith('rzp_live_');

    assert.ok(isTestMode || isLiveMode, 'Razorpay key ID must be either test or live prefix');

    if (isTestMode) {
      assert.match(env.razorpayKeyId, /^rzp_test_[a-zA-Z0-9]+$/);
    } else {
      assert.match(env.razorpayKeyId, /^rzp_live_[a-zA-Z0-9]+$/);
    }
  });

  await t.test('2. Cryptographic signature verification (HMAC SHA-256)', () => {
    const orderId = 'order_test_999999';
    const paymentId = 'pay_test_888888';
    const secret = env.razorpayKeySecret;

    // Generate valid HMAC SHA-256
    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    assert.ok(validSignature);
    assert.equal(validSignature.length, 64);

    // Verify matching
    const checkValid = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    assert.equal(checkValid, validSignature);

    // Mismatched signature
    const tamperedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|pay_tampered_0000`)
      .digest('hex');
    assert.notEqual(tamperedSignature, validSignature);

    // Tampered secret
    const wrongSecretSignature = crypto
      .createHmac('sha256', 'wrong_secret_key')
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    assert.notEqual(wrongSecretSignature, validSignature);
  });

  await t.test('3. Webhook signature validation and idempotency', async () => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || env.razorpayKeySecret;
    const eventId = `evt_test_${Date.now()}`;
    const payload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_test_${Date.now()}`,
            order_id: `order_test_${Date.now()}`,
            amount: 4718820,
            status: 'captured',
            notes: {},
          },
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // First webhook call: should process or record
    let resStatus = null;
    let resBody = null;
    const req1 = {
      headers: {
        'x-razorpay-signature': validSignature,
        'x-razorpay-event-id': eventId,
      },
      rawBody,
      body: payload,
    };
    const res1 = {
      status(s) {
        resStatus = s;
        return this;
      },
      json(data) {
        resBody = data;
        return this;
      },
    };

    await handleRazorpayWebhook(req1, res1);
    assert.equal(resStatus, 200);
    assert.equal(resBody.status, 'success');

    // Duplicate webhook call with same eventId: idempotent return
    let dupStatus = null;
    let dupBody = null;
    const res2 = {
      status(s) {
        dupStatus = s;
        return this;
      },
      json(data) {
        dupBody = data;
        return this;
      },
    };

    await handleRazorpayWebhook(req1, res2);
    assert.equal(dupStatus, 200);
    assert.equal(dupBody.status, 'already_processed');

    // Invalid signature: should reject with 400
    let errStatus = null;
    let errBody = null;
    const badReq = {
      headers: {
        'x-razorpay-signature': 'invalid_signature_hex_value',
        'x-razorpay-event-id': `evt_bad_${Date.now()}`,
      },
      rawBody,
      body: payload,
    };
    const badRes = {
      status(s) {
        errStatus = s;
        return this;
      },
      json(data) {
        errBody = data;
        return this;
      },
    };

    await handleRazorpayWebhook(badReq, badRes);
    assert.equal(errStatus, 400);
    assert.match(errBody.error, /invalid webhook signature/i);

    // Clean up test webhook records
    await prisma.webhookEvent.deleteMany({
      where: { eventId: { in: [eventId, `evt_bad_${Date.now()}`] } },
    });
  });

  await t.test('4. Webhook activates pending registration if browser disconnected', async () => {
    const timestamp = Date.now();
    const domain = `wh-test-${timestamp}.com`;
    const email = `cmd@${domain}`;

    // Create a mock pending registration
    const registration = await prisma.companyRegistration.create({
      data: {
        companyName: `Webhook Auto Co ${timestamp}`,
        companyType: 'Private Limited',
        domainName: domain,
        tenantCode: `WH${timestamp.toString().slice(-4)}`,
        fullName: 'Webhook Tester',
        designation: 'CMD',
        email,
        passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
        licenseQuantity: 5,
        unitPrice: 3999,
        subtotalAmount: 19995,
        gstRate: 0.18,
        gstAmount: 3599.1,
        totalAmount: 23594.1,
        acceptedTermsAt: new Date(),
        status: 'PENDING_FINANCE_REVIEW',
        hrNotRequired: true,
        financeNotRequired: true,
      },
    });

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || env.razorpayKeySecret;
    const eventId = `evt_wh_auto_${timestamp}`;
    const orderId = `order_wh_${timestamp}`;
    const paymentId = `pay_wh_${timestamp}`;

    const payload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 2359410,
            status: 'captured',
            notes: {
              registrationId: registration.id,
              companyName: registration.companyName,
            },
          },
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    let status = null;
    let body = null;
    const req = {
      headers: {
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
      },
      rawBody,
      body: payload,
    };
    const res = {
      status(s) {
        status = s;
        return this;
      },
      json(d) {
        body = d;
        return this;
      },
    };

    await handleRazorpayWebhook(req, res);
    assert.equal(status, 200);

    // Verify registration was automatically activated
    const activatedReg = await prisma.companyRegistration.findUnique({
      where: { id: registration.id },
    });
    assert.equal(activatedReg.status, 'ACTIVE');
    assert.equal(activatedReg.paymentMethod, 'ONLINE');
    assert.equal(activatedReg.transactionId, paymentId);
    assert.ok(activatedReg.paymentVerifiedAt);

    // Verify tenant was created
    const createdTenant = await prisma.tenant.findFirst({
      where: { registrationId: registration.id },
    });
    assert.ok(createdTenant);
    assert.equal(createdTenant.licenseLimit, 5);
    assert.equal(createdTenant.status, 'ACTIVE');

    // Clean up created test entities
    await prisma.subscription.deleteMany({ where: { tenantId: createdTenant.id } });
    await prisma.tenantUser.deleteMany({ where: { tenantId: createdTenant.id } });
    await prisma.platformAuditLog.deleteMany({ where: { tenantId: createdTenant.id } });
    await prisma.tenant.delete({ where: { id: createdTenant.id } });
    await prisma.webhookEvent.deleteMany({ where: { eventId } });
    await prisma.companyRegistration.delete({ where: { id: registration.id } });
  });
});
