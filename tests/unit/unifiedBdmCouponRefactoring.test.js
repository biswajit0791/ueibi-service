import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { prisma } from '../../src/lib/prisma.js';
import { couponSchema } from '../../src/validations/coupon.schema.js';
import { couponValidationError, computePricing } from '../../src/lib/pricing.js';
import { generateUniqueCouponCode } from '../../src/controllers/coupon.controller.js';

test('Unified BDM Coupon Management Refactoring Test Suite', async (t) => {
  const cuid = () => 'cm' + crypto.randomBytes(10).toString('hex');
  const uniqueCodeSuffix = Math.floor(Math.random() * 90000) + 10000;

  const createdCouponIds = [];

  t.after(async () => {
    if (createdCouponIds.length > 0) {
      await prisma.coupon.deleteMany({
        where: { id: { in: createdCouponIds } },
      });
    }
  });

  await t.test('1. Schema Validation: Optional Code, Trimming, and Uppercasing', () => {
    // Code omitted -> valid
    const omittedCode = couponSchema.parse({
      discountValue: 10,
    });
    assert.equal(omittedCode.code, undefined);

    // Code empty string -> preprocessed to undefined
    const blankCode = couponSchema.parse({
      code: '   ',
      discountValue: 10,
    });
    assert.equal(blankCode.code, undefined);

    // Custom code -> trimmed and converted to uppercase
    const customCode = couponSchema.parse({
      code: '  special_promo_50  ',
    });
    assert.equal(customCode.code, 'SPECIAL_PROMO_50');

    // Generic coupon does not require company or license fields
    const generic = couponSchema.parse({
      code: 'GENERIC100',
    });
    assert.equal(generic.companyName, undefined);
    assert.equal(generic.totalLicenses, undefined);
  });

  await t.test('2. Server-side Automatic Unique Code Generation with Collision Handling', async () => {
    // Generate code for generic
    const genCode = await generateUniqueCouponCode('GEN');
    assert.ok(genCode.startsWith('GEN-'), `Generated code "${genCode}" should start with "GEN-"`);
    assert.ok(genCode.length >= 10, 'Code should have sufficient entropy');

    // Generate code for offer
    const offerCode = await generateUniqueCouponCode('OFFER');
    assert.ok(offerCode.startsWith('OFFER-'), `Generated code "${offerCode}" should start with "OFFER-"`);

    // Verify generated code does not exist in DB
    const exists = await prisma.coupon.findUnique({
      where: { code: genCode },
    });
    assert.equal(exists, null, 'Generated code must be globally unique');
  });

  await t.test('3. Database Uniqueness Enforcement & Duplicate Code Prevention', async () => {
    const duplicateCode = `DUPTEST_${uniqueCodeSuffix}`;
    const firstId = cuid();
    createdCouponIds.push(firstId);

    const first = await prisma.coupon.create({
      data: {
        id: firstId,
        code: duplicateCode,
        discountType: 'PERCENT',
        discountValue: 0,
        active: true,
        usageLimit: null,
      },
    });
    assert.equal(first.code, duplicateCode);

    // Attempt inserting the exact same code must violate unique constraint
    await assert.rejects(
      async () => {
        const secondId = cuid();
        createdCouponIds.push(secondId);
        await prisma.coupon.create({
          data: {
            id: secondId,
            code: duplicateCode,
            discountType: 'PERCENT',
            discountValue: 0,
            active: true,
            usageLimit: null,
          },
        });
      },
      (err) => {
        return err.code === 'P2002' || /unique constraint/i.test(err.message);
      },
      'Database must enforce uniqueness on coupon code'
    );
  });

  await t.test('4. Generic Coupon: Completely Removed Usage Limit & Unlimited Redemptions', async () => {
    const genericCode = `UNLIMITED_${uniqueCodeSuffix}`;
    const genericId = cuid();
    createdCouponIds.push(genericId);

    const genericCoupon = await prisma.coupon.create({
      data: {
        id: genericId,
        code: genericCode,
        discountType: 'PERCENT',
        discountValue: 0,
        active: true,
        usageLimit: null, // No usage limit
        timesUsed: 0,
        companyName: null, // Generic coupon
      },
    });

    assert.equal(genericCoupon.usageLimit, null, 'Usage limit must be null for Generic Coupons');

    // Simulate 5 consecutive redemptions
    for (let i = 1; i <= 5; i++) {
      const updated = await prisma.coupon.update({
        where: { id: genericId },
        data: { timesUsed: { increment: 1 } },
      });
      assert.equal(updated.timesUsed, i);

      // Validation check must still pass without "usage limit reached" or "already used" error
      const error = couponValidationError(updated, { companyName: `Company_${i}` });
      assert.equal(error, null, `Generic coupon must remain valid after redemption #${i}`);
    }
  });

  await t.test('5. Company Offer: Single-Use Enforcement & Company Validation', async () => {
    const companyOfferCode = `OFFER_CO_${uniqueCodeSuffix}`;
    const offerId = cuid();
    createdCouponIds.push(offerId);

    const offerCoupon = await prisma.coupon.create({
      data: {
        id: offerId,
        code: companyOfferCode,
        discountType: 'PERCENT',
        discountValue: 10,
        discountPercent: 10,
        companyName: 'Acme Unified Technologies Ltd',
        totalLicenses: 12,
        subscriptionYears: 2,
        perLicenseCost: 4999,
        licenseAmount: 12 * 4999 * 2, // 1,19,976
        finalAmount: (12 * 4999 * 2) * 0.9, // 1,07,978.40
        active: true,
        usageLimit: 1,
        status: 'UNUSED',
        timesUsed: 0,
      },
    });

    // Valid when matching company applies
    const validCheck = couponValidationError(offerCoupon, {
      companyName: 'Acme Unified Technologies Ltd',
      totalLicenses: 12,
    });
    assert.equal(validCheck, null);

    // Mismatched company rejected
    const mismatchCompany = couponValidationError(offerCoupon, {
      companyName: 'Different Enterprises Inc',
      totalLicenses: 12,
    });
    assert.ok(mismatchCompany.includes('cannot be used for "Different Enterprises Inc"'));

    // Once marked used, company offer is blocked from further redemption
    const usedOffer = await prisma.coupon.update({
      where: { id: offerId },
      data: {
        timesUsed: 1,
        status: 'USED',
      },
    });
    const usedCheck = couponValidationError(usedOffer, {
      companyName: 'Acme Unified Technologies Ltd',
      totalLicenses: 12,
    });
    assert.equal(usedCheck, 'Coupon has already been used');
  });

  await t.test('6. Coupon Code & Calculation Safety: Identifier Only, No Financial Side-Effects', () => {
    // Changing code from 'GEN-1234' to 'CUSTOM_PROMO' or 'OFFER-ABCD' must not change pricing
    const basePricing1 = computePricing({
      quantity: 10,
      unitPrice: 4999,
      years: 3,
      gstRate: 0.18,
      coupon: {
        code: 'GEN-AUTO123',
        discountType: 'PERCENT',
        discountValue: 15,
        subscriptionYears: 3,
      },
    });

    const basePricing2 = computePricing({
      quantity: 10,
      unitPrice: 4999,
      years: 3,
      gstRate: 0.18,
      coupon: {
        code: 'COMPLETELY_DIFFERENT_CODE_XYZ',
        discountType: 'PERCENT',
        discountValue: 15,
        subscriptionYears: 3,
      },
    });

    assert.equal(basePricing1.subtotal, basePricing2.subtotal);
    assert.equal(basePricing1.discountAmount, basePricing2.discountAmount);
    assert.equal(basePricing1.discountedSubtotal, basePricing2.discountedSubtotal);
    assert.equal(basePricing1.gstAmount, basePricing2.gstAmount);
    assert.equal(basePricing1.total, basePricing2.total);

    // Formula correctness:
    // Subtotal: 10 * 4999 * 3 = 149,970
    assert.equal(basePricing1.subtotal, 149970);
    // Discount (15%): 149,970 * 0.15 = 22,495.50
    assert.equal(basePricing1.discountAmount, 22495.5);
    // Taxable / Discounted Subtotal: 149,970 - 22,495.50 = 127,474.50
    assert.equal(basePricing1.discountedSubtotal, 127474.5);
    // GST (18%): 127,474.50 * 0.18 = 22,945.41
    assert.equal(basePricing1.gstAmount, 22945.41);
    // Total: 127,474.50 + 22,945.41 = 150,419.91
    assert.equal(basePricing1.total, 150419.91);
  });

  await t.test('7. Edit, Activation, Deactivation and Status Transitions', async () => {
    const testId = cuid();
    createdCouponIds.push(testId);

    // Create active coupon
    const coupon = await prisma.coupon.create({
      data: {
        id: testId,
        code: `STATUS_TEST_${uniqueCodeSuffix}`,
        discountType: 'PERCENT',
        discountValue: 0,
        active: true,
        usageLimit: null,
      },
    });
    assert.equal(coupon.active, true);

    // Deactivate
    const deactivated = await prisma.coupon.update({
      where: { id: testId },
      data: { active: false },
    });
    assert.equal(deactivated.active, false);
    assert.equal(couponValidationError(deactivated), 'Coupon is inactive');

    // Reactivate
    const reactivated = await prisma.coupon.update({
      where: { id: testId },
      data: { active: true },
    });
    assert.equal(reactivated.active, true);
    assert.equal(couponValidationError(reactivated), null);
  });
});
