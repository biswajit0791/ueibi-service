/**
 * invoice.controller.js — Invoices, and the payments and refunds against them.
 *
 * An invoice passes through DRAFT → ISSUED → PARTIALLY_PAID → PAID, or DRAFT →
 * VOID. Two rules hold throughout:
 *
 *   1. Money is a SNAPSHOT. Every amount is computed once, when the invoice is
 *      created, and never recomputed on read. Repricing a package tomorrow
 *      cannot move an invoice raised today, and neither can a company changing
 *      its name change who an issued invoice was addressed to.
 *   2. Payment state is never set by hand. `amountPaid` and `amountRefunded` are
 *      summed from the Payment and Refund rows inside the same transaction that
 *      writes them, so the invoice can always be reconciled against its own
 *      detail rather than drifting from it.
 *
 * The invoice number is allocated at ISSUE, not creation, so an abandoned draft
 * never leaves a gap in the GST series.
 */
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { sendMail } from '../lib/mailer.js';
import { renderEmailWrapper } from '../lib/emailTemplates.js';
import { couponValidationError } from '../lib/pricing.js';
import {
  priceInvoice,
  invoiceBalances,
  syncInvoiceTotals,
  withInvoiceNumber,
  num,
  round2,
} from '../services/billing.service.js';
import {
  invoiceQuerySchema,
  invoiceCreateSchema,
  invoiceVoidSchema,
  invoiceIdParamSchema,
  paymentCreateSchema,
  refundCreateSchema,
} from '../validations/billing.schema.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';

/** Decimal columns are Prisma Decimals; the API speaks plain numbers. */
const money = (inv) => ({
  ...inv,
  unitPrice: num(inv.unitPrice),
  subtotalAmount: num(inv.subtotalAmount),
  discountAmount: num(inv.discountAmount),
  gstRate: num(inv.gstRate),
  gstAmount: num(inv.gstAmount),
  totalAmount: num(inv.totalAmount),
  amountPaid: num(inv.amountPaid),
  amountRefunded: num(inv.amountRefunded),
});

const INVOICE_LIST_SELECT = {
  id: true, invoiceNumber: true, state: true,
  billToName: true, issuedAt: true, dueAt: true, createdAt: true,
  currency: true, quantity: true, totalAmount: true,
  amountPaid: true, amountRefunded: true,
  unitPrice: true, subtotalAmount: true, discountAmount: true,
  gstRate: true, gstAmount: true, couponCode: true,
  tenantId: true,
  tenant: { select: { id: true, companyName: true, tenantCode: true } },
  subscriptionId: true,
};

/** GET /platform/invoices */
export async function listInvoices(req, res, next) {
  try {
    const parsed = invoiceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { state, tenantId, search, from, to, page, limit } = parsed.data;

    const where = {
      ...(state ? { state } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
      ...(search
        ? {
            OR: [
              { invoiceNumber: { contains: search, mode: 'insensitive' } },
              { billToName: { contains: search, mode: 'insensitive' } },
              { tenant: { companyName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const skip = (page - 1) * limit;
    const [total, rows, agg] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        select: INVOICE_LIST_SELECT,
        // Newest first, but drafts have no issuedAt so createdAt is the tiebreak.
        orderBy: [{ issuedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      // Totals cover the whole filtered set, not just this page — a page total
      // that disagrees with the filter is worse than no total.
      prisma.invoice.aggregate({
        where: { ...where, state: { not: 'VOID' } },
        _sum: { totalAmount: true, amountPaid: true, amountRefunded: true },
      }),
    ]);

    const invoiced = round2(num(agg._sum.totalAmount));
    const collected = round2(num(agg._sum.amountPaid));
    const refunded = round2(num(agg._sum.amountRefunded));

    res.json({
      items: rows.map(money),
      summary: {
        invoiced,
        collected,
        refunded,
        outstanding: round2(Math.max(0, invoiced - collected)),
        net: round2(collected - refunded),
        currency: 'INR',
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/invoices/:id */
export async function getInvoice(req, res, next) {
  try {
    const parsed = invoiceIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: parsed.data.id },
      include: {
        tenant: { select: { id: true, companyName: true, tenantCode: true, domainName: true } },
        subscription: {
          select: { id: true, packageName: true, seatCount: true, startsAt: true, endsAt: true, state: true },
        },
        payments: { orderBy: { receivedAt: 'desc' } },
        refunds: { orderBy: { refundedAt: 'desc' } },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Whoever recorded each payment, by id — not a relation, so the record
    // outlives the operator's account.
    const operatorIds = [...new Set([
      ...invoice.payments.map((p) => p.recordedById),
      ...invoice.refunds.map((r) => r.recordedById),
    ])].filter(Boolean);
    const operators = operatorIds.length
      ? await prisma.tenantUser.findMany({
          where: { id: { in: operatorIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = Object.fromEntries(operators.map((o) => [o.id, o.name]));
    const withOperator = (row) => ({
      ...row,
      amount: num(row.amount),
      // The migration is not a person, and attributing it to one would be a lie;
      // a genuinely deleted operator is a different case and says so.
      recordedBy: row.recordedById === 'system-backfill'
        ? 'Migrated from signup'
        : (nameOf[row.recordedById] || 'Deleted account'),
    });

    res.json({
      invoice: money(invoice),
      balances: invoiceBalances(invoice),
      payments: invoice.payments.map(withOperator),
      refunds: invoice.refunds.map(withOperator),
      issuer: {
        name: env.invoiceIssuerName || 'UEIBI',
        gstin: env.invoiceIssuerGstin || null,
        address: env.invoiceIssuerAddress || null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/invoices — raise a draft.
 *
 * Prices it once, here, through the same computePricing() the signup flow uses,
 * and stores the result. Nothing downstream recomputes.
 */
export async function createInvoice(req, res, next) {
  try {
    const parsed = invoiceCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { tenantId, subscriptionId, quantity, unitPrice, couponCode, dueAt, notes } = parsed.data;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, companyName: true, isPlatform: true,
        registration: { select: { gstin: true, email: true } },
        users: {
          where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, isDeleted: false, status: 'ACTIVE' },
          select: { email: true },
          take: 1,
        },
      },
    });
    if (!tenant) return res.status(404).json({ error: 'Company not found' });
    if (tenant.isPlatform) {
      return res.status(400).json({
        error: 'The platform tenant is not a customer and cannot be invoiced',
        code: 'PLATFORM_TENANT',
      });
    }

    let coupon = null;
    if (couponCode) {
      coupon = await prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
      const problem = couponValidationError(coupon);
      if (problem) return res.status(400).json({ error: problem, code: 'COUPON_INVALID' });
    }

    if (subscriptionId) {
      const sub = await prisma.subscription.findUnique({
        where: { id: subscriptionId }, select: { tenantId: true },
      });
      if (!sub) return res.status(404).json({ error: 'Subscription not found' });
      // An invoice billed to one company for another company's term would be
      // both wrong and very hard to spot later.
      if (sub.tenantId !== tenantId) {
        return res.status(400).json({ error: 'That subscription belongs to a different company' });
      }
    }

    const priced = priceInvoice({
      quantity,
      unitPrice,
      coupon,
      gstRate: Number(env.gstRate ?? 0.18),
    });

    // Bill-to is snapshot now: a company renaming itself next year must not
    // rewrite an invoice already addressed to the old name.
    const billToEmail = tenant.registration?.email || tenant.users[0]?.email;
    if (!billToEmail) {
      return res.status(400).json({
        error: `${tenant.companyName} has no billing contact — no registration email and no active admin.`,
        code: 'NO_BILLING_CONTACT',
      });
    }

    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        subscriptionId: subscriptionId || null,
        state: 'DRAFT',
        billToName: tenant.companyName,
        billToGstin: tenant.registration?.gstin || null,
        billToEmail,
        dueAt: dueAt || null,
        notes: notes || null,
        ...priced,
      },
      select: INVOICE_LIST_SELECT,
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.INVOICE_CREATED,
      targetType: 'INVOICE',
      targetId: invoice.id,
      tenantId,
      afterValue: { total: String(priced.totalAmount), quantity, state: 'DRAFT' },
    }).catch((err) => console.warn('[Invoice] audit write failed:', err.message));

    res.status(201).json({ invoice: money(invoice) });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/invoices/:id/issue
 *
 * Allocates the invoice number and makes the document real. Retries on a
 * duplicate number, because the read-then-write that picks the next number can
 * lose a race and the unique index is what actually guarantees the series.
 *
 * Issuing is also when a coupon is recorded as redeemed — a draft that is never
 * issued must not consume a limited coupon.
 */
export async function issueInvoice(req, res, next) {
  try {
    const parsed = invoiceIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const existing = await prisma.invoice.findUnique({
      where: { id: parsed.data.id },
      select: {
        id: true, state: true, tenantId: true, invoiceNumber: true,
        couponId: true, discountAmount: true, totalAmount: true,
      },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.state !== 'DRAFT') {
      return res.status(409).json({
        error: existing.state === 'VOID'
          ? 'A voided invoice cannot be issued'
          : `This invoice was already issued as ${existing.invoiceNumber}`,
      });
    }

    const issued = await withInvoiceNumber((invoiceNumber) => prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.update({
        where: { id: existing.id },
        data: { invoiceNumber, state: 'ISSUED', issuedAt: new Date() },
        select: INVOICE_LIST_SELECT,
      });

      if (existing.couponId) {
        // Both are written: timesUsed keeps the existing limit check working,
        // and the redemption row is what makes coupons reportable.
        await tx.coupon.update({
          where: { id: existing.couponId },
          data: { timesUsed: { increment: 1 } },
        });
        await tx.couponRedemption.create({
          data: {
            couponId: existing.couponId,
            invoiceId: inv.id,
            tenantId: existing.tenantId,
            discountAmount: existing.discountAmount,
          },
        });
      }
      return inv;
    }));

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.INVOICE_ISSUED,
      targetType: 'INVOICE',
      targetId: issued.id,
      tenantId: issued.tenantId,
      beforeValue: { state: 'DRAFT' },
      afterValue: { state: 'ISSUED', invoiceNumber: issued.invoiceNumber },
    }).catch((err) => console.warn('[Invoice] audit write failed:', err.message));

    res.json({ invoice: money(issued) });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/invoices/:id/void
 *
 * For an invoice raised in error. Refused once any payment exists: money that
 * arrived is refunded, not voided, and letting an operator void a paid invoice
 * would quietly delete a payment from the revenue figures.
 *
 * The number is NOT released. A voided invoice keeps it and is marked VOID,
 * which is exactly what an auditor expects to find in the series.
 */
export async function voidInvoice(req, res, next) {
  try {
    const parsedParams = invoiceIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = invoiceVoidSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: parsedParams.data.id },
      select: {
        id: true, state: true, tenantId: true, invoiceNumber: true,
        amountPaid: true, _count: { select: { payments: true } },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.state === 'VOID') {
      return res.status(409).json({ error: 'This invoice is already void' });
    }
    if (invoice._count.payments > 0) {
      return res.status(409).json({
        error: `${invoice._count.payments} payment(s) totalling ₹${num(invoice.amountPaid)} have been recorded against this invoice. Record a refund instead — voiding it would remove that money from your figures without returning it.`,
        code: 'INVOICE_HAS_PAYMENTS',
      });
    }

    const voided = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { state: 'VOID', voidedAt: new Date(), voidReason: parsed.data.reason },
      select: INVOICE_LIST_SELECT,
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.INVOICE_VOIDED,
      targetType: 'INVOICE',
      targetId: voided.id,
      tenantId: voided.tenantId,
      beforeValue: { state: invoice.state },
      afterValue: { state: 'VOID', invoiceNumber: voided.invoiceNumber },
      reason: parsed.data.reason,
    }).catch((err) => console.warn('[Invoice] audit write failed:', err.message));

    res.json({ invoice: money(voided) });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/invoices/:id/send — email the invoice to its billing contact. */
export async function sendInvoice(req, res, next) {
  try {
    const parsed = invoiceIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: parsed.data.id },
      include: { tenant: { select: { companyName: true } } },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.state === 'DRAFT') {
      return res.status(409).json({ error: 'Issue the invoice before sending it' });
    }
    if (invoice.state === 'VOID') {
      return res.status(409).json({ error: 'A voided invoice cannot be sent' });
    }

    const b = invoiceBalances(invoice);
    const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const html = renderEmailWrapper({
      title: `Invoice ${invoice.invoiceNumber}`,
      preheader: `${inr(b.total)} from ${env.invoiceIssuerName || 'UEIBI'}`,
      contentHtml: `
        <p style="margin:0 0 14px">Hello,</p>
        <p style="margin:0 0 14px">
          Please find invoice <strong>${invoice.invoiceNumber}</strong> for
          ${invoice.quantity} licence${invoice.quantity === 1 ? '' : 's'}.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 18px;font-size:14px">
          <tr><td style="padding:6px 0;color:#64748b">Subtotal</td><td style="padding:6px 0;text-align:right">${inr(num(invoice.subtotalAmount))}</td></tr>
          ${num(invoice.discountAmount) > 0 ? `<tr><td style="padding:6px 0;color:#64748b">Discount${invoice.couponCode ? ` (${invoice.couponCode})` : ''}</td><td style="padding:6px 0;text-align:right">− ${inr(num(invoice.discountAmount))}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#64748b">GST</td><td style="padding:6px 0;text-align:right">${inr(num(invoice.gstAmount))}</td></tr>
          <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;font-weight:700">Total</td><td style="padding:10px 0;border-top:1px solid #e2e8f0;text-align:right;font-weight:700">${inr(b.total)}</td></tr>
          ${b.paid > 0 ? `<tr><td style="padding:6px 0;color:#64748b">Received</td><td style="padding:6px 0;text-align:right">${inr(b.paid)}</td></tr>
          <tr><td style="padding:6px 0;font-weight:700">Outstanding</td><td style="padding:6px 0;text-align:right;font-weight:700">${inr(b.outstanding)}</td></tr>` : ''}
        </table>
        ${invoice.dueAt ? `<p style="margin:0 0 14px">Due by <strong>${new Date(invoice.dueAt).toLocaleDateString('en-IN')}</strong>.</p>` : ''}
        <p style="margin:0;font-size:12px;color:#64748b">
          ${env.invoiceIssuerName || 'UEIBI'}${env.invoiceIssuerGstin ? ` · GSTIN ${env.invoiceIssuerGstin}` : ''}
        </p>
      `,
    });

    const mail = await sendMail({
      to: invoice.billToEmail,
      subject: `Invoice ${invoice.invoiceNumber} — ${invoice.tenant.companyName}`,
      text: `Invoice ${invoice.invoiceNumber} for ${inr(b.total)}.${b.outstanding > 0 ? ` Outstanding: ${inr(b.outstanding)}.` : ''}`,
      html,
      event: 'INVOICE_SENT',
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.INVOICE_SENT,
      targetType: 'INVOICE',
      targetId: invoice.id,
      tenantId: invoice.tenantId,
      afterValue: { recipient: invoice.billToEmail, deliveryStatus: mail.status },
    }).catch((err) => console.warn('[Invoice] audit write failed:', err.message));

    res.json({
      sent: mail.status !== 'FAILED',
      recipient: invoice.billToEmail,
      deliveryStatus: mail.status,
      deliveryError: mail.error || null,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/invoices/:id/payments — record money that arrived.
 *
 * The platform is a book of record, not a till: nothing is charged here. An
 * operator writes down a bank transfer, cheque or UPI payment that has already
 * landed, and the invoice's totals are re-summed from its rows in the same
 * transaction so the summary can never drift from the detail.
 */
export async function recordPayment(req, res, next) {
  try {
    const parsedParams = invoiceIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = paymentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;

    const invoice = await prisma.invoice.findUnique({
      where: { id: parsedParams.data.id },
      select: {
        id: true, state: true, tenantId: true, invoiceNumber: true,
        totalAmount: true, amountPaid: true, amountRefunded: true,
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.state === 'DRAFT') {
      return res.status(409).json({ error: 'Issue the invoice before recording a payment against it' });
    }
    if (invoice.state === 'VOID') {
      return res.status(409).json({ error: 'A voided invoice cannot take a payment' });
    }

    const b = invoiceBalances(invoice);
    // Accepting more than is owed silently inflates revenue and leaves a
    // balance nobody can explain.
    if (data.amount > b.outstanding + 0.005) {
      return res.status(409).json({
        error: `That is more than is outstanding. ₹${b.outstanding.toLocaleString('en-IN')} remains on this invoice.`,
        code: 'OVERPAYMENT',
        outstanding: b.outstanding,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          tenantId: invoice.tenantId,
          amount: data.amount,
          method: data.method,
          reference: data.reference || null,
          receivedAt: data.receivedAt,
          recordedById: req.user.id,
          notes: data.notes || null,
        },
      });
      const updated = await syncInvoiceTotals(tx, invoice.id);
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.PAYMENT_RECORDED,
        targetType: 'INVOICE',
        targetId: invoice.id,
        tenantId: invoice.tenantId,
        beforeValue: { state: invoice.state, amountPaid: String(num(invoice.amountPaid)) },
        afterValue: {
          state: updated.state,
          amountPaid: String(num(updated.amountPaid)),
          method: data.method,
          reference: data.reference || null,
        },
      });
      return { payment, updated };
    });

    res.status(201).json({
      payment: { ...result.payment, amount: num(result.payment.amount) },
      invoice: money(result.updated),
      balances: invoiceBalances(result.updated),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/invoices/:id/refunds — record money returned.
 *
 * Recorded, not executed: there is no gateway to call, so this is the note that
 * a refund was sent. Capped at what has actually been received net of earlier
 * refunds, because refunding more than was paid is not a refund.
 */
export async function recordRefund(req, res, next) {
  try {
    const parsedParams = invoiceIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = refundCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;

    const invoice = await prisma.invoice.findUnique({
      where: { id: parsedParams.data.id },
      select: {
        id: true, state: true, tenantId: true, invoiceNumber: true,
        totalAmount: true, amountPaid: true, amountRefunded: true,
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const b = invoiceBalances(invoice);
    if (b.paid <= 0) {
      return res.status(409).json({ error: 'Nothing has been received against this invoice, so there is nothing to refund' });
    }
    if (data.amount > b.refundable + 0.005) {
      return res.status(409).json({
        error: `That is more than can be refunded. ₹${b.refundable.toLocaleString('en-IN')} of the money received has not yet been returned.`,
        code: 'OVERREFUND',
        refundable: b.refundable,
      });
    }

    if (data.paymentId) {
      const payment = await prisma.payment.findUnique({
        where: { id: data.paymentId }, select: { invoiceId: true },
      });
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      if (payment.invoiceId !== invoice.id) {
        return res.status(400).json({ error: 'That payment belongs to a different invoice' });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          invoiceId: invoice.id,
          paymentId: data.paymentId || null,
          tenantId: invoice.tenantId,
          amount: data.amount,
          reason: data.reason,
          method: data.method,
          reference: data.reference || null,
          refundedAt: data.refundedAt,
          recordedById: req.user.id,
        },
      });
      const updated = await syncInvoiceTotals(tx, invoice.id);
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.REFUND_RECORDED,
        targetType: 'INVOICE',
        targetId: invoice.id,
        tenantId: invoice.tenantId,
        beforeValue: { amountRefunded: String(b.refunded) },
        afterValue: {
          amountRefunded: String(num(updated.amountRefunded)),
          method: data.method,
          reference: data.reference || null,
        },
        reason: data.reason,
      });
      return { refund, updated };
    });

    res.status(201).json({
      refund: { ...result.refund, amount: num(result.refund.amount) },
      invoice: money(result.updated),
      balances: invoiceBalances(result.updated),
    });
  } catch (err) {
    next(err);
  }
}
