import test from 'node:test';
import assert from 'node:assert/strict';
import { computePricing, computeDiscount } from '../../src/lib/pricing.js';
import { validateGstin } from '../../src/lib/mouValidation.js';
import {
  publicPricingPreviewSchema,
  registrationSchema,
} from '../../src/validations/registration.schema.js';
import {
  createOrderSchema,
  verifyPaymentSchema,
  approveSchema,
} from '../../src/validations/finance.schema.js';

test('CMD Purchase Ownership & Finance Payment-Only Workflow Tests', async (t) => {
  await t.test('1. GSTIN format validation', () => {
    // Valid 15-char Indian GSTIN
    const validGstin = validateGstin('27ABCDE1234F1Z5');
    assert.equal(validGstin.valid, true);
    assert.equal(validGstin.value, '27ABCDE1234F1Z5');

    // Blank or null (optional)
    assert.equal(validateGstin('').valid, true);
    assert.equal(validateGstin(null).valid, true);
    assert.equal(validateGstin(undefined).valid, true);

    // Invalid GSTIN format
    assert.equal(validateGstin('12345').valid, false);
    assert.equal(validateGstin('27ABCDE1234F1Z').valid, false); // 14 chars
    assert.equal(validateGstin('27ABCDE1234F1Z59').valid, false); // 16 chars
    assert.equal(validateGstin('ZZABCDE1234F1Z5').valid, false); // Invalid state code
  });

  await t.test('2. Server Pricing Calculation for CMD Selection', () => {
    // 10 licenses @ 3999 without coupon
    const pricing10 = computePricing({
      quantity: 10,
      unitPrice: 3999,
      coupon: null,
      gstRate: 0.18,
    });
    assert.equal(pricing10.unitPrice, 3999);
    assert.equal(pricing10.subtotal, 39990);
    assert.equal(pricing10.discountAmount, 0);
    assert.equal(pricing10.gstRate, 0.18);
    assert.equal(pricing10.gstAmount, 7198.2);
    assert.equal(pricing10.total, 47188.2);

    // 25 licenses with 10% coupon
    const coupon10Pct = {
      id: 'cpn-1',
      code: 'PROMO10',
      discountType: 'PERCENT',
      discountValue: 10,
      active: true,
    };
    const pricing25 = computePricing({
      quantity: 25,
      unitPrice: 3999,
      coupon: coupon10Pct,
      gstRate: 0.18,
    });
    assert.equal(pricing25.subtotal, 99975);
    assert.equal(pricing25.discountAmount, 9997.5);
    assert.equal(pricing25.discountedSubtotal, 89977.5);
    assert.equal(pricing25.gstAmount, 16195.95);
    assert.equal(pricing25.total, 106173.45);
  });

  await t.test('3. Public Pricing Preview Schema', () => {
    // Default quantity
    const parsedDefault = publicPricingPreviewSchema.safeParse({});
    assert.equal(parsedDefault.success, true);
    assert.equal(parsedDefault.data.licenseQuantity, 10);

    // Custom quantity & coupon
    const parsedCustom = publicPricingPreviewSchema.safeParse({
      licenseQuantity: 15,
      couponCode: 'SAVE20',
    });
    assert.equal(parsedCustom.success, true);
    assert.equal(parsedCustom.data.licenseQuantity, 15);
    assert.equal(parsedCustom.data.couponCode, 'SAVE20');

    // Reject negative or zero quantity
    assert.equal(publicPricingPreviewSchema.safeParse({ licenseQuantity: 0 }).success, false);
    assert.equal(publicPricingPreviewSchema.safeParse({ licenseQuantity: -5 }).success, false);
  });

  await t.test('4. Registration Schema validates CMD purchase choices and distinct stakeholder accounts', () => {
    const validPayload = {
      companyName: 'Acme Technologies Private Limited',
      companyType: 'Private Limited',
      domainName: 'acmetech.com',
      fullName: 'Vikram Aditya',
      designation: 'CMD',
      email: 'vikram@acmetech.com',
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      hrName: 'Meera Nair',
      hrEmail: 'meera@acmetech.com',
      financeName: 'Rohit Verma',
      financeEmail: 'rohit@acmetech.com',
      licenseQuantity: 20,
      gstin: '27ABCDE1234F1Z5',
      couponCode: 'WELCOME10',
      acceptedTerms: true,
      verificationToken: 'valid-otp-token',
    };

    const result = registrationSchema.safeParse(validPayload);
    assert.equal(result.success, true);
    assert.equal(result.data.licenseQuantity, 20);
    assert.equal(result.data.gstin, '27ABCDE1234F1Z5');

    // Reject duplicate email between CMD and HR
    const dupCmdHr = { ...validPayload, hrEmail: 'vikram@acmetech.com' };
    assert.equal(registrationSchema.safeParse(dupCmdHr).success, false);

    // Support one employee managing both HR and Finance (1 person = 1 licence)
    const dupHrFin = { ...validPayload, financeEmail: 'meera@acmetech.com' };
    assert.equal(registrationSchema.safeParse(dupHrFin).success, true);

    // Reject invalid GSTIN format
    const invalidGst = { ...validPayload, gstin: 'INVALID_GST' };
    assert.equal(registrationSchema.safeParse(invalidGst).success, false);
  });

  await t.test('5. Finance review schemas accept requests without requiring client overrides', () => {
    // Finance create-order does not require body parameters (retrieves CMD choice from DB)
    const orderRes = createOrderSchema.safeParse({});
    assert.equal(orderRes.success, true);

    // Finance approve for Cheque
    const approveRes = approveSchema.safeParse({ paymentMethod: 'CHEQUE' });
    assert.equal(approveRes.success, true);

    // Finance verify-payment requires cryptographic signature but not license quantity
    const verifyRes = verifyPaymentSchema.safeParse({
      razorpay_order_id: 'order_test_123',
      razorpay_payment_id: 'pay_test_456',
      razorpay_signature: 'sig_test_789',
    });
    assert.equal(verifyRes.success, true);
  });
});

