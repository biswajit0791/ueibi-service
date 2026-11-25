import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { updatePlatformStaff } from '../../src/controllers/platformStaff.controller.js';

describe('Platform Staff Status Update Suite', () => {
  it('updates staff status to SUSPENDED by setting status=EXITED and isBlocked=true without Prisma enum errors', async () => {
    // Find or pick a platform sales member
    let staff = await prisma.tenantUser.findFirst({
      where: { role: 'PLATFORM_SALES' },
    });

    if (!staff) {
      // Find platform tenant
      const platformTenant = await prisma.tenant.findFirst({
        where: { isPlatform: true },
      });
      if (platformTenant) {
        staff = await prisma.tenantUser.create({
          data: {
            tenantId: platformTenant.id,
            name: 'Test Staff Sales',
            email: 'test_staff_sales_enum@ekaryam.internal',
            personalEmail: 'test_staff_sales_enum@ekaryam.internal',
            passwordHash: 'dummy_hash',
            role: 'PLATFORM_SALES',
            designation: 'Sales Lead',
            status: 'ACTIVE',
          },
        });
      }
    }

    if (!staff) {
      // If no platform tenant exists in test db, skip gracefully
      return;
    }

    // Test 1: Update status to SUSPENDED
    const mockReq = {
      params: { id: staff.id },
      body: {
        name: staff.name,
        status: 'SUSPENDED',
      },
      user: { id: 'test_platform_owner', email: 'owner@ekaryam.internal', role: 'PLATFORM_OWNER' },
      headers: {},
      ip: '127.0.0.1',
    };

    let responseData = null;
    const mockRes = {
      json: (data) => { responseData = data; return mockRes; },
      status: (code) => mockRes,
    };

    let caughtError = null;
    await updatePlatformStaff(mockReq, mockRes, (err) => { caughtError = err; });

    assert.equal(caughtError, null, 'updatePlatformStaff should not throw Prisma error');
    assert.ok(responseData, 'response data should be returned');
    assert.equal(responseData.staff.status, 'SUSPENDED');

    // Verify in database
    const dbUser = await prisma.tenantUser.findUnique({
      where: { id: staff.id },
      select: { status: true, isBlocked: true },
    });
    assert.equal(dbUser.status, 'EXITED');
    assert.equal(dbUser.isBlocked, true);

    // Test 2: Reactivate to ACTIVE
    const reactivateReq = {
      params: { id: staff.id },
      body: {
        name: staff.name,
        status: 'ACTIVE',
      },
      user: { id: 'test_platform_owner', email: 'owner@ekaryam.internal', role: 'PLATFORM_OWNER' },
      headers: {},
      ip: '127.0.0.1',
    };

    let reactivateResponse = null;
    const reactivateRes = {
      json: (data) => { reactivateResponse = data; return reactivateRes; },
      status: (code) => reactivateRes,
    };

    await updatePlatformStaff(reactivateReq, reactivateRes, (err) => { caughtError = err; });
    assert.equal(caughtError, null);
    assert.ok(reactivateResponse);
    assert.equal(reactivateResponse.staff.status, 'ACTIVE');

    const dbUserActive = await prisma.tenantUser.findUnique({
      where: { id: staff.id },
      select: { status: true, isBlocked: true },
    });
    assert.equal(dbUserActive.status, 'ACTIVE');
    assert.equal(dbUserActive.isBlocked, false);
  });
});
