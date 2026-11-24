import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { normalizeCompanyName, couponValidationError, computePricing } from '../../src/lib/pricing.js';
import { getRegistrationConfig, updateRegistrationConfig } from '../../src/services/registrationConfig.service.js';
import { computeRegistrationPricing, calculateLicenceBreakdown, validateLicenseQuantity } from '../../src/services/licenceCalculation.service.js';

test('Centralized Pricing & Company-Specific Coupon Validation Suite', async (t) => {
  let initialUnitPrice;

  await t.test('1. Company Name Normalization Function', () => {
    // Leading/trailing spaces and multiple consecutive whitespace collapsed
    assert.equal(normalizeCompanyName('   Acme   Technologies   Pvt   Ltd   '), 'acme technologies pvt ltd');
    assert.equal(normalizeCompanyName('ACME TECHNOLOGIES PVT LTD'), 'acme technologies pvt ltd');
    assert.equal(normalizeCompanyName('  Acme \t Technologies \n Pvt Ltd '), 'acme technologies pvt ltd');
    assert.equal(normalizeCompanyName(''), '');
    assert.equal(normalizeCompanyName(null), '');
  });

  await t.test('2. Single Source of Truth for Pricing (Platform Owner Setting)', async () => {
    initialUnitPrice = await getRegistrationConfig('LICENSE_UNIT_PRICE', 5000);

    // Update config to 6000
    await updateRegistrationConfig({
      key: 'LICENSE_UNIT_PRICE',
      value: '6000',
      actor: 'platform.owner@test.com',
      reason: 'Setting unit price to 6000 for test verification',
    });

    const activeUnitPrice = await getRegistrationConfig('LICENSE_UNIT_PRICE');
    assert.equal(activeUnitPrice, 6000, 'Centralized unit price must be 6000');

    // Compute pricing for 10 licenses
    const pricing = await computeRegistrationPricing({
      cmdEmail: 'cmd@acme.com',
      additionalLicenses: 9, // 1 CMD + 9 = 10 licenses
    });

    assert.equal(pricing.unitPrice, 6000, 'Pricing calculation must use centralized unit price');
    assert.equal(pricing.totalLicenses, 10);
    assert.equal(pricing.subtotalAmount, 60000, 'Subtotal = 10 * 6000 = 60,000');
    assert.equal(pricing.gstAmount, 10800, 'GST = 18% of 60,000 = 10,800');
    assert.equal(pricing.totalAmount, 70800, 'Total payable = 70,800');
  });

  await t.test('3. Company-Specific Offer Validation - Name Matching & Mismatch Rejection', () => {
    const companyOfferCoupon = {
      id: 'coupon-test-co-1',
      code: 'OFFER-ACME10',
      active: true,
      status: 'UNUSED',
      companyName: 'Acme Technologies Pvt Ltd',
      totalLicenses: 10,
      timesUsed: 0,
      usageLimit: 1,
    };

    // Exactly matching company name
    const match1 = couponValidationError(companyOfferCoupon, {
      companyName: 'Acme Technologies Pvt Ltd',
      totalLicenses: 10,
    });
    assert.equal(match1, null, 'Exact match should have no validation error');

    // Matching with irregular leading/trailing/multiple spaces and mixed casing
    const match2 = couponValidationError(companyOfferCoupon, {
      companyName: '   acme   technologies   pvt   ltd  ',
      totalLicenses: 10,
    });
    assert.equal(match2, null, 'Normalized match should have no validation error');

    // Mismatched company name should be rejected with clear message
    const mismatch = couponValidationError(companyOfferCoupon, {
      companyName: 'Beta Systems India Pvt Ltd',
      totalLicenses: 10,
    });
    assert.equal(
      mismatch,
      'This coupon was issued exclusively for "Acme Technologies Pvt Ltd" and cannot be used for "Beta Systems India Pvt Ltd".'
    );

    // Empty company name on company offer should be rejected
    const emptyCo = couponValidationError(companyOfferCoupon, {
      companyName: '',
      totalLicenses: 10,
    });
    assert.equal(
      emptyCo,
      'This offer is exclusively reserved for "Acme Technologies Pvt Ltd". Please enter your registered company legal name to proceed.'
    );
  });

  await t.test('4. License Quantity Exact Matching & Mismatch Rejection', () => {
    const companyOfferCoupon = {
      id: 'coupon-test-co-2',
      code: 'OFFER-10SEATS',
      active: true,
      status: 'UNUSED',
      companyName: 'Acme Technologies Pvt Ltd',
      totalLicenses: 10,
      timesUsed: 0,
      usageLimit: 1,
    };

    // Exact matching quantity (10 licenses)
    const exactQty = couponValidationError(companyOfferCoupon, {
      companyName: 'Acme Technologies Pvt Ltd',
      totalLicenses: 10,
    });
    assert.equal(exactQty, null, 'Exact license quantity match should be valid');

    // Mismatched quantity (selected 8 licenses)
    const underQty = couponValidationError(companyOfferCoupon, {
      companyName: 'Acme Technologies Pvt Ltd',
      totalLicenses: 8,
    });
    assert.equal(
      underQty,
      'This coupon requires exactly 10 licence(s). Your current selection is for 8 licence(s). Please adjust your employee seats to match the offer.'
    );

    // Mismatched quantity (selected 15 licenses)
    const overQty = couponValidationError(companyOfferCoupon, {
      companyName: 'Acme Technologies Pvt Ltd',
      totalLicenses: 15,
    });
    assert.equal(
      overQty,
      'This coupon requires exactly 10 licence(s). Your current selection is for 15 licence(s). Please adjust your employee seats to match the offer.'
    );
  });

  await t.test('5. Generic Coupon Mode (Unrestricted by Company or Exact Seats)', () => {
    const genericCoupon = {
      id: 'coupon-generic-1',
      code: 'WELCOME10',
      active: true,
      status: 'UNUSED',
      companyName: null, // Generic coupon has no specific company attached
      totalLicenses: null,
      timesUsed: 0,
      usageLimit: 100,
    };

    // Generic coupon should work for any company name and any license quantity
    const res1 = couponValidationError(genericCoupon, {
      companyName: 'Any Random Company Corp',
      totalLicenses: 5,
    });
    assert.equal(res1, null, 'Generic coupon should apply to any company');

    const res2 = couponValidationError(genericCoupon, {
      companyName: 'Another Different Company',
      totalLicenses: 50,
    });
    assert.equal(res2, null, 'Generic coupon should apply to any seat count');
  });

  await t.test('6. Promotional Extension (Free Bonus Months without Increasing Payable Amount)', async () => {
    const promoOfferCoupon = {
      id: 'coupon-promo-1',
      code: 'OFFER-12PLUS2',
      active: true,
      status: 'UNUSED',
      companyName: 'Acme Technologies Pvt Ltd',
      totalLicenses: 10,
      promoMonths: 2, // 2 free promotional months
      discountType: 'PERCENT',
      discountValue: 10, // 10% discount
    };

    const startsAt = new Date('2026-01-01T00:00:00Z');
    const pricing = await computeRegistrationPricing(
      {
        cmdEmail: 'cmd@acme.com',
        additionalLicenses: 9, // 10 licenses total
      },
      {
        coupon: promoOfferCoupon,
        startsAt,
      }
    );

    // Subscription Duration breakdown
    assert.equal(pricing.paidDurationMonths, 12, 'Paid duration must be 12 months');
    assert.equal(pricing.freeDurationMonths, 2, 'Free promotional duration must be 2 months');
    assert.equal(pricing.totalDurationMonths, 14, 'Total subscription validity must be 14 months');

    // Monetary breakdown (6000 unit price * 10 licenses = 60,000 subtotal)
    // 10% discount = 6,000. Net taxable = 54,000. GST 18% = 9,720. Total = 63,720.
    assert.equal(pricing.unitPrice, 6000);
    assert.equal(pricing.subtotalAmount, 60000, 'Subtotal is charged ONLY for the 12 base months');
    assert.equal(pricing.discountAmount, 6000, '10% discount applied');
    assert.equal(pricing.taxableAmount, 54000, 'Net taxable is subtotal minus discount');
    assert.equal(pricing.gstAmount, 9720, 'Statutory GST 18%');
    assert.equal(pricing.totalAmount, 63720, 'Total final payable');

    // Expiry date verification
    const expectedExpiry = new Date(pricing.endsAt);
    assert.equal(expectedExpiry.getFullYear(), 2027);
    assert.equal(expectedExpiry.getMonth(), 2); // March 2027 (Jan + 14 months)
  });

  await t.test('7. Inactive, Already-Used, and Expired Coupon Protection', () => {
    const usedCoupon = {
      active: true,
      status: 'USED',
      companyName: 'Acme Technologies Pvt Ltd',
    };
    assert.equal(couponValidationError(usedCoupon), 'Coupon has already been used');

    const inactiveCoupon = {
      active: false,
      status: 'UNUSED',
      companyName: 'Acme Technologies Pvt Ltd',
    };
    assert.equal(couponValidationError(inactiveCoupon), 'Coupon is inactive');

    const expiredCoupon = {
      active: true,
      status: 'UNUSED',
      expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
    };
    assert.equal(couponValidationError(expiredCoupon), 'Coupon has expired');
  });

  await t.test('8. Single Source of Truth for Discount Percentage: Generic Coupon vs Company-Based Offer', async () => {
    // A. Generic coupon: leads/tracking only, no independent discount percentage
    const genericTrackingCoupon = {
      id: 'coupon-generic-tracking',
      code: 'TRACKLEAD',
      active: true,
      status: 'UNUSED',
      companyName: null,
      totalLicenses: null,
      timesUsed: 0,
      usageLimit: 50,
      discountType: 'PERCENT',
      discountValue: 0,
      discountPercent: 0,
    };

    const genericPricing = computePricing({
      quantity: 10,
      unitPrice: 6000,
      coupon: genericTrackingCoupon,
      gstRate: 0.18,
    });

    assert.equal(genericPricing.unitPrice, 6000);
    assert.equal(genericPricing.subtotal, 60000);
    assert.equal(genericPricing.discountAmount, 0, 'Generic coupon must not apply any discount to subtotal');
    assert.equal(genericPricing.discountedSubtotal, 60000);
    assert.equal(genericPricing.gstAmount, 10800);
    assert.equal(genericPricing.total, 70800);

    // B. Company-Based Manual Offer: Single authoritative source of truth for discount percentage
    const authorizedCompanyOffer = {
      id: 'coupon-offer-auth',
      code: 'OFFER-CORP10',
      active: true,
      status: 'UNUSED',
      companyName: 'Corporate Solutions Ltd',
      totalLicenses: 10,
      discountType: 'PERCENT',
      discountValue: 10,
      discountPercent: 10,
      promoMonths: 0,
    };

    const offerPricing = computePricing({
      quantity: 10,
      unitPrice: 6000,
      coupon: authorizedCompanyOffer,
      gstRate: 0.18,
    });

    assert.equal(offerPricing.unitPrice, 6000);
    assert.equal(offerPricing.subtotal, 60000);
    assert.equal(offerPricing.discountAmount, 6000, 'Company offer applies exactly the authorized 10% discount');
    assert.equal(offerPricing.discountedSubtotal, 54000);
    assert.equal(offerPricing.gstAmount, 9720);
    assert.equal(offerPricing.total, 63720, 'Final payable reflects single authoritative discount applied once');
  });

  await t.test('6. Dynamic Minimum License Quantity Validation in BDM Coupons', async () => {
    const originalMin = await getRegistrationConfig('MIN_LICENSE_QUANTITY', 1);

    try {
      // Set Minimum License Purchase Quantity = 6 (as configured in Billing Settings)
      await updateRegistrationConfig({
        key: 'MIN_LICENSE_QUANTITY',
        value: '6',
        actor: 'test.admin',
        reason: 'Test minimum license quantity validation',
      });

      // 2 licenses -> Blocked
      const val2 = await validateLicenseQuantity(2);
      assert.equal(val2.valid, false);
      assert.equal(val2.error, 'Minimum 6 employee licenses are required.');
      assert.equal(val2.code, 'MIN_LICENSE_QUANTITY_NOT_MET');

      // 5 licenses -> Blocked
      const val5 = await validateLicenseQuantity(5);
      assert.equal(val5.valid, false);
      assert.equal(val5.error, 'Minimum 6 employee licenses are required.');

      // 6 licenses -> Allowed
      const val6 = await validateLicenseQuantity(6);
      assert.equal(val6.valid, true);
      assert.equal(val6.totalLicenses, 6);

      // 10 licenses -> Allowed
      const val10 = await validateLicenseQuantity(10);
      assert.equal(val10.valid, true);
      assert.equal(val10.totalLicenses, 10);

      // Dynamic change: Platform Owner increases minimum quantity from 6 to 10
      await updateRegistrationConfig({
        key: 'MIN_LICENSE_QUANTITY',
        value: '10',
        actor: 'test.admin',
        reason: 'Test dynamic minimum license quantity update to 10',
      });

      // 6 licenses -> Now Blocked!
      const val6After = await validateLicenseQuantity(6);
      assert.equal(val6After.valid, false);
      assert.equal(val6After.error, 'Minimum 10 employee licenses are required.');

      // 10 licenses -> Allowed
      const val10After = await validateLicenseQuantity(10);
      assert.equal(val10After.valid, true);
      assert.equal(val10After.totalLicenses, 10);

      // Exceeding maximum limit (10001) -> Blocked
      const valMax = await validateLicenseQuantity(10001);
      assert.equal(valMax.valid, false);
      assert.equal(valMax.code, 'MAX_LICENSE_QUANTITY_EXCEEDED');
    } finally {
      // Restore original config
      await updateRegistrationConfig({
        key: 'MIN_LICENSE_QUANTITY',
        value: String(originalMin || 6),
        actor: 'test.cleanup',
        reason: 'Restore original min license quantity after test',
      });
    }
  });

  // Restore initial price if needed
  if (initialUnitPrice) {
    await updateRegistrationConfig({
      key: 'LICENSE_UNIT_PRICE',
      value: String(initialUnitPrice),
      actor: 'test.cleanup',
      reason: 'Restore price after test execution',
    });
  }
});
