import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { create as createCoupon, update as updateCoupon } from '../../src/controllers/coupon.controller.js';
import { renewSubscription, getRenewalExperience } from '../../src/controllers/subscription.controller.js';
import { getStaffRenewalHistory, listPlatformStaff } from '../../src/controllers/platformStaff.controller.js';

test('BDM, Sales Team & Coupon Integration with Renewal Tracking', async (t) => {
  // 1. Fetch active sales rep
  const activeSalesRep = await prisma.tenantUser.findFirst({
    where: { role: 'PLATFORM_SALES', status: 'ACTIVE', isDeleted: false },
  });

  if (!activeSalesRep) {
    t.skip('No active PLATFORM_SALES user found for test');
    return;
  }

  const testCouponCode = `TEST_BDM_${Date.now()}`;
  let createdCouponId = null;

  // Test 1: Coupon creation automatically links salesRepId and retrieves BDM name
  await t.test('Coupon creation validates and associates Sales Team member', async () => {
    let statusCode = 200;
    let resData = null;
    const req = {
      body: {
        code: testCouponCode,
        discountType: 'PERCENT',
        discountValue: 15,
        salesRepId: activeSalesRep.id,
        usageLimit: 10,
        active: true,
      },
      user: { id: 'test-admin', role: 'PLATFORM_OWNER' },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await createCoupon(req, res, (err) => {
      if (err) throw err;
    });

    assert.equal(statusCode, 201, 'Coupon should be created with status 201');
    assert.ok(resData?.id, 'Response should contain coupon id');
    assert.equal(resData.salesRepId, activeSalesRep.id, 'Coupon should store salesRepId');
    assert.equal(resData.bdmName, activeSalesRep.name, 'Coupon bdmName should match sales rep name');
    assert.equal(resData.salesRep?.email, activeSalesRep.email, 'Response should include sales rep details');
    createdCouponId = resData.id;
  });

  // Test 2: Inactive / non-existent sales team assignment is rejected
  await t.test('Assigning coupon to inactive/non-existent sales rep returns 400', async () => {
    let statusCode = 200;
    let resData = null;
    const req = {
      body: {
        code: `INVALID_REP_${Date.now()}`,
        discountType: 'PERCENT',
        discountValue: 10,
        salesRepId: 'non-existent-sales-rep-id',
      },
      user: { id: 'test-admin', role: 'PLATFORM_OWNER' },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await createCoupon(req, res, (err) => {
      if (err) throw err;
    });

    assert.equal(statusCode, 400, 'Should reject non-existent sales rep with 400');
    assert.ok(['INVALID_SALES_REP', 'STAFF_INACTIVE'].includes(resData?.code), 'Should return invalid/inactive code');
  });

  // Test 3: Renewal attribution via coupon
  await t.test('Subscription renewal with coupon automatically attributes to coupon BDM', async () => {
    const candidateSub = await prisma.subscription.findFirst({
      where: {
        cancelledAt: null,
        renewedTo: null,
      },
      include: {
        package: true,
        invoices: {
          where: { state: { in: ['PAID', 'ISSUED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!candidateSub) {
      t.skip('No eligible subscription found to test renewal attribution');
      return;
    }

    let statusCode = 200;
    let resData = null;
    const req = {
      user: { id: 'client-user-self-renew', role: 'SUPER_ADMIN' }, // Even direct client self-renewal!
      params: { id: candidateSub.id },
      body: {
        packageId: candidateSub.packageId,
        seatCount: candidateSub.seatCount,
        couponCode: testCouponCode,
        createInvoice: true,
      },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await renewSubscription(req, res, (err) => {
      if (err) throw err;
    });

    if (statusCode === 409 && resData?.code === 'ALREADY_RENEWED') {
      assert.ok(true, 'Already renewed guard active');
      return;
    }

    assert.equal(statusCode, 201, 'Renewal should succeed');
    assert.equal(
      resData?.subscription?.salesRepId,
      activeSalesRep.id,
      'Renewal must be automatically attributed to coupon BDM'
    );
  });

  // Test 4: Sales Team Performance summary and renewal history
  await t.test('Sales team performance ledger reflects BDM metrics', async () => {
    let resData = null;
    const req = {
      params: { id: activeSalesRep.id },
    };
    const res = {
      status() {
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await getStaffRenewalHistory(req, res, (err) => {
      if (err) throw err;
    });

    assert.ok(resData?.totals, 'Should return totals');
    assert.ok(resData.totals.totalCouponsAssigned >= 1, 'Assigned coupons count should be >= 1');
    assert.ok(Array.isArray(resData.coupons), 'Coupons list should be returned');
    const matchedCoupon = resData.coupons.find((c) => c.code === testCouponCode);
    assert.ok(matchedCoupon, 'Created test coupon should be in BDM coupons ledger');
  });

  // Test 5: BDM Renewal Performance Dashboard returns relational metrics
  await t.test('BDM calculations dashboard returns real Sales Team members', async () => {
    let resData = null;
    const req = { query: {} };
    const res = {
      status() {
        return this;
      },
      json(data) {
        resData = data;
        return this;
      },
    };

    await getRenewalExperience(req, res, (err) => {
      if (err) throw err;
    });

    assert.ok(Array.isArray(resData?.bdmSummary?.performers), 'performers array returned');
    const repRow = resData.bdmSummary.performers.find((b) => b.salesRepId === activeSalesRep.id);
    assert.ok(repRow, 'Active sales rep should exist in BDM performance summary');
    assert.equal(repRow.bdmName, activeSalesRep.name);
    assert.equal(repRow.email, activeSalesRep.email);
    assert.ok(Array.isArray(repRow.activeCoupons), 'Active coupons array returned');
    assert.ok(repRow.activeCoupons.includes(testCouponCode), 'Test coupon code listed under active coupons');
  });

  // Clean-up
  if (createdCouponId) {
    try {
      await prisma.couponRedemption.deleteMany({ where: { couponId: createdCouponId } });
      await prisma.coupon.delete({ where: { id: createdCouponId } });
    } catch {
      // ignore clean-up error
    }
  }
});
