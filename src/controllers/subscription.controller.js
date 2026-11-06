/**
 * subscription.controller.js — the term a company has bought.
 *
 * A subscription is one term: a package's seats and price, fixed for a start and
 * end date. Nothing recurs automatically — there is no scheduler and no stored
 * payment mandate — so a renewal is an operator-approved repeat purchase that
 * creates a NEW row pointing back at the old one. That chain is the history:
 * nothing is overwritten, so what a company paid two years ago is still there.
 *
 * Starting or renewing a term is the one place billing reaches into the product:
 * it sets Tenant.licenseLimit from the seat count, which license.service.js then
 * enforces on every user creation, and mirrors the end date onto
 * Tenant.planEndsAt so the expiry alerts see it.
 */
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { couponValidationError, computePricing } from '../lib/pricing.js';
import {
  priceInvoice, addMonths, subscriptionStateOf, num, withInvoiceNumber,
} from '../services/billing.service.js';
import {
  subscriptionQuerySchema,
  subscriptionCreateSchema,
  subscriptionRenewSchema,
  subscriptionCancelSchema,
  subscriptionIdParamSchema,
} from '../validations/billing.schema.js';
import { tenantIdParamSchema } from '../validations/platform.schema.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';
import { isPlatformSales } from '../lib/roles.js';

/**
 * Platform Sales/BD sells at the package price and discounts only through a
 * coupon the owner created, and every term they start must be invoiced.
 * Returns an error message, or null when the request is allowed.
 */
function salesTermRestriction(user, { unitPrice, createInvoice }) {
  if (!isPlatformSales(user?.role)) return null;
  if (unitPrice != null) {
    return 'Sales cannot set a custom price. Sell at the package price and apply a coupon for any discount.';
  }
  if (createInvoice === false) {
    return 'Sales cannot start or renew a term without raising its invoice.';
  }
  return null;
}

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

const SUBSCRIPTION_SELECT = {
  id: true, tenantId: true, packageId: true, packageName: true, seatCount: true,
  state: true, startsAt: true, endsAt: true, renewedFromId: true, salesRepId: true,
  registrationId: true, cancelledAt: true, cancelReason: true, createdAt: true,
  tenant: { select: { id: true, companyName: true, tenantCode: true, status: true, creditBalance: true } },
  package: { select: { id: true, name: true, interval: true, termMonths: true, unitPrice: true } },
  salesRep: { select: { id: true, name: true, email: true } },
  renewedTo: { select: { id: true, startsAt: true, state: true } },
  invoices: {
    select: {
      id: true, invoiceNumber: true, totalAmount: true, discountAmount: true, couponCode: true,
    },
    take: 1,
    orderBy: { createdAt: 'desc' },
  },
};

/** Days until a term ends; null for a perpetual licence. */
const daysUntil = (endsAt) => (endsAt == null
  ? null
  : Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000));

const determineUrgency = (endsAt, state) => {
  if (state === 'CANCELLED') return 'CANCELLED';
  if (!endsAt) return 'PERPETUAL';
  const days = daysUntil(endsAt);
  if (days < 0 || state === 'EXPIRED') return 'EXPIRED';
  if (days <= 7) return 'CRITICAL';
  if (days <= 30) return 'DUE_SOON';
  if (days <= 90) return 'UPCOMING';
  return 'HEALTHY';
};

const decorate = (s) => {
  const days = daysUntil(s.endsAt);
  const unitPrice = s.package?.unitPrice ? num(s.package.unitPrice) : 3999;
  const estimatedAnnualValue = round2(s.seatCount * unitPrice * 1.18);
  const latestInvoice = s.invoices?.[0] || null;

  return {
    ...s,
    daysRemaining: days,
    perpetual: s.endsAt == null,
    renewalExperience: {
      isRenewal: Boolean(s.renewedFromId),
      hasRenewed: Boolean(s.renewedTo?.id),
      urgency: determineUrgency(s.endsAt, s.state),
      estimatedRenewalValue: estimatedAnnualValue,
      couponCodeUsed: latestInvoice?.couponCode || null,
      discountGiven: latestInvoice?.discountAmount ? num(latestInvoice.discountAmount) : 0,
      managedByBdm: Boolean(s.salesRep?.name),
    },
  };
};

/**
 * Builds the invoice that accompanies a term.
 *
 * Priced once here through the same computePricing() the signup flow uses, then
 * stored. The draft is issued immediately: a term that has been sold has been
 * invoiced, and leaving it in draft would mean the number is never allocated.
 */
async function raiseInvoiceFor(tx, {
  tenant, subscription, quantity, unitPrice, coupon, req, invoiceNumber,
}) {
  const priced = priceInvoice({
    quantity,
    unitPrice,
    coupon,
    gstRate: Number(env.gstRate ?? 0.18),
  });

  const billToEmail = tenant.registration?.email
    || tenant.users?.[0]?.email
    || null;
  if (!billToEmail) {
    const err = new Error(`${tenant.companyName} has no billing contact — no registration email and no active admin.`);
    err.statusCode = 400;
    err.code = 'NO_BILLING_CONTACT';
    throw err;
  }

  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber,
      tenantId: tenant.id,
      subscriptionId: subscription.id,
      state: 'ISSUED',
      issuedAt: new Date(),
      billToName: tenant.companyName,
      billToGstin: tenant.registration?.gstin || null,
      billToEmail,
      ...priced,
      creditRedeemed,
      totalAmount: finalTotal,
    },
  });

  if (creditRedeemed > 0) {
    const newCreditBal = Math.round(((tenantCredit - creditRedeemed) + Number.EPSILON) * 100) / 100;
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { creditBalance: newCreditBal },
    });
    await tx.walletTransaction.create({
      data: {
        tenantId: tenant.id,
        type: 'RENEWAL_REDEMPTION',
        amount: -creditRedeemed,
        balanceAfter: newCreditBal,
        description: `Wallet credit redeemed against renewal invoice ${invoiceNumber}`,
        referenceId: invoice.id,
        createdById: req.user?.id || null,
      },
    });
  }

  if (coupon) {
    await tx.coupon.update({ where: { id: coupon.id }, data: { timesUsed: { increment: 1 } } });
    await tx.couponRedemption.create({
      data: {
        couponId: coupon.id,
        invoiceId: invoice.id,
        tenantId: tenant.id,
        discountAmount: priced.discountAmount,
      },
    });
  }

  await recordPlatformAction({
    tx,
    req,
    action: PLATFORM_ACTIONS.INVOICE_ISSUED,
    targetType: 'INVOICE',
    targetId: invoice.id,
    tenantId: tenant.id,
    afterValue: { invoiceNumber, total: String(priced.totalAmount), state: 'ISSUED' },
  });

  return invoice;
}

/**
 * Loads a tenant with what raising an invoice against it needs, and refuses the
 * platform's own tenant — it is not a customer and cannot buy anything.
 */
async function loadBillableTenant(res, tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, companyName: true, isPlatform: true, licenseLimit: true, planEndsAt: true, creditBalance: true,
      registration: { select: { email: true, gstin: true } },
      users: {
        where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, isDeleted: false, status: 'ACTIVE' },
        select: { email: true },
        take: 1,
      },
    },
  });
  if (!tenant) {
    res.status(404).json({ error: 'Company not found' });
    return null;
  }
  if (tenant.isPlatform) {
    res.status(400).json({
      error: 'The platform tenant is not a customer and cannot hold a subscription',
      code: 'PLATFORM_TENANT',
    });
    return null;
  }
  return tenant;
}

/** GET /platform/subscriptions */
export async function listSubscriptions(req, res, next) {
  try {
    const parsed = subscriptionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { state, tenantId, expiringInDays, page, limit } = parsed.data;

    const where = {
      ...(state ? { state } : {}),
      ...(tenantId ? { tenantId } : {}),
      // The renewal queue: terms that actually end, ending soon. A perpetual
      // licence has no endsAt and must never appear here.
      ...(expiringInDays
        ? {
            state: 'ACTIVE',
            endsAt: { not: null, lte: new Date(Date.now() + expiringInDays * 86400000) },
          }
        : {}),
    };

    const skip = (page - 1) * limit;
    const [total, rows, stateRows] = await Promise.all([
      prisma.subscription.count({ where }),
      prisma.subscription.findMany({
        where,
        select: SUBSCRIPTION_SELECT,
        // Soonest to expire first when chasing renewals; newest otherwise.
        orderBy: expiringInDays
          ? [{ endsAt: 'asc' }]
          : [{ startsAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.subscription.groupBy({ by: ['state'], _count: { state: true } }),
    ]);

    const byState = { PENDING: 0, ACTIVE: 0, EXPIRED: 0, CANCELLED: 0 };
    for (const r of stateRows) byState[r.state] = r._count.state;

    res.json({
      items: rows.map(decorate),
      summary: {
        byState,
        total: Object.values(byState).reduce((a, b) => a + b, 0),
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/subscriptions/:id — one term, with its renewal chain. */
export async function getSubscription(req, res, next) {
  try {
    const parsed = subscriptionIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const sub = await prisma.subscription.findUnique({
      where: { id: parsed.data.id },
      select: {
        ...SUBSCRIPTION_SELECT,
        invoices: {
          select: {
            id: true, invoiceNumber: true, state: true, totalAmount: true,
            amountPaid: true, issuedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    // The whole chain for this company, so the history reads as one story
    // rather than a row in isolation.
    const chain = await prisma.subscription.findMany({
      where: { tenantId: sub.tenantId },
      select: {
        id: true, packageName: true, seatCount: true, state: true,
        startsAt: true, endsAt: true, renewedFromId: true,
      },
      orderBy: { startsAt: 'asc' },
    });

    res.json({
      subscription: decorate(sub),
      invoices: sub.invoices.map((i) => ({
        ...i,
        totalAmount: num(i.totalAmount),
        amountPaid: num(i.amountPaid),
      })),
      history: chain,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/tenants/:id/subscription — sell a company a term.
 *
 * Copies the package's name, seats and price onto the subscription, so the sale
 * survives the package being renamed, repriced or retired.
 */
export async function startSubscription(req, res, next) {
  try {
    const parsedParams = tenantIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = subscriptionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { packageId, startsAt, seatCount, unitPrice, couponCode, createInvoice } = parsed.data;
    const salesBlock = salesTermRestriction(req.user, { unitPrice, createInvoice });
    if (salesBlock) return res.status(403).json({ error: salesBlock, code: 'SALES_RESTRICTED' });

    const tenant = await loadBillableTenant(res, parsedParams.data.id);
    if (!tenant) return null;

    const pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    if (!pkg.active) {
      return res.status(409).json({ error: `${pkg.name} has been retired and can no longer be sold` });
    }

    // A live term already covers this company; two overlapping terms would make
    // the seat limit and the end date ambiguous.
    const live = await prisma.subscription.findFirst({
      where: { tenantId: tenant.id, state: { in: ['ACTIVE', 'PENDING'] } },
      select: { id: true, packageName: true, endsAt: true },
    });
    if (live) {
      return res.status(409).json({
        error: `${tenant.companyName} already has a live term (${live.packageName}). Renew or cancel it rather than starting a second.`,
        code: 'SUBSCRIPTION_EXISTS',
        subscriptionId: live.id,
      });
    }

    const seats = seatCount ?? pkg.seatCount;
    const price = unitPrice ?? num(pkg.unitPrice);

    // Cutting the seat limit below the people already in the system does not
    // remove anyone, but it does block the next invitation. Say so rather than
    // doing it quietly.
    const activeUsers = await prisma.tenantUser.count({
      where: { tenantId: tenant.id, isDeleted: false, status: 'ACTIVE' },
    });
    if (seats < activeUsers) {
      return res.status(409).json({
        error: `${tenant.companyName} has ${activeUsers} active users. A ${seats}-seat term would block every new invitation — reduce their headcount first or sell more seats.`,
        code: 'SEATS_BELOW_HEADCOUNT',
        activeUsers,
      });
    }

    let coupon = null;
    if (couponCode) {
      coupon = await prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
      const problem = couponValidationError(coupon);
      if (problem) return res.status(400).json({ error: problem, code: 'COUPON_INVALID' });
    }

    const endsAt = pkg.termMonths ? addMonths(startsAt, pkg.termMonths) : null;
    const state = subscriptionStateOf({ startsAt, endsAt, cancelledAt: null });

    const effectiveSalesRepId = data.salesRepId || (req.user?.role === 'PLATFORM_SALES' ? req.user.id : null);

    const result = await withInvoiceNumber((invoiceNumber) => prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          packageId: pkg.id,
          packageName: pkg.name,     // snapshot
          seatCount: seats,          // snapshot
          state,
          startsAt,
          endsAt,
        },
        select: SUBSCRIPTION_SELECT,
      });

      // Billing reaches into the product here, and only here: the seat limit
      // that license.service.js enforces comes from what was sold.
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { licenseLimit: seats, planEndsAt: endsAt },
      });

      const invoice = createInvoice
        ? await raiseInvoiceFor(tx, { tenant, subscription, quantity: seats, unitPrice: price, coupon, req, invoiceNumber })
        : null;

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.SUBSCRIPTION_STARTED,
        targetType: 'SUBSCRIPTION',
        targetId: subscription.id,
        tenantId: tenant.id,
        beforeValue: { licenseLimit: tenant.licenseLimit, planEndsAt: tenant.planEndsAt },
        afterValue: {
          packageName: pkg.name, seatCount: seats, state,
          endsAt, licenseLimit: seats,
        },
      });

      return { subscription, invoice };
    }));

    res.status(201).json({
      subscription: decorate(result.subscription),
      invoice: result.invoice
        ? { ...result.invoice, totalAmount: num(result.invoice.totalAmount), unitPrice: num(result.invoice.unitPrice) }
        : null,
      licenseLimit: result.subscription.seatCount,
    });
  } catch (err) {
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message, code: err.code });
    next(err);
  }
}

/**
 * POST /platform/subscriptions/:id/renew
 *
 * Creates a NEW term linked to the old one and leaves the old row untouched.
 * `renewedFromId` is unique, so a term can be renewed exactly once — which is
 * what makes the chain a chain rather than a tree.
 */
export async function renewSubscription(req, res, next) {
  try {
    const parsedParams = subscriptionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = subscriptionRenewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;
    const salesBlock = salesTermRestriction(req.user, data);
    if (salesBlock) return res.status(403).json({ error: salesBlock, code: 'SALES_RESTRICTED' });

    const current = await prisma.subscription.findUnique({
      where: { id: parsedParams.data.id },
      select: {
        id: true, tenantId: true, packageId: true, packageName: true, seatCount: true,
        state: true, endsAt: true, cancelledAt: true,
        package: { select: { id: true, name: true, active: true, seatCount: true, unitPrice: true, termMonths: true } },
      },
    });
    if (!current) return res.status(404).json({ error: 'Subscription not found' });
    if (current.cancelledAt) {
      return res.status(409).json({ error: 'A cancelled term cannot be renewed. Start a new one instead.' });
    }

    const already = await prisma.subscription.findUnique({
      where: { renewedFromId: current.id },
      select: { id: true, startsAt: true },
    });
    if (already) {
      return res.status(409).json({
        error: 'This term has already been renewed.',
        code: 'ALREADY_RENEWED',
        subscriptionId: already.id,
      });
    }

    const tenant = await loadBillableTenant(res, current.tenantId);
    if (!tenant) return null;

    // Renewing onto a different package is allowed — an upgrade is a renewal
    // with a different package.
    const pkg = data.packageId
      ? await prisma.package.findUnique({ where: { id: data.packageId } })
      : current.package;
    if (data.packageId && !pkg) return res.status(404).json({ error: 'Package not found' });
    if (pkg && !pkg.active && data.packageId) {
      return res.status(409).json({ error: `${pkg.name} has been retired and can no longer be sold` });
    }

    // An explicit override wins. Otherwise, renewing onto a DIFFERENT package
    // takes that package's seats — choosing a smaller package and silently
    // keeping the old seat count would mean the customer is billed for one
    // thing and given another.
    const seats = data.seatCount
      ?? (data.packageId && pkg ? pkg.seatCount : current.seatCount);
    const price = data.unitPrice ?? (pkg ? num(pkg.unitPrice) : null);
    if (price == null) {
      return res.status(400).json({
        error: 'This term has no package to take a price from. Give a unit price or choose a package.',
      });
    }

    const activeUsers = await prisma.tenantUser.count({
      where: { tenantId: tenant.id, isDeleted: false, status: 'ACTIVE' },
    });
    if (seats < activeUsers) {
      return res.status(409).json({
        error: `${tenant.companyName} has ${activeUsers} active users. Renewing at ${seats} seats would block every new invitation.`,
        code: 'SEATS_BELOW_HEADCOUNT',
        activeUsers,
      });
    }

    // Default to the day the current term ends, so renewals leave no gap. A
    // perpetual term has no end, so a renewal of one starts today.
    const startsAt = data.startsAt ?? (current.endsAt ? new Date(current.endsAt) : new Date());
    const months = pkg?.termMonths ?? null;
    const endsAt = months ? addMonths(startsAt, months) : null;
    const state = subscriptionStateOf({ startsAt, endsAt, cancelledAt: null });

    let coupon = null;
    if (data.couponCode) {
      coupon = await prisma.coupon.findUnique({ where: { code: data.couponCode.toUpperCase() } });
      const problem = couponValidationError(coupon);
      if (problem) return res.status(400).json({ error: problem, code: 'COUPON_INVALID' });
    }

    const result = await withInvoiceNumber((invoiceNumber) => prisma.$transaction(async (tx) => {
      const renewed = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          packageId: pkg?.id ?? null,
          packageName: pkg?.name ?? current.packageName,
          seatCount: seats,
          state,
          startsAt,
          endsAt,
          renewedFromId: current.id,
          salesRepId: effectiveSalesRepId,
        },
        select: SUBSCRIPTION_SELECT,
      });

      // The old term is marked EXPIRED only if the new one has already begun;
      // a renewal booked ahead of time must not cut the current term short.
      if (state === 'ACTIVE') {
        await tx.subscription.update({
          where: { id: current.id },
          data: { state: 'EXPIRED' },
        });
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { licenseLimit: seats, planEndsAt: endsAt },
        });
      }

      const invoice = data.createInvoice
        ? await raiseInvoiceFor(tx, { tenant, subscription: renewed, quantity: seats, unitPrice: price, coupon, req, invoiceNumber })
        : null;

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.SUBSCRIPTION_RENEWED,
        targetType: 'SUBSCRIPTION',
        targetId: renewed.id,
        tenantId: tenant.id,
        beforeValue: {
          previousId: current.id, seatCount: current.seatCount, endsAt: current.endsAt,
        },
        afterValue: {
          packageName: renewed.packageName, seatCount: seats, startsAt, endsAt, state, salesRepId: effectiveSalesRepId,
        },
      });

      return { renewed, invoice };
    }));

    res.status(201).json({
      subscription: decorate(result.renewed),
      previousSubscriptionId: current.id,
      invoice: result.invoice
        ? { ...result.invoice, totalAmount: num(result.invoice.totalAmount), unitPrice: num(result.invoice.unitPrice) }
        : null,
    });
  } catch (err) {
    if (err?.code === 'P2002' && String(err?.meta?.target || '').includes('renewedFromId')) {
      return res.status(409).json({ error: 'This term has already been renewed.', code: 'ALREADY_RENEWED' });
    }
    if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message, code: err.code });
    next(err);
  }
}

/**
 * POST /platform/subscriptions/:id/cancel
 *
 * By default the term runs to its end date — a customer who has paid for the
 * year keeps the year. `immediate: true` ends it now, which is a decision the
 * operator has to make explicitly rather than a side effect of cancelling.
 *
 * Cancelling does NOT suspend the company or remove its users. Access is a
 * lifecycle decision and lives on Tenant Detail, where its consequences are
 * spelled out.
 */
export async function cancelSubscription(req, res, next) {
  try {
    const parsedParams = subscriptionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = subscriptionCancelSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { reason, immediate } = parsed.data;

    const sub = await prisma.subscription.findUnique({
      where: { id: parsedParams.data.id },
      select: {
        id: true, tenantId: true, packageName: true, state: true,
        endsAt: true, cancelledAt: true,
        tenant: { select: { companyName: true, planEndsAt: true } },
      },
    });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    if (sub.cancelledAt) {
      return res.status(409).json({ error: 'This term is already cancelled' });
    }

    const now = new Date();
    const cancelled = await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          state: 'CANCELLED',
          cancelledAt: now,
          cancelReason: reason,
          // Ending it now is what shortens the term; otherwise the paid-for
          // period is left exactly as it was.
          ...(immediate ? { endsAt: now } : {}),
        },
        select: SUBSCRIPTION_SELECT,
      });

      if (immediate) {
        await tx.tenant.update({ where: { id: sub.tenantId }, data: { planEndsAt: now } });
      }

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.SUBSCRIPTION_CANCELLED,
        targetType: 'SUBSCRIPTION',
        targetId: sub.id,
        tenantId: sub.tenantId,
        beforeValue: { state: sub.state, endsAt: sub.endsAt },
        afterValue: { state: 'CANCELLED', endsAt: updated.endsAt, immediate },
        reason,
      });

      return updated;
    });

    res.json({
      subscription: decorate(cancelled),
      note: immediate
        ? `The term ended today. ${sub.tenant.companyName} still has access — cancelling a term does not suspend a company. Change their lifecycle on the company page if that is what you want.`
        : `The term runs to ${sub.endsAt ? new Date(sub.endsAt).toISOString().slice(0, 10) : 'its original end date'} and will not renew.`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/subscriptions/renewal-experience
 *
 * Comprehensive renewal intelligence:
 * 1. Renewal pipeline & horizon (30d, 60d, 90d, expired, perpetual)
 * 2. Retention rate & renewal history counts
 * 3. BDM-managed renewal performance (coupons, discounts granted, revenue influenced)
 */
export async function getRenewalExperience(req, res, next) {
  try {
    const now = new Date();
    const d30 = new Date(now.getTime() + 30 * 86400000);
    const d60 = new Date(now.getTime() + 60 * 86400000);
    const d90 = new Date(now.getTime() + 90 * 86400000);

    const [
      activeCount,
      allTerms,
      renewedCount,
      expiredUnrenewedCount,
      bdmCoupons,
      couponRedemptions,
      salesReps,
    ] = await Promise.all([
      prisma.subscription.count({ where: { state: 'ACTIVE' } }),
      prisma.subscription.findMany({
        where: { state: { in: ['ACTIVE', 'EXPIRED'] } },
        select: {
          id: true,
          seatCount: true,
          state: true,
          endsAt: true,
          renewedFromId: true,
          salesRepId: true,
          package: { select: { unitPrice: true } },
          tenant: { select: { companyName: true } },
          salesRep: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.subscription.count({ where: { renewedFromId: { not: null } } }),
      prisma.subscription.count({
        where: {
          state: 'EXPIRED',
          renewedTo: null,
        },
      }),
      prisma.coupon.findMany({
        select: {
          id: true,
          code: true,
          bdmName: true,
          discountType: true,
          discountValue: true,
          active: true,
          timesUsed: true,
        },
      }),
      prisma.couponRedemption.findMany({
        select: {
          couponId: true,
          discountAmount: true,
          invoice: {
            select: {
              totalAmount: true,
              amountPaid: true,
              subscriptionId: true,
            },
          },
          coupon: {
            select: {
              id: true,
              code: true,
              bdmName: true,
            },
          },
        },
      }),
      prisma.tenantUser.findMany({
        where: { role: 'PLATFORM_SALES', isDeleted: false },
        select: { id: true, name: true, email: true },
      }),
    ]);

    // Calculate horizon cohorts and pipeline values
    let due30d = 0;
    let due60d = 0;
    let due90d = 0;
    let pipelineValue30d = 0;
    let pipelineValue60d = 0;
    let pipelineValue90d = 0;

    for (const t of allTerms) {
      if (t.state === 'ACTIVE' && t.endsAt) {
        const ends = new Date(t.endsAt);
        const estValue = t.seatCount * (t.package?.unitPrice ? num(t.package.unitPrice) : 3999) * 1.18;
        if (ends <= d30 && ends >= now) {
          due30d += 1;
          pipelineValue30d += estValue;
        }
        if (ends <= d60 && ends >= now) {
          due60d += 1;
          pipelineValue60d += estValue;
        }
        if (ends <= d90 && ends >= now) {
          due90d += 1;
          pipelineValue90d += estValue;
        }
      }
    }

    const totalResolved = renewedCount + expiredUnrenewedCount;
    const retentionRate = totalResolved > 0
      ? round2((renewedCount / totalResolved) * 100)
      : 100;

    // Aggregate BDM Performance on renewals and coupons
    const bdmMap = new Map();

    // Initialize from sales reps
    for (const rep of salesReps) {
      bdmMap.set(rep.name.trim(), {
        bdmName: rep.name.trim(),
        email: rep.email,
        salesRepId: rep.id,
        renewalsClosed: 0,
        discountsGranted: 0,
        revenueInfluenced: 0,
        revenueCollected: 0,
        coupons: [],
      });
    }

    // Include BDM names from coupons
    for (const c of bdmCoupons) {
      const name = (c.bdmName || 'Unassigned BDM').trim();
      if (!bdmMap.has(name)) {
        bdmMap.set(name, {
          bdmName: name,
          email: null,
          salesRepId: null,
          renewalsClosed: 0,
          discountsGranted: 0,
          revenueInfluenced: 0,
          revenueCollected: 0,
          coupons: [],
        });
      }
      const entry = bdmMap.get(name);
      if (!entry.coupons.includes(c.code)) entry.coupons.push(c.code);
    }

    // Count renewals attributed directly to sales reps
    for (const t of allTerms) {
      if (t.renewedFromId && t.salesRep?.name) {
        const name = t.salesRep.name.trim();
        if (bdmMap.has(name)) {
          bdmMap.get(name).renewalsClosed += 1;
        }
      }
    }

    // Aggregate coupon redemptions for each BDM
    let totalBdmDiscounts = 0;
    let totalRenewalRevenue = 0;

    for (const red of couponRedemptions) {
      const bdmName = (red.coupon?.bdmName || 'Unassigned BDM').trim();
      const disc = num(red.discountAmount);
      const totalAmt = red.invoice ? num(red.invoice.totalAmount) : 0;
      const paidAmt = red.invoice ? num(red.invoice.amountPaid) : 0;

      totalBdmDiscounts += disc;
      totalRenewalRevenue += totalAmt;

      if (bdmMap.has(bdmName)) {
        const b = bdmMap.get(bdmName);
        b.discountsGranted = round2(b.discountsGranted + disc);
        b.revenueInfluenced = round2(b.revenueInfluenced + totalAmt);
        b.revenueCollected = round2(b.revenueCollected + paidAmt);
      }
    }

    const bdmPerformanceList = Array.from(bdmMap.values())
      .map(b => ({
        ...b,
        discountsGranted: round2(b.discountsGranted),
        revenueInfluenced: round2(b.revenueInfluenced),
        revenueCollected: round2(b.revenueCollected),
      }))
      .sort((a, b) => b.revenueInfluenced - a.revenueInfluenced || b.renewalsClosed - a.renewalsClosed);

    res.json({
      pipeline: {
        activeSubscriptions: activeCount,
        due30d,
        due60d,
        due90d,
        pipelineValue30d: round2(pipelineValue30d),
        pipelineValue60d: round2(pipelineValue60d),
        pipelineValue90d: round2(pipelineValue90d),
        renewedTotal: renewedCount,
        expiredUnrenewed: expiredUnrenewedCount,
        retentionRate,
      },
      bdmSummary: {
        totalDiscountsGranted: round2(totalBdmDiscounts),
        totalRevenueInfluenced: round2(totalRenewalRevenue),
        activeBdmCoupons: bdmCoupons.filter(c => c.active).length,
        totalBdmTeamMembers: bdmPerformanceList.length,
        performers: bdmPerformanceList,
      },
      activeBdmCoupons: bdmCoupons.filter(c => c.active).map(c => ({
        id: c.id,
        code: c.code,
        bdmName: c.bdmName,
        discountType: c.discountType,
        discountValue: num(c.discountValue),
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/subscriptions/:id/calculate-renewal
 *
 * Automatic BDM Renewal Calculation Engine:
 * Previews live pricing, BDM discount deductions, GST, and net payable
 * before confirming renewal.
 */
export async function calculateRenewal(req, res, next) {
  try {
    const parsedParams = subscriptionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }

    const current = await prisma.subscription.findUnique({
      where: { id: parsedParams.data.id },
      select: {
        id: true,
        tenantId: true,
        packageId: true,
        packageName: true,
        seatCount: true,
        state: true,
        endsAt: true,
        package: { select: { id: true, name: true, active: true, seatCount: true, unitPrice: true, termMonths: true } },
        tenant: { select: { id: true, companyName: true, creditBalance: true } },
      },
    });

    if (!current) return res.status(404).json({ error: 'Subscription not found' });

    const { packageId, seatCount, unitPrice, couponCode } = req.body || {};

    const pkg = packageId
      ? await prisma.package.findUnique({ where: { id: packageId } })
      : current.package;

    const seats = Number(seatCount) || (packageId && pkg ? pkg.seatCount : current.seatCount);
    const price = unitPrice != null ? Number(unitPrice) : (pkg ? num(pkg.unitPrice) : 3999);

    let coupon = null;
    let couponError = null;
    if (couponCode && String(couponCode).trim()) {
      coupon = await prisma.coupon.findUnique({ where: { code: String(couponCode).trim().toUpperCase() } });
      if (!coupon) {
        couponError = 'Coupon not found';
      } else if (!coupon.active) {
        couponError = 'Coupon is inactive';
      } else if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
        couponError = 'Coupon has expired';
      } else if (coupon.usageLimit != null && coupon.timesUsed >= coupon.usageLimit) {
        couponError = 'Coupon usage limit reached';
      }
    }

    const validCoupon = coupon && !couponError ? coupon : null;
    const pricing = computePricing({
      quantity: seats,
      unitPrice: price,
      coupon: validCoupon,
      gstRate: 0.18,
    });

    const tenantCredit = num(current.tenant.creditBalance);
    const creditApplied = Math.min(tenantCredit, pricing.total);
    const netPayable = round2(Math.max(0, pricing.total - creditApplied));

    const startsAt = current.endsAt ? new Date(current.endsAt) : new Date();
    const months = pkg?.termMonths ?? 12;
    const endsAt = addMonths(startsAt, months);

    res.json({
      subscriptionId: current.id,
      companyName: current.tenant.companyName,
      package: {
        id: pkg?.id || null,
        name: pkg?.name || current.packageName,
        termMonths: months,
      },
      calculation: {
        seats,
        unitPrice: price,
        subtotal: pricing.subtotal,
        discountAmount: pricing.discountAmount,
        discountedSubtotal: pricing.discountedSubtotal,
        gstRate: 0.18,
        gstAmount: pricing.gstAmount,
        grossTotal: pricing.total,
        walletCreditAvailable: tenantCredit,
        walletCreditApplied: creditApplied,
        netPayable,
      },
      bdm: {
        bdmName: validCoupon?.bdmName || null,
        couponCode: validCoupon?.code || (couponCode ? String(couponCode).toUpperCase() : null),
        discountType: validCoupon?.discountType || null,
        discountValue: validCoupon ? num(validCoupon.discountValue) : null,
        couponValid: Boolean(validCoupon),
        couponError,
      },
      schedule: {
        startsAt,
        endsAt,
      },
    });
  } catch (err) {
    next(err);
  }
}
