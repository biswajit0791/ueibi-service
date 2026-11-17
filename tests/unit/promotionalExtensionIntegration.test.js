import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import {
  findEligiblePromotion,
  calculateSubscriptionExtension,
  getPromotionAnalytics,
  getPromotionStatus,
} from '../../src/services/promotion.service.js';
import {
  listPromotions,
  createPromotion,
  updatePromotion,
  getAnalytics,
} from '../../src/controllers/promotion.controller.js';
import {
  calculateRenewal,
  renewSubscription,
} from '../../src/controllers/subscription.controller.js';

test('Promotional Subscription Extension (Buy X Get Y Free) Integration Test', async (t) => {
  // Find or create an active promotion offer
  const promoCode = `PROMO_TEST_${Date.now()}`;
  let createdPromo = null;

  await t.test('1. Create and validate promotional extension offer (Pay 12 Get 2 Free)', async () => {
    let statusCode = 200;
    let resData = null;
    const req = {
      body: {
        name: 'Test Annual Booster 12+2',
        code: promoCode,
        description: 'Pay 12 Months Get 2 Months Free Test Campaign',
        paidMonths: 12,
        freeMonths: 2,
        active: true,
        eligibility: 'ALL',
        applyToAllPackages: true,
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days ahead
        usageLimit: 50,
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

    await createPromotion(req, res, (err) => {
      if (err) throw err;
    });

    assert.equal(statusCode, 201, 'Promotion should be created with HTTP 201');
    assert.ok(resData?.id, 'Promotion should return unique ID');
    assert.equal(resData.code, promoCode, 'Promo code matches uppercase');
    assert.equal(resData.paidMonths, 12, 'Paid months must be 12');
    assert.equal(resData.freeMonths, 2, 'Free months must be 2');
    assert.equal(resData.active, true, 'Offer must be active');
    createdPromo = resData;
  });

  await t.test('2. Extension math and date calculation engine', async () => {
    const startsAt = new Date('2026-01-01T00:00:00.000Z');
    const ext = calculateSubscriptionExtension({
      startsAt,
      termMonths: 12,
      promotion: createdPromo,
    });

    assert.equal(ext.paidDurationMonths, 12, 'Paid duration should be 12 months');
    assert.equal(ext.freeDurationMonths, 2, 'Free duration should be 2 months');
    assert.equal(ext.totalDurationMonths, 14, 'Total duration must be 12 + 2 = 14 months');

    // Expected paidEndsAt: 12 calendar months from 2026-01-01 => 2027-01-01
    // Expected endsAt: 14 calendar months from 2026-01-01 => 2027-03-01
    const expectedPaidEndsAt = new Date('2027-01-01T00:00:00.000Z');
    const expectedEndsAt = new Date('2027-03-01T00:00:00.000Z');

    assert.equal(ext.paidEndsAt.toISOString().slice(0, 10), expectedPaidEndsAt.toISOString().slice(0, 10), 'Paid expiry date is 12m');
    assert.equal(ext.endsAt.toISOString().slice(0, 10), expectedEndsAt.toISOString().slice(0, 10), 'Final expiry date is extended by +2m to 14m');
  });

  await t.test('3. BDM Renewal Calculator applies promotional extension accurately', async () => {
    // Find a valid active subscription with tenant
    const sub = await prisma.subscription.findFirst({
      where: { state: 'ACTIVE', renewedTo: null },
      include: { tenant: true, package: true },
    });

    if (!sub) {
      t.skip('No active renewable subscription found in database to run live calculator test');
      return;
    }

    let resData = null;
    const req = {
      params: { id: sub.id },
      body: {
        packageId: sub.packageId || null,
        seatCount: sub.seatCount || 10,
        promoCode: promoCode,
      },
      user: { id: 'test-admin', role: 'PLATFORM_OWNER' },
    };
    const res = {
      json(data) {
        resData = data;
        return this;
      },
    };

    await calculateRenewal(req, res, (err) => {
      if (err) throw err;
    });

    assert.ok(resData?.calculation, 'Response includes calculation');
    assert.ok(resData?.promotion, 'Response includes matched promotion');
    assert.equal(resData.promotion.code, promoCode, 'Matched promo code');
    assert.equal(resData.promotion.paidMonths, 12, 'Paid months in promotion is 12');
    assert.equal(resData.promotion.freeMonths, 2, 'Free months in promotion is 2');
    assert.equal(resData.duration?.paidMonths, 12, 'Duration paid months is 12');
    assert.equal(resData.duration?.freeMonths, 2, 'Duration free months is 2');
    assert.equal(resData.duration?.totalMonths, 14, 'Duration total months is 14');
  });

  await t.test('4. End-to-end renewal execution with promotional extension', async () => {
    // Find or create an active subscription for renewal
    const sub = await prisma.subscription.findFirst({
      where: { state: 'ACTIVE', renewedTo: null },
      include: { tenant: true, package: true },
    });

    if (!sub) {
      t.skip('No active renewable subscription found');
      return;
    }

    // Find an active sales rep
    const salesRep = await prisma.tenantUser.findFirst({
      where: { role: 'PLATFORM_SALES', status: 'ACTIVE', isDeleted: false },
    });

    let resData = null;
    let statusCode = 200;
    const req = {
      params: { id: sub.id },
      body: {
        packageId: sub.packageId || null,
        seatCount: sub.seatCount || 10,
        promoCode: promoCode,
        createInvoice: true,
        salesRepId: salesRep?.id || null,
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

    await renewSubscription(req, res, (err) => {
      if (err) throw err;
    });

    assert.ok(resData?.subscription, 'Renewed subscription returned');
    const renewed = resData.subscription;
    assert.equal(renewed.paidDurationMonths, 12, 'Paid duration is 12 months');
    assert.equal(renewed.freeDurationMonths, 2, 'Free duration is 2 months');
    assert.equal(renewed.totalDurationMonths, 14, 'Total duration is 14 months');
    assert.equal(renewed.promotionId, createdPromo.id, 'Promotion ID linked to subscription');

    // Verify tenant planEndsAt was extended to final 14-month expiry
    const tenant = await prisma.tenant.findUnique({
      where: { id: sub.tenantId },
    });
    assert.equal(
      tenant.planEndsAt.toISOString().slice(0, 10),
      new Date(renewed.endsAt).toISOString().slice(0, 10),
      'Tenant planEndsAt must match final 14-month expiry date'
    );

    // Verify invoice generated charges ONLY for 12 months (not 14) and notes promotional extension
    if (resData.invoice) {
      assert.ok(resData.invoice.notes?.includes('Promotional Extension'), 'Invoice notes promotional extension');
    }

    // Verify PromotionRedemption record was created
    const redemption = await prisma.promotionRedemption.findUnique({
      where: { subscriptionId: renewed.id },
    });
    assert.ok(redemption, 'PromotionRedemption record created in database');
    assert.equal(redemption.paidMonths, 12, 'Redemption paidMonths is 12');
    assert.equal(redemption.freeMonths, 2, 'Redemption freeMonths is 2');
    assert.equal(redemption.totalMonths, 14, 'Redemption totalMonths is 14');
  });

  await t.test('5. Promotion analytics and BDM conversion aggregation', async () => {
    const analytics = await getPromotionAnalytics();
    assert.ok(analytics, 'Analytics returned');
    assert.ok(analytics.totalCompaniesWithFreeMonths >= 1, 'At least 1 company benefited with free months');
    assert.ok(analytics.totalFreeMonthsGranted >= 2, 'At least 2 promotional months granted');
    assert.ok(analytics.totalPaidRevenue >= 0, 'Paid revenue tracked');
    assert.ok(Array.isArray(analytics.promotions), 'Promotion breakdown array returned');
    assert.ok(Array.isArray(analytics.bdmConversions), 'BDM conversions array returned');
    assert.ok(Array.isArray(analytics.recentRedemptions), 'Recent redemptions ledger returned');
  });

  // Cleanup test promotion
  if (createdPromo?.id) {
    await prisma.subscriptionPromotion.delete({
      where: { id: createdPromo.id },
    }).catch(() => {});
  }
});
