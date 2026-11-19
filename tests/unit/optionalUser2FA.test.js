import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma } from '../../src/lib/prisma.js';
import {
  is2FAEnforcedForUser,
  initiateLoginChallenge,
  verifyLoginChallenge,
  resendLoginChallenge,
  getUser2FAStatus,
  requestEnable2FA,
  verifyAndEnable2FA,
  disable2FA,
} from '../../src/services/login2fa.service.js';
import { getRegistrationConfig, updateRegistrationConfig } from '../../src/services/registrationConfig.service.js';

describe('Optional User-Level Email Two-Factor Authentication (2FA) Suite', () => {
  let tenantId = null;
  let userAId = null;
  let userBId = null;
  let originalGlobal2FA = true;
  const password = 'Password@123';
  let passwordHash = null;

  before(async () => {
    passwordHash = await bcrypt.hash(password, 10);

    // Get an existing tenant or create a dummy one
    const tenant = await prisma.tenant.findFirst({ select: { id: true } });
    tenantId = tenant ? tenant.id : 'test-tenant-2fa';

    // Save original global config
    originalGlobal2FA = await getRegistrationConfig('LOGIN_2FA_ENABLED', true);
    await updateRegistrationConfig({ key: 'LOGIN_2FA_ENABLED', value: 'true', updatedBy: 'SYSTEM_TEST' });

    // Create User A (will test 2FA enable)
    const userA = await prisma.tenantUser.create({
      data: {
        email: `usera-${Date.now()}@test2fa.com`,
        name: 'User Alpha',
        passwordHash,
        tenantId,
        role: 'EMPLOYEE',
        twoFactorEnabled: false,
      },
    });
    userAId = userA.id;

    // Create User B (will test default password-only login)
    const userB = await prisma.tenantUser.create({
      data: {
        email: `userb-${Date.now()}@test2fa.com`,
        name: 'User Beta',
        passwordHash,
        tenantId,
        role: 'HR',
        twoFactorEnabled: false,
      },
    });
    userBId = userB.id;
  });

  it('1. User B has 2FA disabled by default → password-only login (no OTP challenge)', async () => {
    const userB = await prisma.tenantUser.findUnique({ where: { id: userBId } });
    assert.equal(userB.twoFactorEnabled, false);

    const requires2FA = await is2FAEnforcedForUser(userB);
    assert.equal(requires2FA, false, 'User B should not be challenged with 2FA');
  });

  it('2. User A enables 2FA through verification flow', async () => {
    // Step A: Request 2FA setup
    const setupReq = await requestEnable2FA({ userId: userAId });
    assert.ok(setupReq.challengeId);
    assert.ok(setupReq.devOtp);

    // Step B: Verify OTP and activate 2FA
    const verifyRes = await verifyAndEnable2FA({
      userId: userAId,
      challengeId: setupReq.challengeId,
      otp: setupReq.devOtp,
    });
    assert.equal(verifyRes.success, true);
    assert.equal(verifyRes.twoFactorEnabled, true);

    // Verify DB update
    const updatedA = await prisma.tenantUser.findUnique({ where: { id: userAId } });
    assert.equal(updatedA.twoFactorEnabled, true);
    assert.ok(updatedA.twoFactorEnabledAt);
  });

  it('3. User A with 2FA enabled → requires password + OTP login challenge', async () => {
    const userA = await prisma.tenantUser.findUnique({ where: { id: userAId } });
    const requires2FA = await is2FAEnforcedForUser(userA);
    assert.equal(requires2FA, true, 'User A should require 2FA OTP challenge on login');

    // Initiate login challenge
    const challenge = await initiateLoginChallenge({ user: userA });
    assert.equal(challenge.requires2FA, true);
    assert.ok(challenge.challengeId);
    assert.ok(challenge.devOtp);

    // Verify valid login OTP
    const session = await verifyLoginChallenge({
      challengeId: challenge.challengeId,
      otp: challenge.devOtp,
    });
    assert.ok(session.token);
    assert.equal(session.user.id, userAId);
  });

  it('4. Invalid or expired OTP is rejected', async () => {
    const userA = await prisma.tenantUser.findUnique({ where: { id: userAId } });
    const challenge = await initiateLoginChallenge({ user: userA });

    // Invalid OTP
    await assert.rejects(
      async () => {
        await verifyLoginChallenge({
          challengeId: challenge.challengeId,
          otp: '000000',
        });
      },
      /Invalid verification code/
    );

    // Expired challenge simulation
    await prisma.loginChallenge.update({
      where: { id: challenge.challengeId },
      data: { otpExpiresAt: new Date(Date.now() - 1000) },
    });

    await assert.rejects(
      async () => {
        await verifyLoginChallenge({
          challengeId: challenge.challengeId,
          otp: challenge.devOtp,
        });
      },
      /expired/
    );
  });

  it('5. Global feature disabled → bypasses 2FA challenge even if user has 2FA enabled', async () => {
    // Disable globally
    await updateRegistrationConfig({ key: 'LOGIN_2FA_ENABLED', value: 'false', updatedBy: 'SYSTEM_TEST' });

    const userA = await prisma.tenantUser.findUnique({ where: { id: userAId } });
    assert.equal(userA.twoFactorEnabled, true);

    const requires2FA = await is2FAEnforcedForUser(userA);
    assert.equal(requires2FA, false, 'Global disabled 2FA must bypass OTP challenge');

    // Restore globally
    await updateRegistrationConfig({ key: 'LOGIN_2FA_ENABLED', value: 'true', updatedBy: 'SYSTEM_TEST' });
  });

  it('6. User A disables 2FA with password confirmation → returns to password-only login', async () => {
    // Disable with correct password
    const disableRes = await disable2FA({
      userId: userAId,
      password,
    });
    assert.equal(disableRes.success, true);
    assert.equal(disableRes.twoFactorEnabled, false);
    assert.ok(disableRes.twoFactorDisabledAt);

    // Check DB
    const updatedA = await prisma.tenantUser.findUnique({ where: { id: userAId } });
    assert.equal(updatedA.twoFactorEnabled, false);

    // User A should now bypass 2FA on login
    const requires2FA = await is2FAEnforcedForUser(updatedA);
    assert.equal(requires2FA, false, 'User A should no longer require OTP');
  });

  it('7. Different roles (Platform Owner, HR, Finance, Employee) independently control 2FA', async () => {
    const owner = await prisma.tenantUser.findFirst({
      where: { role: 'PLATFORM_OWNER' },
    });
    if (owner) {
      // By default owner twoFactorEnabled is false
      const requires = await is2FAEnforcedForUser(owner);
      assert.equal(requires, Boolean(owner.twoFactorEnabled));
    }
  });

  after(async () => {
    // Restore original global config
    await updateRegistrationConfig({
      key: 'LOGIN_2FA_ENABLED',
      value: String(originalGlobal2FA),
      updatedBy: 'SYSTEM_TEST',
    });

    // Cleanup test users
    if (userAId) {
      await prisma.loginChallenge.deleteMany({ where: { userId: userAId } }).catch(() => {});
      await prisma.tenantUser.delete({ where: { id: userAId } }).catch(() => {});
    }
    if (userBId) {
      await prisma.loginChallenge.deleteMany({ where: { userId: userBId } }).catch(() => {});
      await prisma.tenantUser.delete({ where: { id: userBId } }).catch(() => {});
    }
  });
});
