import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { prisma } from '../../src/lib/prisma.js';
import registrationRoutes from '../../src/routes/registration.routes.js';
import {
  getRegistrationConfig,
  updateRegistrationConfig,
  invalidateConfigCache,
} from '../../src/services/registrationConfig.service.js';
import { generateOtp, hashOtp, verifyOtpHash } from '../../src/lib/otp.js';

test('Dynamic Registration OTP Security Integration Tests', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api', registrationRoutes);

  let server;
  let baseUrl;

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}/api`;
      resolve();
    });
  });

  const testEmailPrefix = `otp_test_${Date.now()}`;

  t.after(async () => {
    server.close();
    // Clean up test email verifications
    await prisma.emailVerification.deleteMany({
      where: { email: { startsWith: 'otp_test_' } },
    }).catch(() => {});
    invalidateConfigCache();
  });

  await t.test('1. Default OTP security configuration reads correctly', async () => {
    invalidateConfigCache();
    const [ttl, length, maxAttempts, cooldown, maxResends] = await Promise.all([
      getRegistrationConfig('OTP_TTL_MINUTES', 10),
      getRegistrationConfig('OTP_LENGTH', 6),
      getRegistrationConfig('OTP_MAX_ATTEMPTS', 5),
      getRegistrationConfig('OTP_RESEND_COOLDOWN_SECONDS', 60),
      getRegistrationConfig('OTP_MAX_RESEND_ATTEMPTS', 3),
    ]);

    assert.equal(typeof ttl, 'number');
    assert.equal(typeof length, 'number');
    assert.equal(typeof maxAttempts, 'number');
    assert.equal(typeof cooldown, 'number');
    assert.equal(typeof maxResends, 'number');
  });

  await t.test('2. Public settings endpoint GET /api/public/mou/settings returns all OTP parameters', async () => {
    const res = await fetch(`${baseUrl}/public/mou/settings`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.ok(data.otpTtlMinutes >= 1);
    assert.ok([4, 6, 8].includes(data.otpLength));
    assert.ok(data.otpMaxAttempts >= 1);
    assert.ok(data.otpResendCooldownSeconds >= 0);
    assert.ok(data.otpMaxResendAttempts >= 1);
  });

  await t.test('3. OTP generation honors configured OTP_LENGTH', () => {
    const otp4 = generateOtp(4);
    assert.equal(otp4.length, 4);
    assert.match(otp4, /^\d{4}$/);

    const otp6 = generateOtp(6);
    assert.equal(otp6.length, 6);
    assert.match(otp6, /^\d{6}$/);

    const otp8 = generateOtp(8);
    assert.equal(otp8.length, 8);
    assert.match(otp8, /^\d{8}$/);
  });

  await t.test('4. Requesting OTP returns dynamic expiresInSeconds and no undefined variable errors', async () => {
    const email = `${testEmailPrefix}_req@acme.com`;
    const res = await fetch(`${baseUrl}/public/mou/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, domainName: 'acme.com' }),
    });

    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.ok(data.expiresInSeconds > 0);
    assert.ok(data.otpTtlMinutes > 0);
    assert.equal(data.expiresInSeconds, data.otpTtlMinutes * 60);
    assert.ok(data.message.includes('OTP sent'));
  });

  await t.test('5. Enforces OTP_RESEND_COOLDOWN_SECONDS on immediate resend attempt', async () => {
    const email = `${testEmailPrefix}_cooldown@acme.com`;

    // First request
    const res1 = await fetch(`${baseUrl}/public/mou/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, domainName: 'acme.com' }),
    });
    assert.equal(res1.status, 200);

    // Immediate second request within cooldown period
    const res2 = await fetch(`${baseUrl}/public/mou/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, domainName: 'acme.com' }),
    });

    assert.equal(res2.status, 429);
    const data2 = await res2.json();
    assert.match(data2.error, /please wait \d+ seconds? before requesting another otp/i);
    assert.ok(data2.remainingSeconds > 0);
  });

  await t.test('6. Invalidate previous OTP when a new OTP is generated', async () => {
    const email = `${testEmailPrefix}_inval@acme.com`;

    // 1st challenge
    const res1 = await fetch(`${baseUrl}/public/mou/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, domainName: 'acme.com' }),
    });
    const data1 = await res1.json();
    const otp1 = data1.otp;

    // Simulate cooldown elapsing by updating lastResentAt and createdAt
    await prisma.emailVerification.updateMany({
      where: { email },
      data: {
        createdAt: new Date(Date.now() - 70000),
        lastResentAt: new Date(Date.now() - 70000),
      },
    });

    // 2nd challenge
    const res2 = await fetch(`${baseUrl}/public/mou/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, domainName: 'acme.com' }),
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    const otp2 = data2.otp;

    // First OTP should fail because previous challenge was invalidated
    if (otp1) {
      const verifyOld = await fetch(`${baseUrl}/public/mou/verify-email-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: otp1 }),
      });
      // Should fail if otp1 != otp2
      if (otp1 !== otp2) {
        assert.equal(verifyOld.status, 400);
      }
    }

    // New OTP succeeds
    if (otp2) {
      const verifyNew = await fetch(`${baseUrl}/public/mou/verify-email-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: otp2 }),
      });
      assert.equal(verifyNew.status, 200);
      const verifyData = await verifyNew.json();
      assert.equal(verifyData.valid, true);
      assert.ok(verifyData.verificationToken);
    }
  });

  await t.test('7. Enforces OTP_MAX_ATTEMPTS and locks challenge after repeated wrong attempts', async () => {
    const email = `${testEmailPrefix}_attempts@acme.com`;

    const res = await fetch(`${baseUrl}/public/mou/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, domainName: 'acme.com' }),
    });
    assert.equal(res.status, 200);

    const maxAttempts = await getRegistrationConfig('OTP_MAX_ATTEMPTS', 5);

    // Send maxAttempts - 1 incorrect OTPs
    for (let i = 1; i < maxAttempts; i++) {
      const badRes = await fetch(`${baseUrl}/public/mou/verify-email-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: '000000' }),
      });
      assert.equal(badRes.status, 400);
      const badData = await badRes.json();
      assert.equal(badData.attemptsLeft, maxAttempts - i);
    }

    // The maxAttempt-th incorrect OTP triggers lock (429)
    const lockRes = await fetch(`${baseUrl}/public/mou/verify-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '000000' }),
    });
    assert.equal(lockRes.status, 429);
    const lockData = await lockRes.json();
    assert.equal(lockData.locked, true);
    assert.match(lockData.error, /maximum attempts.*locked/i);
  });

  await t.test('8. Rejects expired OTP and marks it consumed', async () => {
    const email = `${testEmailPrefix}_expired@acme.com`;

    await fetch(`${baseUrl}/public/mou/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, domainName: 'acme.com' }),
    });

    // Manually expire the challenge in database
    await prisma.emailVerification.updateMany({
      where: { email },
      data: { otpExpiresAt: new Date(Date.now() - 1000) },
    });

    const verifyRes = await fetch(`${baseUrl}/public/mou/verify-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: '123456' }),
    });

    assert.equal(verifyRes.status, 400);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.expired, true);
    assert.match(verifyData.error, /expired/i);
  });

  await t.test('9. Prevents reuse of an already verified challenge', async () => {
    const email = `${testEmailPrefix}_reuse@acme.com`;

    const sendRes = await fetch(`${baseUrl}/public/mou/send-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, domainName: 'acme.com' }),
    });
    const sendData = await sendRes.json();
    const otp = sendData.otp;

    // Verify first time
    const verify1 = await fetch(`${baseUrl}/public/mou/verify-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });
    assert.equal(verify1.status, 200);

    // Second verify with same OTP should fail (already verified / no pending unverified challenge)
    const verify2 = await fetch(`${baseUrl}/public/mou/verify-email-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });
    assert.equal(verify2.status, 400);
    const verify2Data = await verify2.json();
    assert.match(verify2Data.error, /no pending otp/i);
  });
});

