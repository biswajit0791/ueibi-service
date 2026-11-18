import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import { computeRegistrationPricing } from '../../src/services/licenceCalculation.service.js';
import { activateTenantFromRegistration } from '../../src/services/tenantActivation.service.js';
import { findEligiblePromotion, calculateSubscriptionExtension } from '../../src/services/promotion.service.js';

test('Subscription Duration Visibility across Onboarding and Finance Approval', async (t) => {
  const testSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  const testDomain = `viscorp-${testSuffix.toLowerCase()}.com`;
  const testEmail = `cmd@${testDomain}`;

  let createdPromo = null;
  let createdReg = null;

  await t.test('1. Setup active promotion: Buy 12 Get 2 Free', async () => {
    createdPromo = await prisma.subscriptionPromotion.create({
      data: {
        name: `Booster Offer ${testSuffix}`,
        code: `BOOST_${testSuffix}`,
        badgeText: '+2 MONTHS FREE',
        description: 'Pay 12 Months Get 2 Months Free',
        paidMonths: 12,
        freeMonths: 2,
        minSeats: 1,
        priority: 100,
        allowCoupons: true,
        allowNoCoupon: true,
        active: true,
        isArchived: false,
        eligibility: 'ALL',
        applyToAllPackages: true,
      },
    });

    assert.ok(createdPromo.id);
    assert.equal(createdPromo.paidMonths, 12);
    assert.equal(createdPromo.freeMonths, 2);
  });

  await t.test('2. computeRegistrationPricing returns complete duration breakdown & expected expiry', async () => {
    const pricing = await computeRegistrationPricing(
      {
        cmdEmail: testEmail,
        additionalLicenses: 9, // Total 10 licenses
      },
      { promoCode: createdPromo.code }
    );

    assert.equal(pricing.totalLicenses, 10);
    assert.equal(pricing.paidDurationMonths, 12);
    assert.equal(pricing.freeDurationMonths, 2);
    assert.equal(pricing.totalDurationMonths, 14);
    assert.ok(pricing.startsAt);
    assert.ok(pricing.expectedExpiryDate);
    assert.equal(pricing.promotionName, createdPromo.name);
    assert.equal(pricing.promoCode, createdPromo.code);
  });

  await t.test('3. Persist subscription duration snapshot with CompanyRegistration record', async () => {
    createdReg = await prisma.companyRegistration.create({
      data: {
        companyName: `Visibility Corp ${testSuffix}`,
        companyType: 'Private Limited',
        domainName: testDomain,
        tenantCode: `VC${testSuffix}`,
        fullName: 'Test CMD',
        designation: 'Managing Director',
        email: testEmail,
        passwordHash: 'dummy_hash_for_test',
        additionalLicenses: 9,
        licenseQuantity: 10,
        unitPrice: 3999,
        subtotalAmount: 39990,
        gstRate: 0.18,
        gstAmount: 7198.2,
        totalAmount: 47188.2,
        paidDurationMonths: 12,
        freeDurationMonths: 2,
        totalDurationMonths: 14,
        subscriptionStartsAt: new Date(),
        subscriptionEndsAt: new Date(Date.now() + 14 * 30 * 24 * 60 * 60 * 1000),
        promotionId: createdPromo.id,
        promoCode: createdPromo.code,
        promotionName: createdPromo.name,
        acceptedTermsAt: new Date(),
      },
    });

    assert.ok(createdReg.id);
    assert.equal(createdReg.paidDurationMonths, 12);
    assert.equal(createdReg.freeDurationMonths, 2);
    assert.equal(createdReg.totalDurationMonths, 14);
    assert.equal(createdReg.promotionName, createdPromo.name);
  });

  await t.test('4. Automatic Tenant Activation preserves saved duration and creates Tax Invoice', async () => {
    const activationResult = await activateTenantFromRegistration({
      registrationId: createdReg.id,
      paymentMethod: 'ONLINE',
      paymentReference: `PAY_REF_${testSuffix}`,
      transactionId: `TXN_${testSuffix}`,
      performedBy: 'FINANCE_TEST',
    });

    assert.ok(activationResult.tenant?.id);

    // Verify Subscription term & duration separation
    const sub = await prisma.subscription.findFirst({
      where: { tenantId: activationResult.tenant.id },
    });

    assert.ok(sub);
    assert.equal(sub.paidDurationMonths, 12);
    assert.equal(sub.freeDurationMonths, 2);
    assert.equal(sub.totalDurationMonths, 14);
    assert.ok(sub.paidEndsAt);
    assert.ok(sub.endsAt);
    assert.ok(sub.endsAt > sub.paidEndsAt);

    // Verify Tax Invoice generated with duration snapshot and state PAID
    const inv = await prisma.invoice.findFirst({
      where: { subscriptionId: sub.id },
      include: { payments: true },
    });

    assert.ok(inv);
    assert.equal(inv.state, 'PAID');
    assert.equal(inv.paidDurationMonths, 12);
    assert.equal(inv.freeDurationMonths, 2);
    assert.equal(inv.totalDurationMonths, 14);
    assert.equal(inv.quantity, 10);
    assert.equal(Number(inv.totalAmount), 47188.2);
    assert.equal(Number(inv.amountPaid), 47188.2);
    assert.equal(inv.payments.length, 1);
    assert.equal(inv.payments[0].method, 'ONLINE');
    assert.equal(Number(inv.payments[0].amount), 47188.2);
  });

  // Cleanup
  t.after(async () => {
    try {
      if (createdReg?.id) {
        const tenant = await prisma.tenant.findFirst({ where: { registrationId: createdReg.id } });
        if (tenant) {
          const subs = await prisma.subscription.findMany({ where: { tenantId: tenant.id } });
          const subIds = subs.map((s) => s.id);
          const invs = await prisma.invoice.findMany({ where: { subscriptionId: { in: subIds } } });
          const invIds = invs.map((i) => i.id);

          await prisma.payment.deleteMany({ where: { invoiceId: { in: invIds } } });
          await prisma.invoice.deleteMany({ where: { id: { in: invIds } } });
          await prisma.promotionRedemption.deleteMany({ where: { subscriptionId: { in: subIds } } });
          await prisma.subscription.deleteMany({ where: { tenantId: tenant.id } });
          await prisma.tenantUser.deleteMany({ where: { tenantId: tenant.id } });
          await prisma.platformAuditLog.deleteMany({ where: { tenantId: tenant.id } });
          await prisma.tenant.delete({ where: { id: tenant.id } });
        }
        await prisma.registrationActionToken.deleteMany({ where: { registrationId: createdReg.id } });
        await prisma.companyRegistration.delete({ where: { id: createdReg.id } });
      }
      if (createdPromo?.id) {
        await prisma.subscriptionPromotion.delete({ where: { id: createdPromo.id } });
      }
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }
  });
});
