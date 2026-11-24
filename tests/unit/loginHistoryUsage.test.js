import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import {
  parseUserAgent,
  getClientIp,
  formatDuration,
  formatTotalHours,
  recordLoginSession,
  recordUserLogout,
  terminateSession,
  blockUser,
  unblockUser,
  getLoginHistoryListing,
  getUserSessionsBreakdown,
} from '../../src/services/sessionTracking.service.js';

test('1. User-Agent parsing correctly extracts device, browser, and OS', () => {
  const chromeWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
  const res1 = parseUserAgent(chromeWindows);
  assert.equal(res1.device, 'Desktop');
  assert.equal(res1.os, 'Windows 10/11');
  assert.match(res1.browser, /Chrome/i);

  const iphoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const res2 = parseUserAgent(iphoneSafari);
  assert.equal(res2.device, 'Mobile');
  assert.equal(res2.os, 'iOS 17.4');
  assert.equal(res2.browser, 'Safari');

  const macFirefox = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0';
  const res3 = parseUserAgent(macFirefox);
  assert.equal(res3.device, 'Desktop');
  assert.equal(res3.os, 'macOS 10.15');
  assert.match(res3.browser, /Firefox/i);
});

test('2. Duration and total hours formatting work accurately', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(125), '2m 5s');
  assert.equal(formatDuration(3665), '1h 1m');
  assert.equal(formatDuration(7200), '2h 0m');

  assert.equal(formatTotalHours(0), '0.0 hrs');
  assert.equal(formatTotalHours(3600), '1.0 hrs');
  assert.equal(formatTotalHours(5400), '1.5 hrs');
  assert.equal(formatTotalHours(36000), '10.0 hrs');
});

test('3. recordLoginSession creates UserSession & LoginHistory records and updates TenantUser', async () => {
  // Find a test user or platform owner in the database
  const testUser = await prisma.tenantUser.findFirst({
    include: { tenant: true },
  });
  assert.ok(testUser, 'Test user must exist in the database');

  const fakeReq = {
    ip: '192.168.1.100',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
    },
  };

  const { session, loginHistory } = await recordLoginSession({
    user: testUser,
    req: fakeReq,
    loginType: 'PASSWORD',
  });

  assert.ok(session.id, 'Session should have an id');
  assert.equal(session.userId, testUser.id);
  assert.equal(session.tenantId, testUser.tenantId);
  assert.equal(session.status, 'ACTIVE');
  assert.equal(session.ipAddress, '192.168.1.100');
  assert.equal(session.device, 'Desktop');

  assert.ok(loginHistory.id, 'LoginHistory should have an id');
  assert.equal(loginHistory.sessionId, session.id);
  assert.equal(loginHistory.status, 'SUCCESS');
  assert.equal(loginHistory.loginType, 'PASSWORD');

  // Verify TenantUser updated
  const reloaded = await prisma.tenantUser.findUnique({ where: { id: testUser.id } });
  assert.ok(reloaded.lastLoginAt);
  assert.equal(reloaded.activeSessionIp, '192.168.1.100');

  // 4. Test termination of this session
  const terminated = await terminateSession({
    sessionId: session.id,
    operator: { name: 'Automated Test Operator', email: 'test@ekaryam.io' },
    reason: 'Testing session termination',
  });

  assert.equal(terminated.status, 'TERMINATED');
  assert.ok(terminated.endedAt);
  assert.equal(terminated.endReason, 'Testing session termination');

  // Clean up test records
  await prisma.loginHistory.deleteMany({ where: { sessionId: session.id } });
  await prisma.userSession.delete({ where: { id: session.id } });
});

test('5. Block user terminates active sessions and sets isBlocked=true; unblock restores access', async () => {
  // Create a temporary user for testing block/unblock
  const tenant = await prisma.tenant.findFirst();
  assert.ok(tenant, 'Tenant must exist');

  const tempUser = await prisma.tenantUser.create({
    data: {
      tenantId: tenant.id,
      email: `test-block-${Date.now()}@testtemp.com`,
      name: 'Temp Block Test User',
      passwordHash: 'dummyhash',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
    },
  });

  // Create an active session for this temp user
  const session = await prisma.userSession.create({
    data: {
      userId: tempUser.id,
      tenantId: tenant.id,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86400000),
      ipAddress: '10.0.0.1',
    },
  });

  // Block the user
  const blocked = await blockUser({
    userId: tempUser.id,
    operator: { name: 'Admin Tester' },
    reason: 'Security violation test',
  });

  assert.equal(blocked.isBlocked, true);
  assert.equal(blocked.blockedReason, 'Security violation test');

  // Verify the active session was terminated
  const reloadedSession = await prisma.userSession.findUnique({ where: { id: session.id } });
  assert.equal(reloadedSession.status, 'TERMINATED');
  assert.match(reloadedSession.endReason, /USER_BLOCKED/);

  // Unblock the user
  const unblocked = await unblockUser({
    userId: tempUser.id,
    operator: { name: 'Admin Tester' },
    reason: 'Resolution of violation',
  });

  assert.equal(unblocked.isBlocked, false);

  // Clean up temp user
  await prisma.userSession.deleteMany({ where: { userId: tempUser.id } });
  await prisma.tenantUser.delete({ where: { id: tempUser.id } });
});

test('6. getLoginHistoryListing returns required columns and pagination structure', async () => {
  const result = await getLoginHistoryListing({ page: 1, limit: 10 });

  assert.ok(result.rows, 'Result should have rows array');
  assert.ok(result.pagination, 'Result should have pagination object');
  assert.ok(result.pagination.total >= 0);

  if (result.rows.length > 0) {
    const row = result.rows[0];
    assert.ok('companyName' in row, 'Row must include companyName');
    assert.ok('userName' in row, 'Row must include userName');
    assert.ok('userEmail' in row, 'Row must include userEmail');
    assert.ok('designation' in row, 'Row must include designation');
    assert.ok('totalLogins' in row, 'Row must include totalLogins');
    assert.ok('lastLoginAt' in row, 'Row must include lastLoginAt');
    assert.ok('lastLoginDuration' in row, 'Row must include lastLoginDuration');
    assert.ok('ipAddress' in row, 'Row must include ipAddress');
    assert.ok('lastPasswordChange' in row, 'Row must include lastPasswordChange');
    assert.ok('totalHoursLoginTime' in row, 'Row must include totalHoursLoginTime');
    assert.ok('isBlocked' in row, 'Row must include isBlocked');
  }
});
