import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { couponValidationError } from '../../src/lib/pricing.js';

describe('BDM Coupon Management & Company-Based Manual Offer System', () => {
  let createdCouponId = null;
  const testCode = 'OFFER-TEST-' + Date.now().toString(36).toUpperCase();

  it('calculates company offer pricing, dates, and promotional extension correctly', async () => {
    const totalLicenses = 10;
    const perLicenseCost = 3999;
    const licenseAmount = totalLicenses * perLicenseCost; // 39990
    const discountPercent = 10;
    const discountAmount = Math.round((licenseAmount * discountPercent) / 100); // 3999
    const finalAmount = licenseAmount - discountAmount; // 35991

    const startDate = new Date('2026-12-01T00:00:00.000Z');
    const promoMonths = 2;

    // End date calculation: 12 months + 2 promo months = 14 months -> 2028-02-01
    const targetMonth = startDate.getMonth() + 12 + promoMonths;
    const targetYear = startDate.getFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const endDate = new Date(targetYear, normalizedMonth, startDate.getDate());

    assert.equal(licenseAmount, 39990);
    assert.equal(finalAmount, 35991);
    assert.equal(endDate.getFullYear(), 2028);
    assert.equal(endDate.getMonth(), 1); // February (0-indexed: 1)
    assert.equal(endDate.getDate(), 1);

    // Create coupon record in DB
    const coupon = await prisma.coupon.create({
      data: {
        code: testCode,
        offerReference: testCode,
        discountType: 'PERCENT',
        discountValue: discountPercent,
        companyName: 'Test Automation Corp Ltd',
        industry: 'Technology & Software',
        city: 'Bengaluru',
        totalLicenses,
        perLicenseCost,
        licenseAmount,
        discountPercent,
        finalAmount,
        startDate,
        endDate,
        promoMonths,
        usageLimit: 1,
        timesUsed: 0,
        status: 'UNUSED',
        active: true,
      },
    });

    createdCouponId = coupon.id;
    assert.ok(coupon.id);
    assert.equal(coupon.status, 'UNUSED');
    assert.equal(Number(coupon.licenseAmount), 39990);
    assert.equal(Number(coupon.finalAmount), 35991);
    assert.equal(coupon.promoMonths, 2);

    // Check validity
    const err = couponValidationError(coupon);
    assert.equal(err, null);
  });

  it('marks coupon as USED and prevents reuse', async () => {
    assert.ok(createdCouponId);

    // Mark as USED
    const updated = await prisma.coupon.update({
      where: { id: createdCouponId },
      data: {
        status: 'USED',
        timesUsed: 1,
        usedAt: new Date(),
        usedCompanyId: 'tenant-test-123',
        paymentReference: 'inv-test-999',
        activationReference: 'reg-test-888',
      },
    });

    assert.equal(updated.status, 'USED');
    assert.equal(updated.timesUsed, 1);

    // Validation should now fail because it is USED
    const err = couponValidationError(updated);
    assert.equal(err, 'Coupon has already been used');
  });

  after(async () => {
    if (createdCouponId) {
      await prisma.coupon.delete({ where: { id: createdCouponId } }).catch(() => {});
    }
  });
});
