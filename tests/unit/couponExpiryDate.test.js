import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { create, update, get } from '../../src/controllers/coupon.controller.js';
import { couponValidationError } from '../../src/lib/pricing.js';

test('Company Offer Coupon Expiry Date and Subscription End Date Independence', async (t) => {
  const mockUser = { id: 'u-owner-1', name: 'Platform Owner', role: 'PLATFORM_OWNER' };
  const createdCouponIds = [];

  t.after(async () => {
    if (createdCouponIds.length > 0) {
      await prisma.coupon.deleteMany({
        where: { id: { in: createdCouponIds } },
      });
    }
  });

  await t.test('1. Create company offer with a future expiry date', async () => {
    let statusCode = 200;
    let responseBody = null;

    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days in future
    const startDate = new Date();

    const req = {
      user: mockUser,
      body: {
        companyName: 'Test Future Expiry Co',
        industry: 'Technology',
        city: 'Mumbai',
        totalLicenses: 10,
        subscriptionYears: 2,
        promoMonths: 3,
        startDate: startDate.toISOString().slice(0, 10),
        expiresAt: futureExpiry.toISOString().slice(0, 10),
        discountPercent: 10,
      },
    };

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await create(req, res, (err) => { if (err) throw err; });

    assert.equal(statusCode, 201);
    assert.ok(responseBody.id);
    createdCouponIds.push(responseBody.id);

    // Verify database record
    const dbCoupon = await prisma.coupon.findUnique({ where: { id: responseBody.id } });
    assert.ok(dbCoupon);

    // Ensure expiresAt and endDate are completely separate
    assert.ok(dbCoupon.expiresAt);
    assert.ok(dbCoupon.endDate);
    assert.notEqual(
      dbCoupon.expiresAt.toISOString().slice(0, 10),
      dbCoupon.endDate.toISOString().slice(0, 10),
      'expiresAt and endDate must not be overwritten or identical when different'
    );

    // Expiry date should match the input date (future)
    assert.equal(
      dbCoupon.expiresAt.toISOString().slice(0, 10),
      futureExpiry.toISOString().slice(0, 10)
    );

    // Subscription endDate should be 2 years (24m) + 3 months promo = 27 months
    assert.ok(dbCoupon.endDate.getTime() > dbCoupon.expiresAt.getTime());

    // Computed status should be UNUSED
    assert.equal(responseBody.computedStatus, 'UNUSED');

    // couponValidationError should allow redemption
    const error = couponValidationError(dbCoupon, {
      companyName: 'Test Future Expiry Co',
      totalLicenses: 10,
    });
    assert.equal(error, null, 'Active coupon with future expiry should be redeemable');
  });

  await t.test('2. Create company offer with a past expiry date (auto-expired & blocked redemption)', async () => {
    let statusCode = 200;
    let responseBody = null;

    const pastExpiry = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days in past
    const startDate = new Date();

    const req = {
      user: mockUser,
      body: {
        companyName: 'Test Past Expiry Co',
        industry: 'Technology',
        city: 'Mumbai',
        totalLicenses: 10,
        subscriptionYears: 1,
        promoMonths: 0,
        startDate: startDate.toISOString().slice(0, 10),
        expiresAt: pastExpiry.toISOString().slice(0, 10),
        discountPercent: 5,
      },
    };

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await create(req, res, (err) => { if (err) throw err; });

    assert.equal(statusCode, 201);
    assert.ok(responseBody.id);
    createdCouponIds.push(responseBody.id);

    const dbCoupon = await prisma.coupon.findUnique({ where: { id: responseBody.id } });
    assert.ok(dbCoupon.expiresAt);
    assert.equal(
      dbCoupon.expiresAt.toISOString().slice(0, 10),
      pastExpiry.toISOString().slice(0, 10)
    );

    // Fetch via getById to verify live computedStatus
    let fetchedStatus = null;
    const getReq = { user: mockUser, params: { id: responseBody.id } };
    const getRes = {
      status(c) { return this; },
      json(d) { fetchedStatus = d.computedStatus; return this; },
    };
    await get(getReq, getRes, (err) => { if (err) throw err; });
    assert.equal(fetchedStatus, 'EXPIRED', 'Coupon past expiry date must compute status as EXPIRED');

    // couponValidationError must reject with 'Coupon has expired'
    const error = couponValidationError(dbCoupon, {
      companyName: 'Test Past Expiry Co',
      totalLicenses: 10,
    });
    assert.equal(error, 'Coupon has expired', 'Expired coupon must not be redeemable');
  });

  await t.test('3. Create company offer with blank/null expiry date (no expiry deadline)', async () => {
    let statusCode = 200;
    let responseBody = null;

    const startDate = new Date();

    const req = {
      user: mockUser,
      body: {
        companyName: 'Test No Expiry Co',
        industry: 'Technology',
        city: 'Delhi',
        totalLicenses: 10,
        subscriptionYears: 3,
        promoMonths: 2,
        startDate: startDate.toISOString().slice(0, 10),
        expiresAt: '', // Blank means no expiry
        discountPercent: 15,
      },
    };

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    await create(req, res, (err) => { if (err) throw err; });

    assert.equal(statusCode, 201);
    assert.ok(responseBody.id);
    createdCouponIds.push(responseBody.id);

    const dbCoupon = await prisma.coupon.findUnique({ where: { id: responseBody.id } });
    assert.equal(dbCoupon.expiresAt, null, 'Blank expiry date must be persisted as null');
    assert.ok(dbCoupon.endDate, 'Subscription endDate must still be computed');

    // Computed status should be UNUSED
    let fetchedStatus = null;
    const getReq = { user: mockUser, params: { id: responseBody.id } };
    const getRes = {
      status(c) { return this; },
      json(d) { fetchedStatus = d.computedStatus; return this; },
    };
    await get(getReq, getRes, (err) => { if (err) throw err; });
    assert.equal(fetchedStatus, 'UNUSED');

    // couponValidationError must allow redemption
    const error = couponValidationError(dbCoupon, {
      companyName: 'Test No Expiry Co',
      totalLicenses: 10,
    });
    assert.equal(error, null, 'Coupon with no expiry restriction must be redeemable');
  });

  await t.test('4. Updating subscription duration does NOT overwrite or reset coupon expiry date', async () => {
    // Start with coupon having specific expiry
    const futureExpiry = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    const startDate = new Date();

    const createReq = {
      user: mockUser,
      body: {
        companyName: 'Test Duration Update Co',
        industry: 'Technology',
        city: 'Bengaluru',
        totalLicenses: 10,
        subscriptionYears: 1,
        promoMonths: 0,
        startDate: startDate.toISOString().slice(0, 10),
        expiresAt: futureExpiry.toISOString().slice(0, 10),
        discountPercent: 10,
      },
    };

    let created = null;
    const createRes = {
      status() { return this; },
      json(d) { created = d; return this; },
    };
    await create(createReq, createRes, (err) => { if (err) throw err; });
    createdCouponIds.push(created.id);

    const initialEndDate = new Date(created.endDate);

    // Now update subscriptionYears to 3 and promoMonths to 6 WITHOUT passing expiresAt
    const updateReq = {
      user: mockUser,
      params: { id: created.id },
      body: {
        subscriptionYears: 3,
        promoMonths: 6,
      },
    };

    let updated = null;
    const updateRes = {
      status() { return this; },
      json(d) { updated = d; return this; },
    };
    await update(updateReq, updateRes, (err) => { if (err) throw err; });

    const freshCoupon = await prisma.coupon.findUnique({ where: { id: created.id } });

    // Verify subscription endDate expanded:
    assert.ok(freshCoupon.endDate.getTime() > initialEndDate.getTime(), 'Subscription endDate must update');

    // Verify expiresAt was NOT overwritten with new endDate:
    assert.equal(
      freshCoupon.expiresAt.toISOString().slice(0, 10),
      futureExpiry.toISOString().slice(0, 10),
      'Coupon expiresAt must remain untouched when updating subscription duration'
    );
  });

  await t.test('5. Updating coupon expiry date independently of subscription duration', async () => {
    const couponId = createdCouponIds[createdCouponIds.length - 1];
    const newExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days

    const updateReq = {
      user: mockUser,
      params: { id: couponId },
      body: {
        expiresAt: newExpiry.toISOString().slice(0, 10),
      },
    };

    let updated = null;
    const updateRes = {
      status() { return this; },
      json(d) { updated = d; return this; },
    };
    await update(updateReq, updateRes, (err) => { if (err) throw err; });

    const freshCoupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    assert.equal(
      freshCoupon.expiresAt.toISOString().slice(0, 10),
      newExpiry.toISOString().slice(0, 10),
      'expiresAt must update cleanly to new date'
    );

    // Now clear expiry date (set to blank / null)
    const clearReq = {
      user: mockUser,
      params: { id: couponId },
      body: {
        expiresAt: '',
      },
    };
    await update(clearReq, updateRes, (err) => { if (err) throw err; });

    const clearedCoupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    assert.equal(clearedCoupon.expiresAt, null, 'expiresAt must be cleared to null');
    assert.ok(clearedCoupon.endDate, 'Subscription endDate must be preserved');
  });
});
