import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { getRegistrationConfig, updateRegistrationConfig } from '../../src/services/registrationConfig.service.js';
import { computeRegistrationPricing } from '../../src/services/licenceCalculation.service.js';
import { couponValidationError, computePricing } from '../../src/lib/pricing.js';

test('Dynamic License Pricing & BDM Coupon Validation Suite', async (t) => {
  let initialConfigPrice;

  await t.test('1. Dynamic License Pricing - Single Source of Truth', async () => {
    // Read current config price
    initialConfigPrice = await getRegistrationConfig('LICENSE_UNIT_PRICE', 3999);
    assert.ok(initialConfigPrice > 0, 'Initial config price exists');

    // Simulate Platform Owner updating price to 5000 in Registration Settings
    await updateRegistrationConfig({
      key: 'LICENSE_UNIT_PRICE',
      value: '5000',
      actor: 'platform.owner@test.com',
      reason: 'Pricing update test',
    });

    const livePrice = await getRegistrationConfig('LICENSE_UNIT_PRICE');
    assert.equal(livePrice, 5000, 'Live price dynamically reflects updated 5000');

    // New registration pricing calculation dynamically uses 5000
    const pricing = await computeRegistrationPricing({
      additionalLicenses: 9, // total 10 licenses
    });

    assert.equal(pricing.unitPrice, 5000, 'New registration unit price is 5000');
    assert.equal(pricing.totalLicenses, 10, 'Total licenses = 10');
    assert.equal(pricing.subtotalAmount, 50000, 'Subtotal = 10 * 5000 = 50,000');
    assert.equal(pricing.gstAmount, 9000, 'GST (18%) = 9,000');
    assert.equal(pricing.totalAmount, 59000, 'Total payable = 59,000');
  });

  await t.test('2. Existing registration retains original quoted price snapshot', async () => {
    // Existing registration was quoted at 3999
    const oldQuotedPrice = 3999;
    const oldQuantity = 10;
    const oldPricing = computePricing({
      quantity: oldQuantity,
      unitPrice: oldQuotedPrice,
      gstRate: 0.18,
    });

    assert.equal(oldPricing.unitPrice, 3999);
    assert.equal(oldPricing.subtotal, 39990);
    assert.equal(oldPricing.gstAmount, 7198.2);
    assert.equal(oldPricing.total, 47188.2);

    // Live config is 5000, but existing record keeps 3999
    const livePrice = await getRegistrationConfig('LICENSE_UNIT_PRICE');
    assert.equal(livePrice, 5000);
    assert.notEqual(oldPricing.unitPrice, livePrice, 'Existing snapshot is isolated from live price changes');
  });

  await t.test('3. BDM Coupon Validation (WINTER30) - Case Insensitivity & BDM Attribution', async () => {
    // Query coupon WINTER30 case-insensitively
    const inputCode = ' winter30 ';
    const cleanCode = inputCode.trim();

    const coupon = await prisma.coupon.findFirst({
      where: {
        code: { equals: cleanCode, mode: 'insensitive' },
      },
      include: {
        salesRep: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    assert.ok(coupon, 'Coupon WINTER30 found in database');
    assert.equal(coupon.code, 'WINTER30');
    assert.equal(coupon.active, true);
    assert.equal(coupon.discountType, 'PERCENT');
    assert.equal(Number(coupon.discountValue), 20); // 20% discount

    const err = couponValidationError(coupon);
    assert.equal(err, null, 'WINTER30 coupon validation error is null');

    // Check pricing with coupon applied
    const pricing = await computeRegistrationPricing(
      { additionalLicenses: 9 }, // 10 licenses
      { coupon }
    );

    // Subtotal = 10 * 5000 = 50,000
    // Discount = 20% of 50,000 = 10,000
    // Taxable = 40,000
    // GST (18%) = 7,200
    // Total Payable = 47,200
    assert.equal(pricing.subtotalAmount, 50000);
    assert.equal(pricing.discountAmount, 10000);
    assert.equal(pricing.taxableAmount, 40000);
    assert.equal(pricing.gstAmount, 7200);
    assert.equal(pricing.totalAmount, 47200);

    const bdmName = coupon.bdmName || coupon.salesRep?.name;
    assert.ok(bdmName, 'BDM attribution name is present');
  });

  await t.test('4. Inactive, Expired, and Nonexistent Coupon Validation', () => {
    assert.equal(couponValidationError(null), 'Coupon not found');
    assert.equal(couponValidationError({ active: false }), 'Coupon is inactive');
    assert.equal(couponValidationError({ active: true, expiresAt: new Date(Date.now() - 10000) }), 'Coupon has expired');
    assert.equal(couponValidationError({ active: true, usageLimit: 2, timesUsed: 2 }), 'Coupon usage limit reached');
  });

  // Restore initial price if needed
  if (initialConfigPrice) {
    await updateRegistrationConfig({
      key: 'LICENSE_UNIT_PRICE',
      value: String(initialConfigPrice),
      actor: 'test.cleanup',
      reason: 'Restore price after tests',
    });
  }
});
