/**
 * promotion.service.js
 *
 * Promotional Subscription Extension Engine (Buy X Get Y Months Free).
 * Handles offer eligibility resolution, extension calculations, atomic
 * redemptions, and performance/conversion analytics.
 */
import { prisma } from '../lib/prisma.js';
import { addMonths, num, round2 } from './billing.service.js';

/**
 * Derives current operational status of a promotional offer.
 */
export function getPromotionStatus(promo, now = new Date()) {
  if (!promo.active) return 'DISABLED';
  if (promo.startsAt && new Date(promo.startsAt) > now) return 'UPCOMING';
  if (promo.expiresAt && new Date(promo.expiresAt) < now) return 'EXPIRED';
  if (promo.usageLimit != null && promo.timesUsed >= promo.usageLimit) return 'LIMIT_REACHED';
  return 'ACTIVE';
}

/**
 * Finds an eligible promotional offer for a purchase or renewal.
 *
 * @param {Object} params
 * @param {string} [params.packageId]
 * @param {number} [params.termMonths] - e.g. 12
 * @param {string} [params.context] - 'ALL' | 'NEW_REGISTRATIONS' | 'RENEWALS'
 * @param {string} [params.code] - Specific promo code if entered
 * @param {string} [params.promotionId] - Specific promotion ID if selected
 */
export async function findEligiblePromotion({
  packageId = null,
  termMonths = 12,
  context = 'ALL',
  code = null,
  promotionId = null,
} = {}) {
  const now = new Date();

  // 1. Direct lookup by ID
  if (promotionId) {
    const promo = await prisma.subscriptionPromotion.findUnique({
      where: { id: promotionId },
    });
    if (promo && promo.active) {
      const status = getPromotionStatus(promo, now);
      if (status === 'ACTIVE') return promo;
    }
    return null;
  }

  // 2. Direct lookup by Code
  if (code && String(code).trim()) {
    const cleanCode = String(code).trim().toUpperCase();
    const promo = await prisma.subscriptionPromotion.findUnique({
      where: { code: cleanCode },
    });
    if (promo && promo.active) {
      const status = getPromotionStatus(promo, now);
      if (status === 'ACTIVE') {
        // Verify eligibility criteria
        if (promo.eligibility !== 'ALL' && context !== 'ALL' && promo.eligibility !== context) {
          return null;
        }
        if (!promo.applyToAllPackages && packageId && !promo.packageIds.includes(packageId)) {
          return null;
        }
        return promo;
      }
    }
    return null;
  }

  // 3. Automatic Matching Engine
  // Find all active promotions that match the duration and context
  const candidates = await prisma.subscriptionPromotion.findMany({
    where: {
      active: true,
      startsAt: { lte: now },
      OR: [
        { expiresAt: null },
        { expiresAt: { gte: now } },
      ],
      paidMonths: termMonths || 12,
    },
    orderBy: [
      { freeMonths: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  for (const promo of candidates) {
    // Check usage limit
    if (promo.usageLimit != null && promo.timesUsed >= promo.usageLimit) {
      continue;
    }

    // Check context (NEW_REGISTRATIONS vs RENEWALS)
    if (promo.eligibility !== 'ALL' && context !== 'ALL' && promo.eligibility !== context) {
      continue;
    }

    // Check package applicability
    if (!promo.applyToAllPackages && packageId && !promo.packageIds.includes(packageId)) {
      continue;
    }

    return promo;
  }

  return null;
}

/**
 * Calculates extended subscription term dates without altering paid amounts.
 *
 * @param {Object} params
 * @param {Date|string} params.startsAt - Term commencement date
 * @param {number} [params.termMonths=12] - Standard paid duration
 * @param {Object} [params.promotion] - Resolved SubscriptionPromotion
 */
export function calculateSubscriptionExtension({
  startsAt = new Date(),
  termMonths = 12,
  promotion = null,
} = {}) {
  const startDate = new Date(startsAt);
  const paidMonths = promotion ? promotion.paidMonths : (termMonths || 12);
  const freeMonths = promotion ? promotion.freeMonths : 0;
  const totalMonths = paidMonths + freeMonths;

  // Paid expiry date: Commencement + paid months (e.g. 12 months)
  const paidEndsAt = paidMonths ? addMonths(startDate, paidMonths) : null;

  // Final expiry date: Commencement + total duration (e.g. 14 months)
  const finalEndsAt = totalMonths ? addMonths(startDate, totalMonths) : paidEndsAt;

  return {
    startsAt: startDate,
    paidEndsAt,
    endsAt: finalEndsAt,
    paidDurationMonths: paidMonths,
    freeDurationMonths: freeMonths,
    totalDurationMonths: totalMonths,
    promotion: promotion
      ? {
          id: promotion.id,
          name: promotion.name,
          code: promotion.code,
          paidMonths: promotion.paidMonths,
          freeMonths: promotion.freeMonths,
          totalMonths,
          description: promotion.description,
        }
      : null,
  };
}

/**
 * Atomically records promotion redemption and increments usage counter.
 *
 * @param {Object} tx - Active Prisma transaction client
 * @param {Object} params
 */
export async function recordPromotionRedemption(
  tx,
  {
    promotionId,
    subscriptionId,
    tenantId,
    salesRepId = null,
    paidMonths,
    freeMonths,
    totalMonths,
    paidRevenue = 0,
  }
) {
  if (!promotionId || !subscriptionId || !tenantId) return null;

  // 1. Create immutable audit redemption row
  const redemption = await tx.promotionRedemption.create({
    data: {
      promotionId,
      subscriptionId,
      tenantId,
      salesRepId,
      paidMonths: Number(paidMonths) || 12,
      freeMonths: Number(freeMonths) || 0,
      totalMonths: Number(totalMonths) || (paidMonths + freeMonths),
      paidRevenue: num(paidRevenue),
    },
  });

  // 2. Atomically increment promotion usage count
  await tx.subscriptionPromotion.update({
    where: { id: promotionId },
    data: {
      timesUsed: { increment: 1 },
    },
  });

  return redemption;
}

/**
 * Returns comprehensive analytics & reporting metrics for promotions.
 */
export async function getPromotionAnalytics() {
  const now = new Date();

  // 1. Fetch all promotions
  const promotions = await prisma.subscriptionPromotion.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      redemptions: {
        select: {
          id: true,
          tenantId: true,
          salesRepId: true,
          freeMonths: true,
          paidRevenue: true,
          appliedAt: true,
        },
      },
    },
  });

  // 2. Fetch all redemptions with details
  const allRedemptions = await prisma.promotionRedemption.findMany({
    include: {
      tenant: { select: { id: true, companyName: true, tenantCode: true } },
      salesRep: { select: { id: true, name: true, email: true, designation: true } },
      promotion: { select: { id: true, name: true, code: true } },
      subscription: { select: { id: true, packageName: true, startsAt: true, endsAt: true, state: true } },
    },
    orderBy: { appliedAt: 'desc' },
  });

  // Aggregate KPI metrics
  const uniqueTenants = new Set(allRedemptions.map((r) => r.tenantId));
  const totalCompaniesReceivingFreeMonths = uniqueTenants.size;
  const totalFreeMonthsGranted = allRedemptions.reduce((acc, r) => acc + (r.freeMonths || 0), 0);
  const totalPaidRevenue = round2(allRedemptions.reduce((acc, r) => acc + num(r.paidRevenue), 0));

  // Promotion-wise performance summary
  const promotionStats = promotions.map((p) => {
    const pRedemptions = p.redemptions || [];
    const pUniqueTenants = new Set(pRedemptions.map((r) => r.tenantId));
    const pFreeMonths = pRedemptions.reduce((acc, r) => acc + (r.freeMonths || 0), 0);
    const pRevenue = round2(pRedemptions.reduce((acc, r) => acc + num(r.paidRevenue), 0));
    const status = getPromotionStatus(p, now);

    return {
      id: p.id,
      name: p.name,
      code: p.code,
      description: p.description,
      paidMonths: p.paidMonths,
      freeMonths: p.freeMonths,
      totalMonths: p.paidMonths + p.freeMonths,
      active: p.active,
      status,
      startsAt: p.startsAt,
      expiresAt: p.expiresAt,
      applyToAllPackages: p.applyToAllPackages,
      packageIds: p.packageIds,
      eligibility: p.eligibility,
      usageLimit: p.usageLimit,
      timesUsed: p.timesUsed,
      companiesCount: pUniqueTenants.size,
      totalFreeMonthsGranted: pFreeMonths,
      totalPaidRevenue: pRevenue,
      createdAt: p.createdAt,
    };
  });

  // BDM-wise promotional subscription conversions
  const bdmMap = new Map();
  for (const r of allRedemptions) {
    const sId = r.salesRepId || 'UNASSIGNED';
    if (!bdmMap.has(sId)) {
      bdmMap.set(sId, {
        salesRepId: r.salesRepId,
        salesRepName: r.salesRep?.name || 'Direct / Online Signup',
        bdmName: r.salesRep?.name || 'Direct / Online Signup',
        salesRepEmail: r.salesRep?.email || null,
        email: r.salesRep?.email || null,
        designation: r.salesRep?.designation || 'Sales',
        conversionsCount: 0,
        deals: 0,
        totalFreeMonthsGiven: 0,
        freeMonths: 0,
        totalRevenueClosed: 0,
        revenueInfluenced: 0,
        recentConversions: [],
      });
    }
    const entry = bdmMap.get(sId);
    entry.conversionsCount += 1;
    entry.deals += 1;
    entry.totalFreeMonthsGiven += (r.freeMonths || 0);
    entry.freeMonths += (r.freeMonths || 0);
    entry.totalRevenueClosed = round2(entry.totalRevenueClosed + num(r.paidRevenue));
    entry.revenueInfluenced = entry.totalRevenueClosed;
    if (entry.recentConversions.length < 5) {
      entry.recentConversions.push({
        id: r.id,
        companyName: r.tenant?.companyName || 'Company',
        promotionName: r.promotion?.name,
        freeMonths: r.freeMonths,
        paidRevenue: num(r.paidRevenue),
        appliedAt: r.appliedAt,
      });
    }
  }

  const bdmConversions = Array.from(bdmMap.values()).sort(
    (a, b) => b.totalRevenueClosed - a.totalRevenueClosed || b.conversionsCount - a.conversionsCount
  );

  return {
    totalCompaniesWithFreeMonths: totalCompaniesReceivingFreeMonths,
    totalCompaniesReceivingFreeMonths,
    totalFreeMonthsGranted,
    totalPaidRevenue,
    kpis: {
      totalCompaniesReceivingFreeMonths,
      totalFreeMonthsGranted,
      totalPaidRevenue,
      activePromotionsCount: promotionStats.filter((p) => p.status === 'ACTIVE').length,
      totalPromotionsCount: promotions.length,
      totalRedemptionsCount: allRedemptions.length,
    },
    promotions: promotionStats,
    bdmConversions,
    recentRedemptions: allRedemptions.slice(0, 15).map((r) => ({
      id: r.id,
      companyName: r.tenant?.companyName,
      tenantCode: r.tenant?.tenantCode,
      promotionName: r.promotion?.name,
      promotionCode: r.promotion?.code,
      promoCode: r.promotion?.code,
      salesRepName: r.salesRep?.name || 'Direct / Online',
      bdmName: r.salesRep?.name || 'Direct / Online',
      paidMonths: r.paidMonths,
      freeMonths: r.freeMonths,
      totalMonths: r.totalMonths,
      paidRevenue: num(r.paidRevenue),
      subscriptionState: r.subscription?.state,
      appliedAt: r.appliedAt,
    })),
  };
}
