import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { findActionToken } from '../lib/actionTokens.js';
import { computePricing, couponValidationError } from '../lib/pricing.js';
import { generateRawToken, hashToken } from '../lib/tokens.js';
import { notifyStakeholders } from '../lib/notify.js';
import { pricingPreviewSchema, approveSchema, confirmChequeSchema } from '../validations/finance.schema.js';
import { tokenParamSchema } from '../validations/publicToken.schema.js';

async function resolveFinanceToken(req, res) {
  const parsedParams = tokenParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    return null;
  }
  const actionToken = await findActionToken(parsedParams.data.token, 'FINANCE');
  if (!actionToken) {
    res.status(404).json({ error: 'Invalid link' });
    return null;
  }
  if (actionToken.expiresAt.getTime() < Date.now()) {
    res.status(410).json({ error: 'This link has expired' });
    return null;
  }
  const { status } = actionToken.registration;
  if (status !== 'PENDING_FINANCE_REVIEW' && status !== 'PENDING_CHEQUE_CONFIRMATION') {
    res.status(410).json({ error: 'This registration has already been processed by Finance' });
    return null;
  }
  return actionToken;
}

async function lookupCoupon(couponCode) {
  if (!couponCode) return { coupon: null, error: null };
  const coupon = await prisma.coupon.findUnique({ where: { code: couponCode } });
  const error = couponValidationError(coupon);
  return { coupon: error ? null : coupon, error };
}

export async function getFinanceSummary(req, res, next) {
  try {
    const actionToken = await resolveFinanceToken(req, res);
    if (!actionToken) return;
    const { registration } = actionToken;

    res.json({
      status: registration.status,
      pendingCheque: registration.status === 'PENDING_CHEQUE_CONFIRMATION',
      companyName: registration.companyName,
      companyType: registration.companyType,
      domainName: registration.domainName,
      fullName: registration.fullName,
      designation: registration.designation,
      email: registration.email,
      unitPrice: env.licenseUnitPrice,
      gstRate: env.gstRate,
    });
  } catch (err) {
    next(err);
  }
}

export async function pricingPreview(req, res, next) {
  try {
    const actionToken = await resolveFinanceToken(req, res);
    if (!actionToken) return;

    const parsed = pricingPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { licenseQuantity, couponCode } = parsed.data;
    const { coupon, error: couponError } = await lookupCoupon(couponCode);

    const pricing = computePricing({
      quantity: licenseQuantity,
      unitPrice: env.licenseUnitPrice,
      coupon,
      gstRate: env.gstRate,
    });

    res.json({ ...pricing, couponValid: !!coupon, couponError });
  } catch (err) {
    next(err);
  }
}

async function commitCouponUsage(tx, coupon) {
  if (!coupon) return;
  // Optimistic concurrency: only increments if timesUsed hasn't moved since we read it,
  // preventing a limited coupon from being over-redeemed by concurrent approvals.
  await tx.coupon.updateMany({
    where: { id: coupon.id, timesUsed: coupon.timesUsed },
    data: { timesUsed: { increment: 1 } },
  });
}

async function advanceToHr(tx, registrationId) {
  const rawHrToken = generateRawToken();
  await tx.registrationActionToken.create({
    data: {
      registrationId,
      role: 'HR',
      tokenHash: hashToken(rawHrToken),
      expiresAt: new Date(Date.now() + env.actionTokenTtlDays * 24 * 60 * 60 * 1000),
    },
  });
  return rawHrToken;
}

export async function approve(req, res, next) {
  try {
    const actionToken = await resolveFinanceToken(req, res);
    if (!actionToken) return;
    const { registration } = actionToken;

    if (registration.status !== 'PENDING_FINANCE_REVIEW') {
      return res.status(409).json({ error: 'Registration is not pending Finance review' });
    }

    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;
    const { coupon, error: couponError } = await lookupCoupon(data.couponCode);
    if (data.couponCode && couponError) {
      return res.status(400).json({ error: couponError });
    }

    const pricing = computePricing({
      quantity: data.licenseQuantity,
      unitPrice: env.licenseUnitPrice,
      coupon,
      gstRate: env.gstRate,
    });

    const basePricingData = {
      gstin: data.gstin,
      licenseQuantity: data.licenseQuantity,
      unitPrice: pricing.unitPrice,
      couponId: coupon?.id || null,
      discountAmount: pricing.discountAmount,
      subtotalAmount: pricing.subtotal,
      gstRate: pricing.gstRate,
      gstAmount: pricing.gstAmount,
      totalAmount: pricing.total,
      paymentMethod: data.paymentMethod,
      financeApprovedAt: new Date(),
    };

    const paymentReference = data.paymentMethod === 'CHEQUE'
      ? `CHQ-PENDING-${Date.now().toString(36).toUpperCase()}`
      : `STUB-${Date.now().toString(36).toUpperCase()}`;

    const rawHrToken = await prisma.$transaction(async (tx) => {
      await tx.companyRegistration.update({
        where: { id: registration.id },
        data: {
          ...basePricingData,
          paymentReference,
          status: 'PENDING_HR_ACTIVATION',
        },
      });
      await commitCouponUsage(tx, coupon);
      return advanceToHr(tx, registration.id);
    });

    const updated = await prisma.companyRegistration.findUnique({ where: { id: registration.id } });
    await notifyStakeholders({
      registration: updated,
      event: data.paymentMethod === 'CHEQUE' ? 'FINANCE_APPROVED_CHEQUE' : 'FINANCE_APPROVED_ONLINE',
      subject: `Finance Approved: ${registration.companyName} - Pending HR Activation`,
      message: `Finance has approved pricing and payment structure for ${registration.companyName}. It is now pending HR activation.`,
      actionRole: 'HR',
      actionUrl: `${env.frontendOrigin}/hr/registrations/${rawHrToken}`,
    });

    return res.json({ status: 'PENDING_HR_ACTIVATION', paymentReference });
  } catch (err) {
    next(err);
  }
}

export async function confirmCheque(req, res, next) {
  try {
    // Reuses resolveFinanceToken (rather than a bespoke findActionToken call)
    // so this endpoint gets the same expiry check as pricingPreview/approve —
    // previously it skipped that check entirely.
    const actionToken = await resolveFinanceToken(req, res);
    if (!actionToken) return;
    const { registration } = actionToken;
    if (registration.status !== 'PENDING_CHEQUE_CONFIRMATION') {
      return res.status(409).json({ error: 'Registration is not awaiting cheque confirmation' });
    }

    const parsed = confirmChequeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;

    const rawHrToken = await prisma.$transaction(async (tx) => {
      await tx.companyRegistration.update({
        where: { id: registration.id },
        data: {
          chequeNumber: data.chequeNumber,
          chequeDate: data.chequeDate,
          transactionId: data.transactionId,
          paymentReference: data.transactionId,
          status: 'PENDING_HR_ACTIVATION',
        },
      });
      await commitCouponUsage(tx, registration.coupon);
      return advanceToHr(tx, registration.id);
    });

    const updated = await prisma.companyRegistration.findUnique({ where: { id: registration.id } });
    await notifyStakeholders({
      registration: updated,
      event: 'FINANCE_APPROVED_CHEQUE',
      subject: `Cheque payment confirmed: ${registration.companyName}`,
      message: `Finance has confirmed cheque payment for ${registration.companyName} (Cheque #${data.chequeNumber}). It is now pending HR activation.`,
      actionRole: 'HR',
      actionUrl: `${env.frontendOrigin}/hr/registrations/${rawHrToken}`,
    });

    res.json({ status: 'PENDING_HR_ACTIVATION' });
  } catch (err) {
    next(err);
  }
}
