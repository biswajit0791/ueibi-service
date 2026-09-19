import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { findActionToken } from '../lib/actionTokens.js';
import { computePricing, couponValidationError } from '../lib/pricing.js';
import { generateRawToken, hashToken } from '../lib/tokens.js';
import { notifyStakeholders } from '../lib/notify.js';
import {
  pricingPreviewSchema,
  approveSchema,
  confirmChequeSchema,
  createOrderSchema,
  verifyPaymentSchema,
} from '../validations/finance.schema.js';
import { tokenParamSchema } from '../validations/publicToken.schema.js';

// Lazily initialised Razorpay instance — created on first use so the server
// still boots cleanly when keys are missing (non-payment workflows unaffected).
let _razorpay = null;
function getRazorpay() {
  if (_razorpay) return _razorpay;
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    throw Object.assign(
      new Error('Razorpay credentials are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env'),
      { statusCode: 500 },
    );
  }
  _razorpay = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
  return _razorpay;
}

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

    // ── Block direct ONLINE approvals — they MUST go through Razorpay ──
    const preCheck = approveSchema.safeParse(req.body);
    if (preCheck.success && preCheck.data.paymentMethod === 'ONLINE') {
      return res.status(400).json({
        error: 'Online payments must be completed via Razorpay checkout. '
             + 'Use POST …/create-order followed by POST …/verify-payment instead.',
      });
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

    // Only CHEQUE payments reach this code path now (ONLINE is blocked above)
    const paymentReference = `CHQ-PENDING-${Date.now().toString(36).toUpperCase()}`;

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

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay — Create Order
// POST /api/finance/registrations/:token/create-order
// ─────────────────────────────────────────────────────────────────────────────

export async function createOrder(req, res, next) {
  try {
    const actionToken = await resolveFinanceToken(req, res);
    if (!actionToken) return;
    const { registration } = actionToken;

    if (registration.status !== 'PENDING_FINANCE_REVIEW') {
      return res.status(409).json({ error: 'Registration is not pending Finance review' });
    }

    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;

    const { coupon, error: couponError } = await lookupCoupon(data.couponCode);
    if (data.couponCode && couponError) {
      return res.status(400).json({ error: couponError });
    }

    // Server-authoritative pricing — NEVER trust a client-supplied total.
    const pricing = computePricing({
      quantity: data.licenseQuantity,
      unitPrice: env.licenseUnitPrice,
      coupon,
      gstRate: env.gstRate,
    });

    const amountInPaise = Math.round(pricing.total * 100);
    const receipt = `reg-${registration.id.slice(-8)}-${Date.now().toString(36)}`;

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt,
      notes: {
        registrationId: registration.id,
        companyName: registration.companyName,
        licenseQuantity: String(data.licenseQuantity),
      },
    });

    // Return ONLY the public data the frontend checkout needs.
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: env.razorpayKeyId,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay — Verify Payment & Advance to HR
// POST /api/finance/registrations/:token/verify-payment
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyPayment(req, res, next) {
  try {
    const actionToken = await resolveFinanceToken(req, res);
    if (!actionToken) return;
    const { registration } = actionToken;

    if (registration.status !== 'PENDING_FINANCE_REVIEW') {
      return res.status(409).json({ error: 'Registration is not pending Finance review' });
    }

    const parsed = verifyPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;

    // ── 1. Cryptographic signature verification ──
    const expectedSig = crypto
      .createHmac('sha256', env.razorpayKeySecret)
      .update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== data.razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
    }

    // ── 2. Server-side pricing recalculation (never trust client totals) ──
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

    // ── 3. Cross-check the Razorpay order amount matches our pricing ──
    const razorpay = getRazorpay();
    const order = await razorpay.orders.fetch(data.razorpay_order_id);
    const expectedPaise = Math.round(pricing.total * 100);

    if (order.amount !== expectedPaise) {
      return res.status(400).json({
        error: `Amount mismatch: Razorpay order is ₹${(order.amount / 100).toFixed(2)} but server pricing is ₹${pricing.total.toFixed(2)}`,
      });
    }

    // ── 4. Atomic commit: update registration + consume coupon + generate HR token ──
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
      paymentMethod: 'ONLINE',
      financeApprovedAt: new Date(),
    };

    const rawHrToken = await prisma.$transaction(async (tx) => {
      await tx.companyRegistration.update({
        where: { id: registration.id },
        data: {
          ...basePricingData,
          paymentReference: data.razorpay_order_id,
          transactionId: data.razorpay_payment_id,
          status: 'PENDING_HR_ACTIVATION',
        },
      });
      await commitCouponUsage(tx, coupon);
      return advanceToHr(tx, registration.id);
    });

    // ── 5. Notify all stakeholders ──
    const updated = await prisma.companyRegistration.findUnique({ where: { id: registration.id } });
    await notifyStakeholders({
      registration: updated,
      event: 'FINANCE_APPROVED_ONLINE',
      subject: `Finance Approved: ${registration.companyName} - Pending HR Activation`,
      message: `Finance has approved pricing and verified Razorpay payment for ${registration.companyName}. It is now pending HR activation.`,
      actionRole: 'HR',
      actionUrl: `${env.frontendOrigin}/hr/registrations/${rawHrToken}`,
    });

    res.json({
      status: 'PENDING_HR_ACTIVATION',
      paymentReference: data.razorpay_order_id,
      transactionId: data.razorpay_payment_id,
    });
  } catch (err) {
    next(err);
  }
}
