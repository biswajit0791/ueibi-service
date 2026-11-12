import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/lib/prisma.js';
import {
  maskEmail,
  initiateLoginChallenge,
  verifyLoginChallenge,
  resendLoginChallenge,
  is2FAEnforcedForUser,
} from '../../src/services/login2fa.service.js';
import { verifyToken } from '../../src/lib/jwt.js';

describe('Login Two-Factor Authentication (2FA) Integration Tests', () => {
  const timestamp = Date.now();
  const testTenantCode = `2fa-test-${timestamp}`;
  const testDomain = `2fa-${timestamp}.com`;
  const testEmail = `cmd@${testDomain}`;
  const rawPassword = 'Password123!';

  let createdTenant;
  let createdUser;

  before(async () => {
    // Create test tenant and user
    createdTenant = await prisma.tenant.create({
      data: {
        companyName: `2FA Test Org ${timestamp}`,
        domainName: testDomain,
        tenantCode: testTenantCode,
        status: 'ACTIVE',
      },
    });

    const passwordHash = await bcrypt.hash(rawPassword, 10);
    createdUser = await prisma.tenantUser.create({
      data: {
        tenantId: createdTenant.id,
        email: testEmail,
        passwordHash,
        name: 'CMD 2FA Tester',
        role: 'CMD',
        status: 'ACTIVE',
      },
      include: { tenant: true },
    });
  });

  after(async () => {
    // Cleanup
    await prisma.loginChallenge.deleteMany({
      where: { userId: createdUser.id },
    }).catch(() => {});
    await prisma.tenantUser.delete({
      where: { id: createdUser.id },
    }).catch(() => {});
    await prisma.tenant.delete({
      where: { id: createdTenant.id },
    }).catch(() => {});
  });

  test('1. maskEmail masks emails securely', () => {
    assert.equal(maskEmail('pratik@shraddhaauromira.com'), 'pr****@shraddhaauromira.com');
    assert.equal(maskEmail('alex@karyam.io'), 'a****@karyam.io');
    assert.equal(maskEmail('john.doe@company.org'), 'jo****@company.org');
  });

  test('2. is2FAEnforcedForUser correctly evaluates user', async () => {
    const isEnforced = await is2FAEnforcedForUser(createdUser);
    assert.equal(isEnforced, true, 'Default configuration should enforce 2FA');
  });

  test('3. initiateLoginChallenge creates challenge and never stores plaintext OTP', async () => {
    const challenge = await initiateLoginChallenge({
      user: createdUser,
      req: { ip: '127.0.0.1', headers: { 'user-agent': 'NodeTestAgent' } },
    });

    assert.equal(challenge.requires2FA, true);
    assert.ok(challenge.challengeId);
    assert.ok(challenge.maskedEmail.includes('****'));
    assert.equal(challenge.otpLength, 6);

    const record = await prisma.loginChallenge.findUnique({
      where: { id: challenge.challengeId },
    });

    assert.ok(record, 'Record exists in database');
    assert.equal(record.purpose, 'LOGIN_2FA');
    assert.equal(record.attempts, 0);
    assert.equal(record.isLocked, false);
    assert.equal(record.consumedAt, null);
    // Verify plaintext is not stored
    assert.ok(record.otpHash.length >= 64, 'otpHash must be SHA-256 hash');
  });

  test('4. verifyLoginChallenge rejects invalid OTP and decrements remaining attempts', async () => {
    const challenge = await initiateLoginChallenge({
      user: createdUser,
      req: { ip: '127.0.0.1' },
    });

    await assert.rejects(
      async () => {
        await verifyLoginChallenge({
          challengeId: challenge.challengeId,
          otp: '000000',
        });
      },
      (err) => {
        assert.ok(err.message.includes('Invalid verification code'));
        assert.equal(err.remainingAttempts, 4);
        return true;
      }
    );

    const record = await prisma.loginChallenge.findUnique({
      where: { id: challenge.challengeId },
    });
    assert.equal(record.attempts, 1);
  });

  test('5. verifyLoginChallenge locks challenge after maximum attempts', async () => {
    const challenge = await initiateLoginChallenge({
      user: createdUser,
      req: { ip: '127.0.0.1' },
    });

    // Artificially set attempts to 4 of 5
    await prisma.loginChallenge.update({
      where: { id: challenge.challengeId },
      data: { attempts: 4 },
    });

    // 5th wrong attempt
    await assert.rejects(
      async () => {
        await verifyLoginChallenge({
          challengeId: challenge.challengeId,
          otp: '999999',
        });
      },
      (err) => {
        assert.ok(err.message.includes('Maximum verification attempts reached'));
        assert.equal(err.isLocked, true);
        return true;
      }
    );

    const record = await prisma.loginChallenge.findUnique({
      where: { id: challenge.challengeId },
    });
    assert.equal(record.isLocked, true);
  });

  test('6. verifyLoginChallenge rejects expired OTP', async () => {
    const challenge = await initiateLoginChallenge({
      user: createdUser,
      req: { ip: '127.0.0.1' },
    });

    // Set expiry in the past
    await prisma.loginChallenge.update({
      where: { id: challenge.challengeId },
      data: { otpExpiresAt: new Date(Date.now() - 1000) },
    });

    await assert.rejects(
      async () => {
        await verifyLoginChallenge({
          challengeId: challenge.challengeId,
          otp: challenge.devOtp || '123456',
        });
      },
      (err) => {
        assert.ok(err.message.includes('expired'));
        return true;
      }
    );
  });

  test('7. verifyLoginChallenge succeeds with correct OTP, issues JWT, and prevents reuse', async () => {
    const challenge = await initiateLoginChallenge({
      user: createdUser,
      req: { ip: '127.0.0.1' },
    });

    const validOtp = challenge.devOtp;
    assert.ok(validOtp, 'devOtp available in test environment');

    const result = await verifyLoginChallenge({
      challengeId: challenge.challengeId,
      otp: validOtp,
    });

    assert.ok(result.token, 'JWT token must be issued on successful OTP verification');
    assert.ok(result.user, 'User payload must be returned');
    assert.equal(result.user.email, createdUser.email);
    assert.equal(result.user.role, 'CMD');

    // Verify token validity
    const decoded = verifyToken(result.token);
    assert.ok(decoded);
    assert.equal(decoded.userId, createdUser.id);

    // Verify record is marked consumed
    const record = await prisma.loginChallenge.findUnique({
      where: { id: challenge.challengeId },
    });
    assert.ok(record.consumedAt, 'Challenge must be marked consumed');
    assert.ok(record.verifiedAt, 'Challenge must have verifiedAt timestamp');

    // Attempt reuse - must fail
    await assert.rejects(
      async () => {
        await verifyLoginChallenge({
          challengeId: challenge.challengeId,
          otp: validOtp,
        });
      },
      (err) => {
        assert.ok(err.message.includes('already been used'));
        return true;
      }
    );
  });

  test('8. resendLoginChallenge enforces cooldown and maximum resend attempts', async () => {
    const challenge = await initiateLoginChallenge({
      user: createdUser,
      req: { ip: '127.0.0.1' },
    });

    // Immediate resend should trigger 429 cooldown error
    await assert.rejects(
      async () => {
        await resendLoginChallenge({
          challengeId: challenge.challengeId,
          req: { ip: '127.0.0.1' },
        });
      },
      (err) => {
        assert.equal(err.status, 429);
        assert.ok(err.message.includes('Please wait'));
        return true;
      }
    );

    // Fast-forward lastResentAt by 65 seconds
    await prisma.loginChallenge.update({
      where: { id: challenge.challengeId },
      data: { createdAt: new Date(Date.now() - 65 * 1000), lastResentAt: new Date(Date.now() - 65 * 1000) },
    });

    const resendResult = await resendLoginChallenge({
      challengeId: challenge.challengeId,
      req: { ip: '127.0.0.1' },
    });

    assert.ok(resendResult.message);
    assert.equal(resendResult.resendAttempts, 1);

    // Set resendAttempts to max (3)
    await prisma.loginChallenge.update({
      where: { id: challenge.challengeId },
      data: {
        resendAttempts: 3,
        lastResentAt: new Date(Date.now() - 100 * 1000),
      },
    });

    await assert.rejects(
      async () => {
        await resendLoginChallenge({
          challengeId: challenge.challengeId,
          req: { ip: '127.0.0.1' },
        });
      },
      (err) => {
        assert.ok(err.message.includes('Maximum resend limit'));
        return true;
      }
    );
  });
});
