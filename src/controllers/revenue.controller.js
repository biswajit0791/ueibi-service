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

/** GET /platform/revenue — Synchronized with Sales Team & Advanced Multi-attribute Filters */
export async function getRevenue(req, res, next) {
  try {
    const parsed = revenueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { months, salesRepId, category, method } = parsed.data;

    const now = new Date();
    // Inclusive of the current month, so `months: 12` means this month and the
    // eleven before it.
    const seriesFrom = monthStart(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1));

    // 1. Fetch Sales Team (PLATFORM_SALES)
    const salesTeamMembers = await prisma.tenantUser.findMany({
      where: { role: 'PLATFORM_SALES' },
      select: { id: true, name: true, email: true, status: true },
      orderBy: { name: 'asc' },
    });

    const [
      allInvoices,
      allPayments,
      allRefunds,
      allSubscriptions,
      legacyAgg,
    ] = await Promise.all([
      prisma.invoice.findMany({
        where: { state: { not: 'VOID' } },
        include: {
          subscription: {
            select: {
              id: true,
              salesRepId: true,
              renewedFromId: true,
              packageName: true,
              salesRep: { select: { id: true, name: true, email: true } },
            },
          },
        },
        orderBy: { issuedAt: 'desc' },
      }),
      prisma.payment.findMany({
        include: {
          invoice: {
            select: {
              id: true,
              subscriptionId: true,
              subscription: {
                select: { id: true, salesRepId: true, renewedFromId: true },
              },
            },
          },
        },
        orderBy: { receivedAt: 'desc' },
      }),
      prisma.refund.findMany({
        where: { state: 'RECORDED' },
        include: {
          payment: {
            select: {
              invoice: {
                select: {
                  subscription: {
                    select: { salesRepId: true, renewedFromId: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.subscription.findMany({
        where: { state: { in: ['ACTIVE', 'PENDING'] } },
        include: {
          tenant: { select: { companyName: true } },
          salesRep: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.payment.aggregate({ where: { method: 'LEGACY' }, _sum: { amount: true }, _count: { _all: true } }),
    ]);

    // ── Build Sales Team Performance & Synchronization Breakdown ──────────────
    const salesStatsMap = new Map();
    for (const member of salesTeamMembers) {
      salesStatsMap.set(member.id, {
        id: member.id,
        name: member.name,
        email: member.email,
        status: member.status,
        invoiced: 0,
        collected: 0,
        outstanding: 0,
        renewalsCount: 0,
        newSalesCount: 0,
        totalSeats: 0,
      });
    }

    const unassignedStats = {
      id: 'UNASSIGNED',
      name: 'Direct / Unassigned',
      email: 'direct@platform.internal',
      status: 'ACTIVE',
      invoiced: 0,
      collected: 0,
      outstanding: 0,
      renewalsCount: 0,
      newSalesCount: 0,
      totalSeats: 0,
    };

    // Subscriptions attribution
    for (const sub of allSubscriptions) {
      const target = sub.salesRepId ? salesStatsMap.get(sub.salesRepId) : unassignedStats;
      if (target) {
        if (sub.renewedFromId) {
          target.renewalsCount += 1;
        } else {
          target.newSalesCount += 1;
        }
        target.totalSeats += (sub.seatCount || 0);
      }
    }

    // Invoices attribution
    for (const inv of allInvoices) {
      const repId = inv.subscription?.salesRepId;
      const target = repId ? salesStatsMap.get(repId) : unassignedStats;
      const owed = round2(num(inv.totalAmount) - num(inv.amountPaid));
      if (target) {
        target.invoiced = round2(target.invoiced + num(inv.totalAmount));
        target.collected = round2(target.collected + num(inv.amountPaid));
        if (owed > 0) {
          target.outstanding = round2(target.outstanding + owed);
        }
      }
    }

    const bySalesRep = [...salesStatsMap.values()];
    if (unassignedStats.invoiced > 0 || unassignedStats.renewalsCount > 0 || unassignedStats.newSalesCount > 0) {
      bySalesRep.push(unassignedStats);
    }
    bySalesRep.sort((a, b) => (b.renewalsCount + b.newSalesCount) - (a.renewalsCount + a.newSalesCount) || b.collected - a.collected);

    // ── Category Breakdown (Renewal vs New Subscriptions) ────────────────────
    const byCategory = {
      renewals: { count: 0, invoiced: 0, collected: 0, outstanding: 0 },
      newSales: { count: 0, invoiced: 0, collected: 0, outstanding: 0 },
    };

    for (const inv of allInvoices) {
      const isRenewal = Boolean(inv.subscription?.renewedFromId);
      const target = isRenewal ? byCategory.renewals : byCategory.newSales;
      target.count += 1;
      target.invoiced = round2(target.invoiced + num(inv.totalAmount));
      target.collected = round2(target.collected + num(inv.amountPaid));
      const owed = round2(num(inv.totalAmount) - num(inv.amountPaid));
      if (owed > 0) target.outstanding = round2(target.outstanding + owed);
    }

    // ── Filter Data based on query parameters ─────────────────────────────────
    const isMatchingSalesRep = (subSalesRepId) => {
      if (!salesRepId || salesRepId === 'ALL') return true;
      if (salesRepId === 'UNASSIGNED') return !subSalesRepId;
      return subSalesRepId === salesRepId;
    };

    const isMatchingCategory = (renewedFromId) => {
      if (!category || category === 'ALL') return true;
      if (category === 'RENEWAL') return Boolean(renewedFromId);
      if (category === 'NEW') return !renewedFromId;
      return true;
    };

    const isMatchingMethod = (pMethod) => {
      if (!method || method === 'ALL') return true;
      return pMethod === method;
    };

    const filteredInvoices = allInvoices.filter((i) => {
      const repId = i.subscription?.salesRepId;
      const renewedFromId = i.subscription?.renewedFromId;
      return isMatchingSalesRep(repId) && isMatchingCategory(renewedFromId);
    });

    const filteredPayments = allPayments.filter((p) => {
      const repId = p.invoice?.subscription?.salesRepId;
      const renewedFromId = p.invoice?.subscription?.renewedFromId;
      return isMatchingSalesRep(repId) && isMatchingCategory(renewedFromId) && isMatchingMethod(p.method);
    });

    const filteredRefunds = allRefunds.filter((r) => {
      const repId = r.payment?.invoice?.subscription?.salesRepId;
      const renewedFromId = r.payment?.invoice?.subscription?.renewedFromId;
      return isMatchingSalesRep(repId) && isMatchingCategory(renewedFromId);
    });

    const filteredSubscriptions = allSubscriptions.filter((s) => {
      return isMatchingSalesRep(s.salesRepId) && isMatchingCategory(s.renewedFromId);
    });

    // ── Headline Calculations ────────────────────────────────────────────────
    const invoiced = round2(filteredInvoices.reduce((sum, i) => sum + num(i.totalAmount), 0));
    const collected = round2(filteredPayments.reduce((sum, p) => sum + num(p.amount), 0));
    const refunded = round2(filteredRefunds.reduce((sum, r) => sum + num(r.amount), 0));
    const legacy = (!method || method === 'ALL' || method === 'LEGACY')
      ? round2(num(legacyAgg._sum.amount))
      : 0;

    // ── Monthly Series ───────────────────────────────────────────────────────
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

    for (const p of filteredPayments) {
      if (new Date(p.receivedAt) >= seriesFrom) {
        const b = buckets.get(monthKey(new Date(p.receivedAt)));
        if (b) b.collected = round2(b.collected + num(p.amount));
      }
    }

    for (const r of filteredRefunds) {
      if (new Date(r.refundedAt) >= seriesFrom) {
        const b = buckets.get(monthKey(new Date(r.refundedAt)));
        if (b) b.refunded = round2(b.refunded + num(r.amount));
      }
    }

    for (const i of filteredInvoices) {
      if (i.issuedAt && new Date(i.issuedAt) >= seriesFrom) {
        const b = buckets.get(monthKey(new Date(i.issuedAt)));
        if (b) b.invoiced = round2(b.invoiced + num(i.totalAmount));
      }
    }

    const series = [...buckets.values()].map((b) => ({ ...b, net: round2(b.collected - b.refunded) }));

    // ── Payment Methods Breakdown ───────────────────────────────────────────
    const byMethodMap = new Map();
    for (const p of filteredPayments) {
      const cur = byMethodMap.get(p.method) || { method: p.method, amount: 0, count: 0 };
      cur.amount = round2(cur.amount + num(p.amount));
      cur.count += 1;
      byMethodMap.set(p.method, cur);
    }
    const byMethod = [...byMethodMap.values()].sort((a, b) => b.amount - a.amount);

    // ── Outstanding Invoices ────────────────────────────────────────────────
    const outstandingRows = filteredInvoices.filter((i) => ['ISSUED', 'PARTIALLY_PAID'].includes(i.state));
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
        salesRep: i.subscription?.salesRep ? { id: i.subscription.salesRep.id, name: i.subscription.salesRep.name } : null,
        isRenewal: Boolean(i.subscription?.renewedFromId),
      };
    });
    const outstandingTotal = round2(outstanding.reduce((a, o) => a + o.outstanding, 0));

    // ── Renewals Pipeline ───────────────────────────────────────────────────
    const dated = filteredSubscriptions.filter((s) => s.endsAt != null);
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
      salesRep: s.salesRep ? { id: s.salesRep.id, name: s.salesRep.name } : null,
    });

    // ── Annualised Contract Value ───────────────────────────────────────────
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
        invoiceCount: filteredInvoices.length,
        paymentCount: filteredPayments.length,
        refundCount: filteredRefunds.length,
        currency: 'INR',
      },
      unverified: {
        amount: legacy,
        count: legacyAgg._count._all,
        share: collected > 0 ? Math.round((legacy / collected) * 100) : 0,
      },
      series,
      byMethod,
      bySalesRep,
      byCategory,
      outstanding: { total: outstandingTotal, items: outstanding },
      renewals: {
        next30: inDays(30).map(renewalRow),
        next60: inDays(60).map(renewalRow),
        next90: inDays(90).map(renewalRow),
        perpetualCount: filteredSubscriptions.length - dated.length,
      },
      contracts: {
        annualisedContractValue,
        liveTerms: filteredSubscriptions.length,
        datedTerms: dated.length,
      },
      salesTeamList: salesTeamMembers.map((m) => ({ id: m.id, name: m.name, email: m.email })),
      activeFilters: {
        salesRepId: salesRepId || 'ALL',
        category: category || 'ALL',
        method: method || 'ALL',
        months,
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
      prisma.invoice.groupBy({
        by: ['couponId'],
        where: { couponId: { not: null }, state: { not: 'VOID' } },
        _sum: { totalAmount: true },
      }),
    ]);

    const discountMap = Object.fromEntries(
      redemptionRows.map((r) => [r.couponId, { discount: num(r._sum.discountAmount), redemptions: r._count._all }])
    );
    const invoiceMap = Object.fromEntries(
      invoiceRows.map((i) => [i.couponId, num(i._sum.totalAmount)])
    );

    const items = coupons.map((c) => {
      const red = discountMap[c.id] || { discount: 0, redemptions: 0 };
      const invoiced = invoiceMap[c.id] || 0;
      return {
        id: c.id,
        code: c.code,
        bdmName: c.bdmName,
        discountType: c.discountType,
        discountValue: num(c.discountValue),
        active: c.active,
        expiresAt: c.expiresAt,
        timesUsed: c.timesUsed,
        redemptionsRecorded: red.redemptions,
        totalDiscountGiven: round2(red.discount),
        revenueInfluenced: round2(invoiced),
      };
    });

    const totals = {
      couponsCount: items.length,
      activeCoupons: items.filter((i) => i.active).length,
      totalDiscountGiven: round2(items.reduce((s, i) => s + i.totalDiscountGiven, 0)),
      totalRevenueInfluenced: round2(items.reduce((s, i) => s + i.revenueInfluenced, 0)),
    };

    res.json({ totals, coupons: items });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/revenue/export — CSV export of all finalized invoices and payment ledger.
 */
export async function exportRevenueReport(req, res, next) {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { state: { not: 'VOID' } },
      include: {
        tenant: { select: { companyName: true, tenantCode: true } },
        subscription: {
          select: {
            packageName: true,
            seatCount: true,
            renewedFromId: true,
            salesRep: { select: { name: true, email: true } },
          },
        },
        payments: {
          select: { amount: true, method: true, reference: true, receivedAt: true },
        },
      },
      orderBy: { issuedAt: 'desc' },
    });

    const header = [
      'Invoice Number',
      'Company Name',
      'Package',
      'Category',
      'Sales Representative',
      'State',
      'Total Amount (INR)',
      'Amount Paid (INR)',
      'Outstanding (INR)',
      'Issued Date',
      'Due Date',
    ].join(',');

    const rows = invoices.map((inv) => {
      const category = inv.subscription?.renewedFromId ? 'RENEWAL' : 'NEW';
      const salesRep = inv.subscription?.salesRep ? inv.subscription.salesRep.name : 'Unassigned';
      const total = num(inv.totalAmount);
      const paid = num(inv.amountPaid);
      const outstanding = round2(total - paid);

      return [
        `"${inv.invoiceNumber}"`,
        `"${(inv.tenant?.companyName || inv.billToName || '').replace(/"/g, '""')}"`,
        `"${inv.subscription?.packageName || 'Custom'}"`,
        category,
        `"${salesRep}"`,
        inv.state,
        total,
        paid,
        outstanding,
        inv.issuedAt ? new Date(inv.issuedAt).toISOString().split('T')[0] : '',
        inv.dueAt ? new Date(inv.dueAt).toISOString().split('T')[0] : '',
      ].join(',');
    });

    const csv = [header, ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="revenue_sales_audit_report.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
}
