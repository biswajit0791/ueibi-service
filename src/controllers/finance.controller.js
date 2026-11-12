import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { findActionToken } from '../lib/actionTokens.js';
import { computePricing, couponValidationError } from '../lib/pricing.js';
import { generateRawToken, hashToken } from '../lib/tokens.js';
import { notifyStakeholders } from '../lib/notify.js';
import { activateTenantFromRegistration } from '../services/tenantActivation.service.js';
import {
  pricingPreviewSchema,
  approveSchema,
  confirmChequeSchema,
  createOrderSchema,
  verifyPaymentSchema,
} from '../validations/finance.schema.js';
import { tokenParamSchema } from '../validations/publicToken.schema.js';

/**
 * Whether online payment can actually complete.
 */
export function onlinePaymentConfigured() {
  return Boolean(env.razorpayKeyId && env.razorpayKeySecret);
}

// Lazily initialised Razorpay instance
let _razorpay = null;
function getRazorpay() {
  if (_razorpay) return _razorpay;
  if (!onlinePaymentConfigured()) {
    throw Object.assign(
      new Error('Online payment is not available. Pay by cheque or bank transfer instead, and Finance will confirm it.'),
      { statusCode: 503, code: 'ONLINE_PAYMENT_UNAVAILABLE' },
    );
  }
  _razorpay = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
  return _razorpay;
}

async function resolveFinanceToken(req, res, { allowActive = false } = {}) {
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
  if (status === 'ACTIVE' && allowActive) {
    return actionToken;
  }
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
    const actionToken = await resolveFinanceToken(req, res, { allowActive: true });
    if (!actionToken) return;
    const { registration } = actionToken;

    const licenseQuantity = registration.licenseQuantity && registration.licenseQuantity > 0 ? registration.licenseQuantity : 10;
    const unitPrice = registration.unitPrice ? Number(registration.unitPrice) : env.licenseUnitPrice;
    const subtotal = registration.subtotalAmount ? Number(registration.subtotalAmount) : licenseQuantity * unitPrice;
    const discountAmount = registration.discountAmount ? Number(registration.discountAmount) : 0;
    const gstRate = registration.gstRate ? Number(registration.gstRate) : env.gstRate;
    const gstAmount = registration.gstAmount ? Number(registration.gstAmount) : Math.round((subtotal - discountAmount) * gstRate * 100) / 100;
    const totalAmount = registration.totalAmount ? Number(registration.totalAmount) : (subtotal - discountAmount + gstAmount);
    const onlinePaymentMode = env.razorpayKeyId.startsWith('rzp_test_') ? 'test' : 'live';

    if (registration.status === 'ACTIVE') {
      return res.json({
        status: 'ACTIVE',
        alreadyActive: true,
        companyName: registration.companyName,
        companyType: registration.companyType,
        domainName: registration.domainName,
        fullName: registration.fullName,
        designation: registration.designation,
        email: registration.email,
        licenseQuantity,
        totalAmount,
        total: totalAmount,
        paymentMethod: registration.paymentMethod || 'ONLINE',
        paymentReference: registration.paymentReference,
        transactionId: registration.transactionId,
        razorpayOrderId: registration.razorpayOrderId,
        razorpayPaymentId: registration.razorpayPaymentId,
        onlinePaymentAvailable: onlinePaymentConfigured(),
        onlinePaymentMode,
      });
    }

    res.json({
      status: registration.status,
      pendingCheque: registration.status === 'PENDING_CHEQUE_CONFIRMATION',
      companyName: registration.companyName,
      companyType: registration.companyType,
      domainName: registration.domainName,
      fullName: registration.fullName,
      designation: registration.designation,
      email: registration.email,
      hrName: registration.hrName,
      hrEmail: registration.hrEmail,
      hrNotRequired: Boolean(registration.hrNotRequired),
      financeName: registration.financeName,
      financeEmail: registration.financeEmail,
      financeNotRequired: Boolean(registration.financeNotRequired),
      additionalLicenses: registration.additionalLicenses || 0,
      licenseQuantity,
      gstin: registration.gstin || null,
      couponCode: registration.coupon?.code || null,
      couponDiscount: discountAmount,
      subtotal,
      unitPrice,
      gstRate,
      gstAmount,
      totalAmount,
      total: totalAmount,
      onlinePaymentAvailable: onlinePaymentConfigured(),
      onlinePaymentMode,
      onlinePaymentKeyId: env.razorpayKeyId || null,
    });
  } catch (err) {
    next(err);
  }
}

export async function pricingPreview(req, res, next) {
  try {
    const actionToken = await resolveFinanceToken(req, res);
    if (!actionToken) return;
    const { registration } = actionToken;

    const quantity = registration.licenseQuantity && registration.licenseQuantity > 0 ? registration.licenseQuantity : 10;
    const pricing = computePricing({
      quantity,
      unitPrice: registration.unitPrice ? Number(registration.unitPrice) : env.licenseUnitPrice,
      coupon: registration.coupon,
      gstRate: registration.gstRate ? Number(registration.gstRate) : env.gstRate,
    });

    res.json({
      ...pricing,
      couponValid: Boolean(registration.coupon),
      couponCode: registration.coupon?.code || null,
      couponError: null,
    });
  } catch (err) {
    next(err);
  }
}

async function commitCouponUsage(tx, coupon) {
  if (!coupon) return;
  await tx.coupon.updateMany({
    where: { id: coupon.id, timesUsed: coupon.timesUsed },
    data: { timesUsed: { increment: 1 } },
  });
}

export async function approve(req, res, next) {
  try {
    const actionToken = await resolveFinanceToken(req, res);
    if (!actionToken) return;
    const { registration } = actionToken;

    if (registration.status !== 'PENDING_FINANCE_REVIEW') {
      return res.status(409).json({ error: 'Registration is not pending Finance review' });
    }

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

    // Only CHEQUE payments reach this code path now
    const paymentReference = `CHQ-PENDING-${Date.now().toString(36).toUpperCase()}`;

    await prisma.companyRegistration.update({
      where: { id: registration.id },
      data: {
        paymentMethod: 'CHEQUE',
        paymentReference,
        status: 'PENDING_CHEQUE_CONFIRMATION',
        financeApprovedAt: new Date(),
      },
    });

    const updated = await prisma.companyRegistration.findUnique({ where: { id: registration.id } });
    await notifyStakeholders({
      registration: updated,
      event: 'FINANCE_APPROVED_CHEQUE',
      subject: `Finance Awaiting Cheque: ${registration.companyName}`,
      message: `Finance has reviewed pricing for ${registration.companyName} and marked it pending cheque confirmation.`,
      actionRole: 'FINANCE',
      actionUrl: `${env.frontendOrigin}/finance/registrations/${actionToken.tokenHash}`,
    });

    return res.json({ status: 'PENDING_CHEQUE_CONFIRMATION', paymentReference });
  } catch (err) {
    next(err);
  }
}

export async function confirmCheque(req, res, next) {
  try {
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

    // Automatic Tenant Activation upon Cheque Confirmation
    const activationResult = await activateTenantFromRegistration({
      registrationId: registration.id,
      paymentMethod: 'CHEQUE',
      paymentReference: data.transactionId,
      transactionId: data.transactionId,
      performedBy: 'FINANCE',
    });

    await prisma.companyRegistration.update({
      where: { id: registration.id },
      data: {
        chequeNumber: data.chequeNumber,
        chequeDate: data.chequeDate,
      },
    });

    res.json({
      status: 'ACTIVE',
      tenantId: activationResult.tenant?.id,
      message: 'Cheque payment confirmed and tenant activated successfully!',
    });
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

    // Server-authoritative pricing based on CMD registration choices
    const quantity = registration.licenseQuantity && registration.licenseQuantity > 0 ? registration.licenseQuantity : 10;
    const pricing = computePricing({
      quantity,
      unitPrice: registration.unitPrice ? Number(registration.unitPrice) : env.licenseUnitPrice,
      coupon: registration.coupon,
      gstRate: registration.gstRate ? Number(registration.gstRate) : env.gstRate,
    });

    const amountInPaise = Math.round(pricing.total * 100);
    const receipt = `reg-${registration.id.slice(-8)}-${Date.now().toString(36)}`;
    const razorpay = getRazorpay();

    let order = null;
    // Check if an uncaptured order already exists for this registration with identical amount
    if (registration.razorpayOrderId) {
      try {
        const existingOrder = await razorpay.orders.fetch(registration.razorpayOrderId);
        if (existingOrder && existingOrder.status === 'created' && existingOrder.amount === amountInPaise) {
          order = existingOrder;
        }
      } catch (_) {
        // Fallback to creating a new order
      }
    }

    if (!order) {
      order = await razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt,
        notes: {
          registrationId: registration.id,
          companyName: registration.companyName,
          licenseQuantity: String(quantity),
        },
      });

      await prisma.companyRegistration.update({
        where: { id: registration.id },
        data: {
          razorpayOrderId: order.id,
          paymentReference: order.id,
        },
      });
    }

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: env.razorpayKeyId,
      mode: env.razorpayKeyId.startsWith('rzp_test_') ? 'test' : 'live',
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Razorpay — Verify Payment & Automatically Activate Tenant
// POST /api/finance/registrations/:token/verify-payment
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyPayment(req, res, next) {
  try {
    const actionToken = await resolveFinanceToken(req, res, { allowActive: true });
    if (!actionToken) return;
    const { registration } = actionToken;

    const parsed = verifyPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;

    // Idempotent return if already activated with this payment
    if (registration.status === 'ACTIVE') {
      if (
        registration.razorpayPaymentId === data.razorpay_payment_id ||
        registration.transactionId === data.razorpay_payment_id ||
        registration.paymentReference === data.razorpay_order_id
      ) {
        return res.json({
          status: 'ACTIVE',
          alreadyActive: true,
          paymentReference: data.razorpay_order_id,
          transactionId: data.razorpay_payment_id,
          message: 'Payment already verified and tenant active!',
        });
      }
      return res.status(409).json({ error: 'This registration has already been activated' });
    }

    if (registration.status !== 'PENDING_FINANCE_REVIEW') {
      return res.status(409).json({ error: 'Registration is not pending Finance review' });
    }

    // ── 1. Cryptographic signature verification ──
    const expectedSig = crypto
      .createHmac('sha256', env.razorpayKeySecret)
      .update(`${data.razorpay_order_id}|${data.razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== data.razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
    }

    // ── 2. Server-authoritative pricing based on CMD choices ──
    const quantity = registration.licenseQuantity && registration.licenseQuantity > 0 ? registration.licenseQuantity : 10;
    const pricing = computePricing({
      quantity,
      unitPrice: registration.unitPrice ? Number(registration.unitPrice) : env.licenseUnitPrice,
      coupon: registration.coupon,
      gstRate: registration.gstRate ? Number(registration.gstRate) : env.gstRate,
    });

    // ── 3. Cross-check Razorpay order amount & registration ownership ──
    const razorpay = getRazorpay();
    const order = await razorpay.orders.fetch(data.razorpay_order_id);
    const expectedPaise = Math.round(pricing.total * 100);

    if (order.amount !== expectedPaise) {
      return res.status(400).json({
        error: `Amount mismatch: Razorpay order is ₹${(order.amount / 100).toFixed(2)} but server pricing is ₹${pricing.total.toFixed(2)}`,
      });
    }

    if (order.notes?.registrationId && order.notes.registrationId !== registration.id) {
      return res.status(400).json({
        error: 'Order does not belong to this company registration',
      });
    }

    if (registration.razorpayOrderId && registration.razorpayOrderId !== data.razorpay_order_id) {
      return res.status(400).json({
        error: `Order ID mismatch: expected ${registration.razorpayOrderId} but received ${data.razorpay_order_id}`,
      });
    }

    // ── 4. Record payment details on registration ──
    await prisma.companyRegistration.update({
      where: { id: registration.id },
      data: {
        paymentMethod: 'ONLINE',
        paymentReference: data.razorpay_order_id,
        transactionId: data.razorpay_payment_id,
        razorpayOrderId: data.razorpay_order_id,
        razorpayPaymentId: data.razorpay_payment_id,
        razorpaySignature: data.razorpay_signature,
        paymentVerifiedAt: new Date(),
        financeApprovedAt: new Date(),
      },
    });

    // ── 5. Automatic Tenant Activation upon Verified Payment ──
    const activationResult = await activateTenantFromRegistration({
      registrationId: registration.id,
      paymentMethod: 'ONLINE',
      paymentReference: data.razorpay_order_id,
      transactionId: data.razorpay_payment_id,
      performedBy: 'FINANCE',
    });

    res.json({
      status: 'ACTIVE',
      tenantId: activationResult.tenant?.id,
      paymentReference: data.razorpay_order_id,
      transactionId: data.razorpay_payment_id,
      message: 'Payment verified and tenant activated successfully!',
    });
  } catch (err) {
    next(err);
  }
}
