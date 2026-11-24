import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { couponSchema } from '../../src/validations/coupon.schema.js';
import { computePricing } from '../../src/lib/pricing.js';
import { computeRegistrationPricing } from '../../src/services/licenceCalculation.service.js';

describe('BDM Coupon Multi-Year Pricing & Dynamic Subscription Duration', () => {
  const round2 = (val) => Math.round((Number(val) + Number.EPSILON) * 100) / 100;

  function addCalendarMonths(dateStr, monthsToAdd) {
    const d = new Date(dateStr);
    const day = d.getDate();
    d.setMonth(d.getMonth() + Number(monthsToAdd));
    if (d.getDate() !== day) {
      d.setDate(0);
    }
    return d.toISOString().split('T')[0];
  }

  describe('Coupon Schema Validation for subscriptionYears', () => {
    it('accepts subscriptionYears of 1, 2, or 3 and defaults to 1 when omitted', () => {
      const defaultParsed = couponSchema.parse({
        code: 'TEST-1YR',
        discountType: 'PERCENT',
        discountValue: 10,
      });
      assert.equal(defaultParsed.subscriptionYears, 1);

      const twoYearsParsed = couponSchema.parse({
        code: 'TEST-2YR',
        discountType: 'PERCENT',
        discountValue: 10,
        subscriptionYears: 2,
      });
      assert.equal(twoYearsParsed.subscriptionYears, 2);

      const threeYearsParsed = couponSchema.parse({
        code: 'TEST-3YR',
        discountType: 'PERCENT',
        discountValue: 10,
        subscriptionYears: 3,
      });
      assert.equal(threeYearsParsed.subscriptionYears, 3);
    });

    it('rejects invalid subscriptionYears (0 or 15 or negative)', () => {
      assert.throws(() => {
        couponSchema.parse({
          code: 'TEST-INVALID',
          discountType: 'PERCENT',
          discountValue: 10,
          subscriptionYears: 0,
        });
      });

      assert.throws(() => {
        couponSchema.parse({
          code: 'TEST-INVALID',
          discountType: 'PERCENT',
          discountValue: 10,
          subscriptionYears: 15,
        });
      });
    });

    it('validates subscriptionYears in update payload', () => {
      const parsedUpdate = couponSchema.parse({
        subscriptionYears: 2,
      });
      assert.equal(parsedUpdate.subscriptionYears, 2);
    });
  });

  describe('Multi-Year Pricing Formulas & Dynamic Discount / GST Calculations', () => {
    const UNIT_PRICE = 4999;
    const GST_RATE = 0.18;

    it('calculates 1 Year duration: 12 licenses × ₹4,999 × 1 yr = ₹59,988 subtotal', () => {
      const totalLicenses = 12;
      const subscriptionYears = 1;
      const discountPercent = 0;

      const licenseAmount = round2(totalLicenses * UNIT_PRICE * subscriptionYears);
      const discountAmount = round2((licenseAmount * discountPercent) / 100);
      const netTaxable = round2(licenseAmount - discountAmount);
      const gstAmount = round2(netTaxable * GST_RATE);
      const finalPayable = round2(netTaxable + gstAmount);

      assert.equal(licenseAmount, 59988);
      assert.equal(netTaxable, 59988);
      assert.equal(gstAmount, 10797.84);
      assert.equal(finalPayable, 70785.84);

      const startDate = '2026-11-25';
      const endDate = addCalendarMonths(startDate, subscriptionYears * 12);
      assert.equal(endDate, '2027-11-25');
    });

    it('calculates 2 Years duration: 12 licenses × ₹4,999 × 2 yrs = ₹1,19,976 subtotal', () => {
      const totalLicenses = 12;
      const subscriptionYears = 2;
      const discountPercent = 0;

      const licenseAmount = round2(totalLicenses * UNIT_PRICE * subscriptionYears);
      const discountAmount = round2((licenseAmount * discountPercent) / 100);
      const netTaxable = round2(licenseAmount - discountAmount);
      const gstAmount = round2(netTaxable * GST_RATE);
      const finalPayable = round2(netTaxable + gstAmount);

      assert.equal(licenseAmount, 119976);
      assert.equal(netTaxable, 119976);
      assert.equal(gstAmount, 21595.68);
      assert.equal(finalPayable, 141571.68);

      const startDate = '2026-11-25';
      const endDate = addCalendarMonths(startDate, subscriptionYears * 12);
      assert.equal(endDate, '2028-11-25');
    });

    it('calculates 3 Years duration: 12 licenses × ₹4,999 × 3 yrs = ₹1,79,964 subtotal', () => {
      const totalLicenses = 12;
      const subscriptionYears = 3;
      const discountPercent = 0;

      const licenseAmount = round2(totalLicenses * UNIT_PRICE * subscriptionYears);
      const discountAmount = round2((licenseAmount * discountPercent) / 100);
      const netTaxable = round2(licenseAmount - discountAmount);
      const gstAmount = round2(netTaxable * GST_RATE);
      const finalPayable = round2(netTaxable + gstAmount);

      assert.equal(licenseAmount, 179964);
      assert.equal(netTaxable, 179964);
      assert.equal(gstAmount, 32393.52);
      assert.equal(finalPayable, 212357.52);

      const startDate = '2026-11-25';
      const endDate = addCalendarMonths(startDate, subscriptionYears * 12);
      assert.equal(endDate, '2029-11-25');
    });

    it('calculates 3 Years duration + 6 Promotional Free Months (+42 months total validity)', () => {
      const subscriptionYears = 3;
      const promoMonths = 6;
      const startDate = '2026-11-25';

      const totalMonths = subscriptionYears * 12 + promoMonths;
      assert.equal(totalMonths, 42);

      const endDate = addCalendarMonths(startDate, totalMonths);
      // 2026-11-25 + 42 months = 2030-05-25
      assert.equal(endDate, '2030-05-25');
    });

    it('calculates 3 Years duration with 20% BDM Discount', () => {
      const totalLicenses = 12;
      const subscriptionYears = 3;
      const discountPercent = 20;

      const licenseAmount = round2(totalLicenses * UNIT_PRICE * subscriptionYears);
      const discountAmount = round2((licenseAmount * discountPercent) / 100);
      const netTaxable = round2(licenseAmount - discountAmount);
      const gstAmount = round2(netTaxable * GST_RATE);
      const finalPayable = round2(netTaxable + gstAmount);

      assert.equal(licenseAmount, 179964);
      assert.equal(discountAmount, 35992.8);
      assert.equal(netTaxable, 143971.2);
      assert.equal(gstAmount, 25914.82);
      assert.equal(finalPayable, 169886.02);
    });
  });

  describe('Integration with computePricing lib', () => {
    it('applies years parameter correctly in computePricing', () => {
      const result1Yr = computePricing({
        quantity: 10,
        unitPrice: 5000,
        years: 1,
        gstRate: 0.18,
      });
      assert.equal(result1Yr.subtotal, 50000);
      assert.equal(result1Yr.discountedSubtotal, 50000);
      assert.equal(result1Yr.gstAmount, 9000);
      assert.equal(result1Yr.total, 59000);

      const result3Yr = computePricing({
        quantity: 10,
        unitPrice: 5000,
        years: 3,
        gstRate: 0.18,
      });
      assert.equal(result3Yr.subtotal, 150000);
      assert.equal(result3Yr.discountedSubtotal, 150000);
      assert.equal(result3Yr.gstAmount, 27000);
      assert.equal(result3Yr.total, 177000);
    });

    it('applies coupon.subscriptionYears in computePricing when coupon is passed', () => {
      const coupon = {
        code: 'MULTIYEAR3',
        discountType: 'PERCENT',
        discountValue: 10,
        subscriptionYears: 3,
      };

      const result = computePricing({
        quantity: 10,
        unitPrice: 5000,
        coupon,
        gstRate: 0.18,
      });

      // 10 * 5000 * 3 = 150000 subtotal
      assert.equal(result.subtotal, 150000);
      // 10% discount on 150000 = 15000
      assert.equal(result.discountAmount, 15000);
      // taxable = 135000
      assert.equal(result.discountedSubtotal, 135000);
      // tax = 24300
      assert.equal(result.gstAmount, 24300);
      // final = 159300
      assert.equal(result.total, 159300);
    });
  });

  describe('Integration with computeRegistrationPricing in licenceCalculation.service', () => {
    it('honors coupon.subscriptionYears for multi-year base validity months', async () => {
      const coupon = {
        id: 'cp_test_3yr',
        code: 'CORP-3YR',
        discountType: 'PERCENT',
        discountValue: 0,
        subscriptionYears: 3,
        promoMonths: 6,
      };

      const result = await computeRegistrationPricing(
        { cmdEmail: 'cmd@test.com', additionalLicenses: 11 },
        {
          overrideUnitPrice: 4999,
          overrideGstRate: 0.18,
          taxEnabled: true,
          coupon,
        }
      );

      // Subtotal should be 12 * 4999 * 3 = 179964
      assert.equal(result.totalLicenses, 12);
      assert.equal(result.subtotalAmount, 179964);
      assert.equal(result.taxableAmount, 179964);
      assert.equal(result.gstAmount, 32393.52);
      assert.equal(result.totalAmount, 212357.52);
      // paidDurationMonths should be 3 * 12 = 36 months
      assert.equal(result.paidDurationMonths, 36);
      // totalDurationMonths should be 36 + 6 = 42 months
      assert.equal(result.totalDurationMonths, 42);
    });
  });
});
