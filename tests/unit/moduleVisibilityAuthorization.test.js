import test from 'node:test';
import assert from 'node:assert/strict';
import { checkModuleVisibility } from '../../src/middleware/moduleVisibility.js';
import { prisma } from '../../src/lib/prisma.js';

test('Dynamic Module Visibility Authorization & Enforcement Suite', async (t) => {
  let testTenantId;
  let managerUser;
  let superAdminUser;

  // Retrieve valid tenant from live test database
  const tenant = await prisma.tenant.findFirst({
    select: { id: true },
  });
  assert.ok(tenant, 'Active tenant must exist in the database');
  testTenantId = tenant.id;

  managerUser = {
    id: 'test-manager-uid',
    role: 'MANAGER',
    tenantId: testTenantId,
  };
  superAdminUser = {
    id: 'test-admin-uid',
    role: 'SUPER_ADMIN',
    tenantId: testTenantId,
  };

  await t.test('SUPER_ADMIN always bypasses module restrictions (Root Authority)', async () => {
    const mw = checkModuleVisibility('messages');
    let passed = false;
    const req = { user: superAdminUser, tenantId: testTenantId };
    const res = {
      status() { return this; },
      json() { return this; },
    };

    await mw(req, res, () => { passed = true; });
    assert.equal(passed, true, 'SUPER_ADMIN must pass through regardless of module setting');
  });

  await t.test('Unauthenticated caller receives HTTP 401', async () => {
    const mw = checkModuleVisibility('goals');
    let statusCode = null;
    let responseBody = null;
    const req = { user: null, tenantId: testTenantId };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseBody = data; return this; },
    };

    await mw(req, res, () => {});
    assert.equal(statusCode, 401);
    assert.equal(responseBody.error, 'Authentication required');
  });

  await t.test('Disabled module returns HTTP 403 MODULE_VISIBILITY_RESTRICTED for non-admin role', async () => {
    // Configure tenant settings with messages disabled for MANAGER
    await prisma.tenantSettings.upsert({
      where: { tenantId: testTenantId },
      create: {
        tenantId: testTenantId,
        sidebarVisibility: {
          MANAGER: { messages: false, goals: true },
        },
      },
      update: {
        sidebarVisibility: {
          MANAGER: { messages: false, goals: true },
        },
      },
    });

    const mwMessages = checkModuleVisibility('messages');
    let statusCode = null;
    let responseBody = null;
    let nextCalled = false;

    const req = { user: managerUser, tenantId: testTenantId };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseBody = data; return this; },
    };

    await mwMessages(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, 'Middleware must not call next() for disabled module');
    assert.equal(statusCode, 403, 'Must return HTTP 403 Forbidden');
    assert.equal(responseBody.code, 'MODULE_VISIBILITY_RESTRICTED');
    assert.equal(responseBody.module, 'messages');
  });

  await t.test('Allowed module passes through for the same role', async () => {
    const mwGoals = checkModuleVisibility('goals');
    let nextCalled = false;
    const req = { user: managerUser, tenantId: testTenantId };
    const res = {
      status() { return this; },
      json() { return this; },
    };

    await mwGoals(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, 'Middleware must call next() for permitted module');
  });

  await t.test('Default-deny behavior when verification fails', async () => {
    const mwInvalid = checkModuleVisibility('tasks');
    let statusCode = null;
    let responseBody = null;
    let nextCalled = false;

    // Simulate an unexpected error by corrupting the request user role property access
    const req = {
      user: {
        get role() {
          throw new Error('Forced test error');
        },
      },
      tenantId: testTenantId,
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseBody = data; return this; },
    };

    await mwInvalid(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, 'Middleware must not allow access on error');
    assert.equal(statusCode, 403, 'Must return HTTP 403 Forbidden on check failure');
    assert.equal(responseBody.code, 'MODULE_VISIBILITY_CHECK_FAILED');
  });
});
