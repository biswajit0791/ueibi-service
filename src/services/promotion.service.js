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
  if (promo.isArchived) return 'ARCHIVED';
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
 * @param {number} [params.seatCount] - e.g. 10
 * @param {string} [params.context] - 'ALL' | 'NEW_REGISTRATIONS' | 'RENEWALS'
 * @param {string} [params.code] - Specific promo code if entered
 * @param {string} [params.promotionId] - Specific promotion ID if selected
 */
/**
 * Validates whether a specific candidate promotion matches the given parameters,
 * enforcing strict coupon-level assignment and independent coupon architecture.
 */
export function isPromotionEligible({
  promo,
  packageId = null,
  termMonths = 12,
  seatCount = 1,
  context = 'ALL',
  coupon = null,
  code = null,
}) {
  // 1. Duration match (Buy X Months)
  if (promo.paidMonths !== termMonths) return false;

  // 2. Minimum seats requirement
  if (promo.minSeats != null && (Number(seatCount) || 1) < promo.minSeats) return false;

  // 3. Usage limit
  if (promo.usageLimit != null && promo.timesUsed >= promo.usageLimit) return false;

  // 4. Context (NEW_REGISTRATIONS vs RENEWALS)
  if (promo.eligibility !== 'ALL' && context !== 'ALL' && promo.eligibility !== context) return false;

  // 5. Package applicability
  if (!promo.applyToAllPackages && packageId && !promo.packageIds.includes(packageId)) return false;

  // 6. Strict Coupon-Level and Promo Code Matching
  const assignedCoupons = promo.coupons || [];
  const assignedCouponIds = assignedCoupons.map((c) => c.couponId);
  const hasAssignedCoupons = assignedCouponIds.length > 0;

  // If a specific promo code was entered
  if (code && String(code).trim()) {
    const cleanCode = String(code).trim().toUpperCase();
    if (promo.code && promo.code.toUpperCase() === cleanCode) {
      if (coupon && promo.allowCoupons === false) return false;
      return true;
    }
  }

  // If customer is renewing with a BDM coupon
  if (coupon) {
    // If promotion has disabled coupon stacking, reject promotion
    if (promo.allowCoupons === false) return false;

    // Strict Coupon Assignment:
    // If the promotion has assigned coupons, this specific coupon MUST be explicitly assigned!
    if (hasAssignedCoupons) {
      return assignedCouponIds.includes(coupon.id) || assignedCoupons.some((c) => c.coupon?.code === coupon.code);
    }

    // If the promotion has NO assigned coupons:
    // It only applies if explicitly enabled for no-coupon / general application AND has no promo code
    if (promo.code) {
      return false; // requires entering its unique promo code
    }
    return Boolean(promo.allowNoCoupon);
  }

  // If customer is renewing WITHOUT any coupon:
  // Can only apply if allowNoCoupon is explicitly enabled, OR if promo code was explicitly entered
  if (code && String(code).trim() && promo.code && promo.code.toUpperCase() === String(code).trim().toUpperCase()) {
    return true;
  }

  return Boolean(promo.allowNoCoupon);
}

/**
 * Resolves the best eligible promotional extension based on strict coupon assignment,
 * subscription duration, seat count, and priority rules.
 */
export async function findEligiblePromotion({
  packageId = null,
  termMonths = 12,
  seatCount = 1,
  context = 'ALL',
  code = null,
  coupon = null,
  couponId = null,
  couponCode = null,
  promotionId = null,
} = {}) {
  // If explicitly chosen "No promotion"
  if (promotionId && String(promotionId).toLowerCase() === 'none') {
    return null;
  }

  const now = new Date();

  // Resolve coupon if provided
  let resolvedCoupon = coupon || null;
  if (!resolvedCoupon) {
    if (couponId) {
      resolvedCoupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    } else if (couponCode && String(couponCode).trim()) {
      const cleanCode = String(couponCode).trim();
      resolvedCoupon = await prisma.coupon.findFirst({
        where: { code: { equals: cleanCode, mode: 'insensitive' } },
      });
    }
  }

  // 1. Direct lookup by ID
  if (promotionId) {
    const promo = await prisma.subscriptionPromotion.findUnique({
      where: { id: promotionId },
      include: {
        coupons: {
          include: {
            coupon: {
              select: { id: true, code: true, discountType: true, discountValue: true },
            },
          },
        },
      },
    });
    if (promo && promo.active && !promo.isArchived) {
      const status = getPromotionStatus(promo, now);
      if (status === 'ACTIVE') {
        const eligible = isPromotionEligible({
          promo,
          packageId,
          termMonths,
          seatCount,
          context,
          coupon: resolvedCoupon,
          code,
        });
        if (eligible) return promo;
      }
    }
    return null;
  }

  // 2. Direct lookup by Code
  if (code && String(code).trim()) {
    const cleanCode = String(code).trim().toUpperCase();
    const promo = await prisma.subscriptionPromotion.findUnique({
      where: { code: cleanCode },
      include: {
        coupons: {
          include: {
            coupon: {
              select: { id: true, code: true, discountType: true, discountValue: true },
            },
          },
        },
      },
    });
    if (promo && promo.active && !promo.isArchived) {
      const status = getPromotionStatus(promo, now);
      if (status === 'ACTIVE') {
        const eligible = isPromotionEligible({
          promo,
          packageId,
          termMonths,
          seatCount,
          context,
          coupon: resolvedCoupon,
          code: cleanCode,
        });
        if (eligible) return promo;
      }
    }
    return null;
  }

  // 3. Automatic Matching Engine by priority and free months
  const candidates = await prisma.subscriptionPromotion.findMany({
    where: {
      active: true,
      isArchived: false,
      startsAt: { lte: now },
      OR: [
        { expiresAt: null },
        { expiresAt: { gte: now } },
      ],
      paidMonths: termMonths || 12,
      minSeats: { lte: Number(seatCount) || 1 },
    },
    include: {
      coupons: {
        include: {
          coupon: {
            select: { id: true, code: true, discountType: true, discountValue: true },
          },
        },
      },
    },
    orderBy: [
      { priority: 'desc' },
      { freeMonths: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  for (const promo of candidates) {
    if (
      isPromotionEligible({
        promo,
        packageId,
        termMonths,
        seatCount,
        context,
        coupon: resolvedCoupon,
      })
    ) {
      return promo;
    }
  }

  return null;
}

/**
 * Returns a list of all active promotions eligible for the current renewal state,
 * taking into account whether a specific BDM coupon is entered.
 */
export async function listEligiblePromotions({
  packageId = null,
  termMonths = 12,
  seatCount = 1,
  context = 'ALL',
  couponId = null,
  couponCode = null,
} = {}) {
  const now = new Date();

  let coupon = null;
  if (couponId) {
    coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
  } else if (couponCode && String(couponCode).trim()) {
    coupon = await prisma.coupon.findUnique({ where: { code: String(couponCode).trim().toUpperCase() } });
  }

  const candidates = await prisma.subscriptionPromotion.findMany({
    where: {
      active: true,
      isArchived: false,
      startsAt: { lte: now },
      OR: [
        { expiresAt: null },
        { expiresAt: { gte: now } },
      ],
      paidMonths: termMonths || 12,
      minSeats: { lte: Number(seatCount) || 1 },
    },
    include: {
      coupons: {
        include: {
          coupon: {
            select: {
              id: true,
              code: true,
              discountType: true,
              discountValue: true,
              salesRep: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
    },
    orderBy: [
      { priority: 'desc' },
      { freeMonths: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  return candidates.filter((promo) =>
    isPromotionEligible({
      promo,
      packageId,
      termMonths: termMonths || 12,
      seatCount: Number(seatCount) || 1,
      context,
      coupon,
    })
  );
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
 * Saves an immutable snapshot of all term, pricing, and discount specifications.
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
    promotionName = null,
    promoCode = null,
    originalEndsAt = null,
    finalEndsAt = null,
    seatCount = 1,
    unitPrice = 0,
    couponCode = null,
    couponDiscount = 0,
    gstAmount = 0,
    netPayable = 0,
    paidMonths,
    freeMonths,
    totalMonths,
    paidRevenue = 0,
  }
) {
  if (!promotionId || !subscriptionId || !tenantId) return null;

  // Resolve promo details if not explicitly passed
  let pName = promotionName;
  let pCode = promoCode;
  if (!pName) {
    const promo = await tx.subscriptionPromotion.findUnique({
      where: { id: promotionId },
      select: { name: true, code: true },
    });
    if (promo) {
      pName = promo.name;
      pCode = promo.code;
    }
  }

  // 1. Create immutable audit redemption row with full snapshot
  const redemption = await tx.promotionRedemption.create({
    data: {
      promotionId,
      subscriptionId,
      tenantId,
      salesRepId,
      promotionName: pName,
      promoCode: pCode,
      originalEndsAt: originalEndsAt ? new Date(originalEndsAt) : null,
      finalEndsAt: finalEndsAt ? new Date(finalEndsAt) : null,
      seatCount: Number(seatCount) || 1,
      unitPrice: num(unitPrice),
      couponCode: couponCode ? String(couponCode).toUpperCase() : null,
      couponDiscount: num(couponDiscount),
      gstAmount: num(gstAmount),
      netPayable: num(netPayable),
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
 * Duplicates a promotional offer with clean cloned settings and unique code.
 */
export async function duplicatePromotion(id, user = null) {
  const source = await prisma.subscriptionPromotion.findUnique({
    where: { id },
    include: { coupons: true },
  });
  if (!source) throw new Error('Promotion not found');

  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const newCode = source.code ? `${source.code}_COPY_${randomSuffix}` : null;
  const newName = `Copy of ${source.name}`;

  return prisma.subscriptionPromotion.create({
    data: {
      name: newName,
      description: source.description,
      badgeText: source.badgeText,
      code: newCode,
      paidMonths: source.paidMonths,
      freeMonths: source.freeMonths,
      minSeats: source.minSeats,
      priority: source.priority,
      allowCoupons: source.allowCoupons,
      allowNoCoupon: source.allowNoCoupon,
      active: true,
      isArchived: false,
      startsAt: new Date(),
      expiresAt: source.expiresAt,
      applyToAllPackages: source.applyToAllPackages,
      packageIds: source.packageIds,
      eligibility: source.eligibility,
      usageLimit: source.usageLimit,
      timesUsed: 0,
      createdById: user?.id || null,
      updatedById: user?.id || null,
      coupons: (source.coupons || []).length > 0 ? {
        create: source.coupons.map((c) => ({ couponId: c.couponId })),
      } : undefined,
    },
    include: {
      coupons: {
        include: {
          coupon: {
            select: { id: true, code: true, discountType: true, discountValue: true },
          },
        },
      },
    },
  });
}

/**
 * Archives a promotional offer so it is removed from active matching and drawers.
 */
export async function archivePromotion(id, user = null) {
  const promo = await prisma.subscriptionPromotion.findUnique({ where: { id } });
  if (!promo) throw new Error('Promotion not found');

  return prisma.subscriptionPromotion.update({
    where: { id },
    data: {
      isArchived: true,
      active: false,
      updatedById: user?.id || null,
    },
  });
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
