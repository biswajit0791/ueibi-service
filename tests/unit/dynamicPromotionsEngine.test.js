import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import {
  listEligiblePromotions,
  findEligiblePromotion,
  duplicatePromotion,
  archivePromotion,
  calculateSubscriptionExtension,
  recordPromotionRedemption,
} from '../../src/services/promotion.service.js';

test('Dynamic Promotions Engine & Audit Lifecycle', async (t) => {
  const testSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  const testCode = `DYN_PROMO_${testSuffix}`;

  let createdPromo = null;

  await t.test('1. Create dynamic promotion with priority, minSeats, badgeText and allowCoupons', async () => {
    createdPromo = await prisma.subscriptionPromotion.create({
      data: {
        name: `Dynamic Booster ${testSuffix}`,
        code: testCode,
        badgeText: '+3 MONTHS FREE',
        description: 'Buy 12 Get 3 Free with min 5 seats',
        paidMonths: 12,
        freeMonths: 3,
        minSeats: 5,
        priority: 50,
        allowCoupons: false,
        allowNoCoupon: true,
        active: true,
        isArchived: false,
        startsAt: new Date(Date.now() - 10000),
        eligibility: 'ALL',
        applyToAllPackages: true,
      },
    });

    assert.ok(createdPromo.id);
    assert.equal(createdPromo.badgeText, '+3 MONTHS FREE');
    assert.equal(createdPromo.minSeats, 5);
    assert.equal(createdPromo.priority, 50);
    assert.equal(createdPromo.allowCoupons, false);
    assert.equal(createdPromo.allowNoCoupon, true);
    assert.equal(createdPromo.isArchived, false);
  });

  await t.test('2. List eligible offers filters by minSeats and active status', async () => {
    // With 2 seats (< minSeats 5): createdPromo should NOT be returned
    const offersLowSeats = await listEligiblePromotions({
      termMonths: 12,
      seatCount: 2,
      context: 'RENEWALS',
    });
    const foundLow = offersLowSeats.find((o) => o.id === createdPromo.id);
    assert.equal(foundLow, undefined, 'Offer requires min 5 seats, should not match 2 seats');

    // With 10 seats (>= minSeats 5): createdPromo SHOULD be returned
    const offersHighSeats = await listEligiblePromotions({
      termMonths: 12,
      seatCount: 10,
      context: 'RENEWALS',
    });
    const foundHigh = offersHighSeats.find((o) => o.id === createdPromo.id);
    assert.ok(foundHigh, 'Offer matches when seatCount >= minSeats');
    assert.equal(foundHigh.freeMonths, 3);
  });

  await t.test('3. Duplicate promotion generates cloned settings with new code & name', async () => {
    const duplicated = await duplicatePromotion(createdPromo.id, { id: 'admin-user' });
    assert.ok(duplicated.id);
    assert.notEqual(duplicated.id, createdPromo.id);
    assert.equal(duplicated.name, `Copy of ${createdPromo.name}`);
    assert.ok(duplicated.code.startsWith(`${testCode}_COPY_`));
    assert.equal(duplicated.paidMonths, 12);
    assert.equal(duplicated.freeMonths, 3);
    assert.equal(duplicated.minSeats, 5);
    assert.equal(duplicated.priority, 50);
    assert.equal(duplicated.allowCoupons, false);
    assert.equal(duplicated.active, true);
    assert.equal(duplicated.isArchived, false);

    // Clean up duplicate
    await prisma.subscriptionPromotion.delete({ where: { id: duplicated.id } });
  });

  await t.test('4. Archive promotion deactivates it and excludes from eligible offers', async () => {
    const archived = await archivePromotion(createdPromo.id);
    assert.equal(archived.isArchived, true);
    assert.equal(archived.active, false);

    const eligible = await listEligiblePromotions({
      termMonths: 12,
      seatCount: 10,
      context: 'RENEWALS',
    });
    const found = eligible.find((o) => o.id === createdPromo.id);
    assert.equal(found, undefined, 'Archived promotion must be excluded from eligible offers');
  });

  await t.test('5. Record promotion redemption saves complete immutable audit snapshot', async () => {
    const tenant = await prisma.tenant.findFirst({ select: { id: true } });
    const sub = await prisma.subscription.findFirst({ select: { id: true, endsAt: true } });

    if (!tenant || !sub) return;

    const startDate = new Date();
    const ext = calculateSubscriptionExtension({
      startsAt: startDate,
      termMonths: 12,
      promotion: createdPromo,
    });

    const redemption = await prisma.$transaction(async (tx) => {
      return recordPromotionRedemption(tx, {
        promotionId: createdPromo.id,
        subscriptionId: sub.id,
        tenantId: tenant.id,
        promotionName: createdPromo.name,
        promoCode: createdPromo.code,
        originalEndsAt: sub.endsAt,
        finalEndsAt: ext.endsAt,
        seatCount: 10,
        unitPrice: 3999,
        couponCode: null,
        couponDiscount: 0,
        gstAmount: 7198.2,
        netPayable: 47188.2,
        paidMonths: 12,
        freeMonths: 3,
        totalMonths: 15,
        paidRevenue: 47188.2,
      });
    });

    assert.ok(redemption.id);
    assert.equal(redemption.promotionName, createdPromo.name);
    assert.equal(redemption.promoCode, createdPromo.code);
    assert.equal(redemption.seatCount, 10);
    assert.equal(Number(redemption.unitPrice), 3999);
    assert.equal(Number(redemption.gstAmount), 7198.2);
    assert.equal(Number(redemption.netPayable), 47188.2);
    assert.equal(redemption.paidMonths, 12);
    assert.equal(redemption.freeMonths, 3);
    assert.equal(redemption.totalMonths, 15);

    // Cleanup redemption and test promo
    await prisma.promotionRedemption.delete({ where: { id: redemption.id } });
  });

  await t.test('6. Coupon-Specific Promotion Assignment (Strict Independent Coupon Logic)', async () => {
    // Create test coupons: COUPON_ASSIGNED and COUPON_UNASSIGNED
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const cAssigned = await prisma.coupon.create({
      data: {
        code: `KALI_${suffix}`,
        discountType: 'PERCENT',
        discountValue: 50,
        active: true,
      },
    });
    const cUnassigned = await prisma.coupon.create({
      data: {
        code: `SPEC_${suffix}`,
        discountType: 'PERCENT',
        discountValue: 30,
        active: true,
      },
    });

    // Create Promotion with allowNoCoupon: false and assigned to cAssigned only
    const promoSpecific = await prisma.subscriptionPromotion.create({
      data: {
        name: `Annual Booster Specific ${suffix}`,
        paidMonths: 12,
        freeMonths: 2,
        allowCoupons: true,
        allowNoCoupon: false,
        active: true,
        isArchived: false,
        startsAt: new Date(Date.now() - 10000),
        eligibility: 'ALL',
        applyToAllPackages: true,
        coupons: {
          create: [{ couponId: cAssigned.id }],
        },
      },
      include: {
        coupons: true,
      },
    });

    try {
      // Case A: Renewal with ASSIGNED coupon (cAssigned) -> MUST MATCH and get 2 free months
      const matchAssigned = await findEligiblePromotion({
        termMonths: 12,
        seatCount: 1,
        context: 'RENEWALS',
        couponId: cAssigned.id,
        couponCode: cAssigned.code,
      });
      assert.ok(matchAssigned, 'Assigned coupon must match promotion');
      assert.equal(matchAssigned.id, promoSpecific.id);
      assert.equal(matchAssigned.freeMonths, 2);

      // Case B: Renewal with UNASSIGNED coupon (cUnassigned) -> MUST NOT MATCH
      const matchUnassigned = await findEligiblePromotion({
        termMonths: 12,
        seatCount: 1,
        context: 'RENEWALS',
        couponId: cUnassigned.id,
        couponCode: cUnassigned.code,
      });
      const unassignedGotSpecific = matchUnassigned?.id === promoSpecific.id;
      assert.equal(unassignedGotSpecific, false, 'Unassigned coupon must NOT receive this promotion');

      // Case C: Renewal WITHOUT coupon when allowNoCoupon is FALSE -> MUST NOT MATCH
      const matchNoCoupon = await findEligiblePromotion({
        termMonths: 12,
        seatCount: 1,
        context: 'RENEWALS',
      });
      const noCouponGotSpecific = matchNoCoupon?.id === promoSpecific.id;
      assert.equal(noCouponGotSpecific, false, 'Renewal without coupon must NOT receive promotion when allowNoCoupon is false');

      // Case D: Toggle allowNoCoupon to TRUE -> Renewal without coupon MUST MATCH
      await prisma.subscriptionPromotion.update({
        where: { id: promoSpecific.id },
        data: { allowNoCoupon: true },
      });
      const matchNoCouponAllowed = await findEligiblePromotion({
        termMonths: 12,
        seatCount: 1,
        context: 'RENEWALS',
      });
      assert.ok(matchNoCouponAllowed, 'Renewal without coupon matches when allowNoCoupon is true');
      assert.equal(matchNoCouponAllowed.id, promoSpecific.id);
    } finally {
      // Teardown test coupons & promo
      await prisma.subscriptionPromotion.delete({ where: { id: promoSpecific.id } }).catch(() => {});
      await prisma.coupon.delete({ where: { id: cAssigned.id } }).catch(() => {});
      await prisma.coupon.delete({ where: { id: cUnassigned.id } }).catch(() => {});
    }
  });

  // Teardown
  if (createdPromo?.id) {
    await prisma.subscriptionPromotion.deleteMany({ where: { id: createdPromo.id } });
  }
});
