/**
 * package.controller.js — Plans & Packages.
 *
 * A package is a named, sellable thing: price per seat, seat count and term
 * length. It is a template, not a contract — selling one copies its numbers onto
 * a Subscription and an Invoice, and from that moment the sale is independent of
 * the package. That is what lets a price be changed without rewriting history.
 *
 * PLATFORM_OWNER only, like everything else in the operator console.
 */
import { prisma } from '../lib/prisma.js';
import {
  packageCreateSchema,
  packageUpdateSchema,
  packageQuerySchema,
  packageIdParamSchema,
} from '../validations/billing.schema.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';
import { computePricing } from '../lib/pricing.js';
import { env } from '../config/env.js';

const num = (v) => (v == null ? null : Number(v));

/**
 * Packages are quoted, not just listed: showing the headline price without GST
 * invites an operator to quote the wrong number to a customer.
 */
function decorate(pkg, counts = {}) {
  const priced = computePricing({
    quantity: pkg.seatCount,
    unitPrice: num(pkg.unitPrice),
    coupon: null,
    gstRate: Number(env.gstRate ?? 0.18),
  });
  return {
    ...pkg,
    unitPrice: num(pkg.unitPrice),
    subtotal: priced.subtotal,
    gstRate: priced.gstRate,
    gstAmount: priced.gstAmount,
    totalPrice: priced.total,
    subscriptionCount: counts.subscriptions ?? 0,
    activeSubscriptionCount: counts.active ?? 0,
  };
}

/** GET /platform/packages */
export async function listPackages(req, res, next) {
  try {
    const parsed = packageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { active, search } = parsed.data;

    const where = {
      ...(active === 'true' ? { active: true } : active === 'false' ? { active: false } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };

    const packages = await prisma.package.findMany({
      where,
      orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { subscriptions: true } } },
    });

    // How many terms are live per package, in one query rather than one each.
    const activeRows = packages.length
      ? await prisma.subscription.groupBy({
          by: ['packageId'],
          where: { packageId: { in: packages.map((p) => p.id) }, state: 'ACTIVE' },
          _count: { _all: true },
        })
      : [];
    const activeBy = Object.fromEntries(activeRows.map((r) => [r.packageId, r._count._all]));

    res.json({
      items: packages.map(({ _count, ...p }) => decorate(p, {
        subscriptions: _count.subscriptions,
        active: activeBy[p.id] || 0,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/packages/:id */
export async function getPackage(req, res, next) {
  try {
    const parsed = packageIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }
    const pkg = await prisma.package.findUnique({
      where: { id: parsed.data.id },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    const active = await prisma.subscription.count({ where: { packageId: pkg.id, state: 'ACTIVE' } });
    const { _count, ...rest } = pkg;
    res.json({ package: decorate(rest, { subscriptions: _count.subscriptions, active }) });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/packages */
export async function createPackage(req, res, next) {
  try {
    const parsed = packageCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;

    const pkg = await prisma.package.create({
      data: {
        ...data,
        description: data.description ?? null,
        // A one-time licence is perpetual, so it carries no term length whatever
        // the caller sent.
        termMonths: data.interval === 'ONE_TIME' ? null : data.termMonths,
      },
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.PACKAGE_CREATED,
      targetType: 'PACKAGE',
      targetId: pkg.id,
      afterValue: {
        name: pkg.name, seatCount: pkg.seatCount,
        unitPrice: String(pkg.unitPrice), interval: pkg.interval, termMonths: pkg.termMonths,
      },
    }).catch((err) => console.warn('[Package] audit write failed:', err.message));

    res.status(201).json({ package: decorate(pkg) });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /platform/packages/:id
 *
 * Editing a package does NOT touch any subscription or invoice already sold from
 * it — those carry their own snapshot of name, seats and price. The response
 * says so when terms exist, because "I changed the price" and "I changed what
 * my customers pay" are different things and the operator must not confuse them.
 */
export async function updatePackage(req, res, next) {
  try {
    const parsedParams = packageIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = packageUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const before = await prisma.package.findUnique({ where: { id: parsedParams.data.id } });
    if (!before) return res.status(404).json({ error: 'Package not found' });

    const data = { ...parsed.data };
    const interval = data.interval ?? before.interval;
    if (interval === 'ONE_TIME') data.termMonths = null;
    if (interval !== 'ONE_TIME' && (data.termMonths ?? before.termMonths) == null) {
      return res.status(400).json({
        error: 'A package with a billing interval needs a term length in months',
      });
    }

    const pkg = await prisma.package.update({ where: { id: before.id }, data });
    const existingTerms = await prisma.subscription.count({ where: { packageId: pkg.id } });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.PACKAGE_UPDATED,
      targetType: 'PACKAGE',
      targetId: pkg.id,
      beforeValue: { name: before.name, seatCount: before.seatCount, unitPrice: String(before.unitPrice), active: before.active },
      afterValue: { name: pkg.name, seatCount: pkg.seatCount, unitPrice: String(pkg.unitPrice), active: pkg.active },
    }).catch((err) => console.warn('[Package] audit write failed:', err.message));

    res.json({
      package: decorate(pkg),
      existingTerms,
      note: existingTerms > 0
        ? `${existingTerms} term(s) were already sold from this package. They keep the price and seat count they were sold at — only future sales use the new figures.`
        : null,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /platform/packages/:id — permanent.
 *
 * Refused once anything has been sold from it, for the same reason a used coupon
 * cannot be deleted: Subscription.packageId is an optional relation, so removing
 * the row would silently null the link on real contracts. A package that has
 * been sold is deactivated instead, which stops it being offered while leaving
 * the history intact.
 */
export async function deletePackage(req, res, next) {
  try {
    const parsed = packageIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const pkg = await prisma.package.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, name: true, seatCount: true, unitPrice: true, active: true },
    });
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    const sold = await prisma.subscription.count({ where: { packageId: pkg.id } });
    if (sold > 0) {
      return res.status(409).json({
        error: `${pkg.name} has been sold to ${sold} company(s). Deleting it would break the link on those contracts. Deactivate it instead so it can no longer be sold.`,
        code: 'PACKAGE_IN_USE',
      });
    }

    await prisma.package.delete({ where: { id: pkg.id } });
    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.PACKAGE_DELETED,
      targetType: 'PACKAGE',
      targetId: pkg.id,
      beforeValue: { name: pkg.name, seatCount: pkg.seatCount, unitPrice: String(pkg.unitPrice), active: pkg.active },
    }).catch((err) => console.warn('[Package] audit write failed:', err.message));

    res.json({ deleted: true, name: pkg.name });
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Package not found' });
    next(err);
  }
}
