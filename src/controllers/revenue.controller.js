/**
 * revenue.controller.js — what was invoiced, what actually arrived.
 *
 * Every figure here comes from Invoice, Payment and Refund rows. Nothing is
 * estimated, projected or annualised beyond what the contracts actually say.
 *
 * Deliberately NOT reported:
 *   - MRR. Nothing recurs automatically — there is no scheduler and no stored
 *     payment mandate — so a monthly recurring figure would be invented.
 *   - Churn rate, LTV, ARPU trends. These need a longer history than exists and
 *     a subscription model that does not.
 *
 * What IS reported is contracted value, collections, what is outstanding, and
 * which terms come up for renewal. Those are answerable from the data.
 */
import { prisma } from '../lib/prisma.js';
import { revenueQuerySchema } from '../validations/billing.schema.js';
import { num, round2 } from '../services/billing.service.js';

/** First moment of a month, in local time. */
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** GET /platform/revenue */
export async function getRevenue(req, res, next) {
  try {
    const parsed = revenueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { months } = parsed.data;

    const now = new Date();
    // Inclusive of the current month, so `months: 12` means this month and the
    // eleven before it.
    const seriesFrom = monthStart(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1));

    const [
      invoiceAgg,
      paymentAgg,
      refundAgg,
      payments,
      refunds,
      invoices,
      outstandingRows,
      subscriptions,
      legacyAgg,
    ] = await Promise.all([
      // VOID invoices are excluded everywhere: they represent nothing owed.
      prisma.invoice.aggregate({
        where: { state: { not: 'VOID' } },
        _sum: { totalAmount: true, amountPaid: true, amountRefunded: true },
        _count: { _all: true },
      }),
      prisma.payment.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
      prisma.refund.aggregate({ where: { state: 'RECORDED' }, _sum: { amount: true }, _count: { _all: true } }),

      // The series is built from rows rather than a SQL date_trunc so the month
      // boundaries match the server's timezone, which is what the operator sees.
      prisma.payment.findMany({
        where: { receivedAt: { gte: seriesFrom } },
        select: { amount: true, receivedAt: true, method: true },
      }),
      prisma.refund.findMany({
        where: { refundedAt: { gte: seriesFrom }, state: 'RECORDED' },
        select: { amount: true, refundedAt: true },
      }),
      prisma.invoice.findMany({
        where: { state: { not: 'VOID' }, issuedAt: { gte: seriesFrom } },
        select: { totalAmount: true, issuedAt: true },
      }),

      // Money invoiced and not yet received, oldest first — this is a chase list.
      prisma.invoice.findMany({
        where: { state: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
        select: {
          id: true, invoiceNumber: true, billToName: true, tenantId: true,
          totalAmount: true, amountPaid: true, issuedAt: true, dueAt: true,
        },
        orderBy: { issuedAt: 'asc' },
      }),

      prisma.subscription.findMany({
        where: { state: { in: ['ACTIVE', 'PENDING'] } },
        select: {
          id: true, tenantId: true, packageName: true, seatCount: true,
          endsAt: true, startsAt: true,
          tenant: { select: { companyName: true } },
        },
      }),

      // Carried forward from the pre-billing flow and never reconciled. Counted,
      // but separated out so the headline figure can be read honestly.
      prisma.payment.aggregate({ where: { method: 'LEGACY' }, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    const invoiced = round2(num(invoiceAgg._sum.totalAmount));
    const collected = round2(num(paymentAgg._sum.amount));
    const refunded = round2(num(refundAgg._sum.amount));
    const legacy = round2(num(legacyAgg._sum.amount));

    // ── Monthly series ──────────────────────────────────────────────────────
    const buckets = new Map();
    for (let i = 0; i < months; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1);
      buckets.set(monthKey(d), {
        month: monthKey(d),
        label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        invoiced: 0,
        collected: 0,
        refunded: 0,
      });
    }
    for (const p of payments) {
      const b = buckets.get(monthKey(new Date(p.receivedAt)));
      if (b) b.collected = round2(b.collected + num(p.amount));
    }
    for (const r of refunds) {
      const b = buckets.get(monthKey(new Date(r.refundedAt)));
      if (b) b.refunded = round2(b.refunded + num(r.amount));
    }
    for (const i of invoices) {
      if (!i.issuedAt) continue;
      const b = buckets.get(monthKey(new Date(i.issuedAt)));
      if (b) b.invoiced = round2(b.invoiced + num(i.totalAmount));
    }
    const series = [...buckets.values()].map((b) => ({ ...b, net: round2(b.collected - b.refunded) }));

    // ── How money arrives ───────────────────────────────────────────────────
    const byMethodMap = new Map();
    for (const p of payments) {
      const cur = byMethodMap.get(p.method) || { method: p.method, amount: 0, count: 0 };
      cur.amount = round2(cur.amount + num(p.amount));
      cur.count += 1;
      byMethodMap.set(p.method, cur);
    }
    const byMethod = [...byMethodMap.values()].sort((a, b) => b.amount - a.amount);

    // ── Outstanding ─────────────────────────────────────────────────────────
    const outstanding = outstandingRows.map((i) => {
      const owed = round2(num(i.totalAmount) - num(i.amountPaid));
      const overdueDays = i.dueAt
        ? Math.floor((now - new Date(i.dueAt)) / 86400000)
        : null;
      return {
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        company: i.billToName,
        tenantId: i.tenantId,
        total: round2(num(i.totalAmount)),
        paid: round2(num(i.amountPaid)),
        outstanding: owed,
        issuedAt: i.issuedAt,
        dueAt: i.dueAt,
        overdueDays: overdueDays != null && overdueDays > 0 ? overdueDays : null,
      };
    });
    const outstandingTotal = round2(outstanding.reduce((a, o) => a + o.outstanding, 0));

    // ── Renewals ────────────────────────────────────────────────────────────
    // Perpetual terms have no end date and can never come up for renewal, so
    // they are excluded rather than counted as "never due".
    const dated = subscriptions.filter((s) => s.endsAt != null);
    const inDays = (n) => dated.filter((s) => {
      const days = Math.ceil((new Date(s.endsAt) - now) / 86400000);
      return days >= 0 && days <= n;
    });
    const renewalRow = (s) => ({
      id: s.id,
      tenantId: s.tenantId,
      company: s.tenant.companyName,
      packageName: s.packageName,
      seatCount: s.seatCount,
      endsAt: s.endsAt,
      daysRemaining: Math.ceil((new Date(s.endsAt) - now) / 86400000),
    });

    // ── Contracted value ────────────────────────────────────────────────────
    // What live terms are worth per year, computed from what each was actually
    // invoiced rather than from a package price that may since have moved.
    const termInvoices = dated.length
      ? await prisma.invoice.groupBy({
          by: ['subscriptionId'],
          where: { subscriptionId: { in: dated.map((s) => s.id) }, state: { not: 'VOID' } },
          _sum: { totalAmount: true },
        })
      : [];
    const valueBySub = Object.fromEntries(termInvoices.map((t) => [t.subscriptionId, num(t._sum.totalAmount)]));
    const annualisedContractValue = round2(dated.reduce((sum, s) => {
      const value = valueBySub[s.id] || 0;
      const lengthDays = Math.max(1, (new Date(s.endsAt) - new Date(s.startsAt)) / 86400000);
      return sum + (value * 365) / lengthDays;
    }, 0));

    res.json({
      headline: {
        invoiced,
        collected,
        refunded,
        net: round2(collected - refunded),
        outstanding: outstandingTotal,
        invoiceCount: invoiceAgg._count._all,
        paymentCount: paymentAgg._count._all,
        refundCount: refundAgg._count._all,
        currency: 'INR',
      },
      // Flagged rather than hidden: these were carried forward from the old
      // signup flow and have never been reconciled against a bank statement.
      unverified: {
        amount: legacy,
        count: legacyAgg._count._all,
        share: collected > 0 ? Math.round((legacy / collected) * 100) : 0,
      },
      series,
      byMethod,
      outstanding: { total: outstandingTotal, items: outstanding },
      renewals: {
        next30: inDays(30).map(renewalRow),
        next60: inDays(60).map(renewalRow),
        next90: inDays(90).map(renewalRow),
        perpetualCount: subscriptions.length - dated.length,
      },
      contracts: {
        // Not MRR. Nothing here recurs by itself; this is what the live fixed
        // terms are worth over a year, and it is labelled that way in the UI.
        annualisedContractValue,
        liveTerms: subscriptions.length,
        datedTerms: dated.length,
      },
      months,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/coupons/performance — what each coupon actually cost.
 *
 * Coupon.timesUsed is a counter and cannot answer "how much discount did this
 * give away" or "which companies used it". CouponRedemption rows can.
 */
export async function getCouponPerformance(req, res, next) {
  try {
    const coupons = await prisma.coupon.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, code: true, discountType: true, discountValue: true,
        bdmName: true, active: true, expiresAt: true, usageLimit: true, timesUsed: true,
      },
    });

    const [redemptionRows, invoiceRows] = await Promise.all([
      prisma.couponRedemption.groupBy({
        by: ['couponId'],
        _sum: { discountAmount: true },
        _count: { _all: true },
      }),
      // What the discounted invoices were actually worth, so a coupon can be
      // judged on revenue influenced rather than discount given alone.
      prisma.invoice.groupBy({
        by: ['couponId'],
        where: { couponId: { not: null }, state: { not: 'VOID' } },
        _sum: { totalAmount: true, amountPaid: true },
      }),
    ]);

    const redemptionBy = Object.fromEntries(redemptionRows.map((r) => [r.couponId, r]));
    const invoiceBy = Object.fromEntries(invoiceRows.map((r) => [r.couponId, r]));

    const items = coupons.map((c) => {
      const red = redemptionBy[c.id];
      const inv = invoiceBy[c.id];
      return {
        ...c,
        discountValue: num(c.discountValue),
        redemptions: red?._count?._all ?? 0,
        discountGiven: round2(num(red?._sum?.discountAmount)),
        revenueInfluenced: round2(num(inv?._sum?.totalAmount)),
        revenueCollected: round2(num(inv?._sum?.amountPaid)),
        // timesUsed predates redemption rows, so the two can legitimately
        // disagree on coupons used before this existed. Surfaced, not hidden.
        counterDrift: (red?._count?._all ?? 0) !== c.timesUsed,
      };
    });

    res.json({
      items,
      summary: {
        totalDiscountGiven: round2(items.reduce((a, i) => a + i.discountGiven, 0)),
        totalRevenueInfluenced: round2(items.reduce((a, i) => a + i.revenueInfluenced, 0)),
        activeCoupons: items.filter((i) => i.active).length,
        currency: 'INR',
      },
    });
  } catch (err) {
    next(err);
  }
}
