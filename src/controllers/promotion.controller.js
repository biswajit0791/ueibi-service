import { prisma } from '../lib/prisma.js';
import {
  promotionSchema,
  promotionUpdateSchema,
  promotionIdParamSchema,
  eligiblePromotionQuerySchema,
} from '../validations/promotion.schema.js';
import {
  findEligiblePromotion,
  getPromotionStatus,
  getPromotionAnalytics,
  listEligiblePromotions,
  duplicatePromotion as duplicatePromoService,
  archivePromotion as archivePromoService,
} from '../services/promotion.service.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';

/**
 * GET /platform/promotions
 * Returns all promotional extension offers with live operational status.
 */
export async function listPromotions(req, res, next) {
  try {
    const { status, eligibility, includeArchived } = req.query || {};
    const promotions = await prisma.subscriptionPromotion.findMany({
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        _count: { select: { redemptions: true } },
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
    });

    const now = new Date();
    let items = promotions.map((p) => {
      const computedStatus = getPromotionStatus(p, now);
      return {
        ...p,
        status: computedStatus,
        totalRedemptions: p._count?.redemptions || 0,
      };
    });

    if (status && status !== 'ALL') {
      items = items.filter((p) => p.status === status.toUpperCase());
    } else if (includeArchived !== 'true') {
      // By default when viewing ALL without explicit ARCHIVED status, exclude archived
      items = items.filter((p) => !p.isArchived);
    }

    if (eligibility && eligibility !== 'ALL') {
      items = items.filter((p) => p.eligibility === eligibility.toUpperCase());
    }

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/promotions/eligible-offers
 * Returns all active matching promotional offers for live renewal calculator.
 */
export async function getEligibleOffers(req, res, next) {
  try {
    const { packageId, termMonths, seatCount, context, couponId, couponCode } = req.query || {};
    const items = await listEligiblePromotions({
      packageId: packageId || null,
      termMonths: termMonths ? Number(termMonths) : undefined,
      seatCount: seatCount ? Number(seatCount) : undefined,
      context: context || 'ALL',
      couponId: couponId || null,
      couponCode: couponCode || null,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/promotions/analytics
 * Returns overall promotion analytics, BDM performance, and redemption history.
 */
export async function getAnalytics(req, res, next) {
  try {
    const analytics = await getPromotionAnalytics();
    res.json(analytics);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/promotions/eligible
 * Resolves eligible promotional extension for a given package and duration.
 */
export async function getEligible(req, res, next) {
  try {
    const parsed = eligiblePromotionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.issues });
    }

    const { packageId, termMonths, context, code, promotionId } = parsed.data;
    const promotion = await findEligiblePromotion({
      packageId,
      termMonths,
      context,
      code,
      promotionId,
    });

    if (!promotion) {
      return res.json({ eligible: false, promotion: null });
    }

    res.json({
      eligible: true,
      promotion: {
        id: promotion.id,
        name: promotion.name,
        code: promotion.code,
        paidMonths: promotion.paidMonths,
        freeMonths: promotion.freeMonths,
        totalMonths: promotion.paidMonths + promotion.freeMonths,
        description: promotion.description,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/promotions/:id
 */
export async function getPromotion(req, res, next) {
  try {
    const parsedParams = promotionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid promotion ID' });
    }

    const promo = await prisma.subscriptionPromotion.findUnique({
      where: { id: parsedParams.data.id },
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
        redemptions: {
          take: 20,
          orderBy: { appliedAt: 'desc' },
          include: {
            tenant: { select: { id: true, companyName: true, tenantCode: true } },
            salesRep: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!promo) return res.status(404).json({ error: 'Promotion not found' });

    res.json({
      ...promo,
      status: getPromotionStatus(promo),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/promotions
 * Creates a new promotional extension offer.
 */
export async function createPromotion(req, res, next) {
  try {
    const parsed = promotionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const { couponIds = [], ...data } = parsed.data;

    // Check duplicate code
    if (data.code) {
      const existing = await prisma.subscriptionPromotion.findUnique({
        where: { code: data.code },
      });
      if (existing) {
        return res.status(409).json({ error: 'Promotion with this code already exists', code: 'CODE_EXISTS' });
      }
    }

    const created = await prisma.subscriptionPromotion.create({
      data: {
        ...data,
        coupons: couponIds.length > 0 ? {
          create: couponIds.map((cid) => ({ couponId: cid })),
        } : undefined,
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
    });

    await recordPlatformAction({
      req,
      action: 'PROMOTION_CREATED',
      targetType: 'PROMOTION',
      targetId: created.id,
      afterValue: {
        name: created.name,
        code: created.code,
        paidMonths: created.paidMonths,
        freeMonths: created.freeMonths,
        active: created.active,
        assignedCouponsCount: couponIds.length,
      },
    }).catch((err) => console.warn('[Promotion] audit log failed:', err.message));

    res.status(201).json({
      ...created,
      status: getPromotionStatus(created),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /platform/promotions/:id
 * Updates an existing promotion offer.
 */
export async function updatePromotion(req, res, next) {
  try {
    const parsedParams = promotionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid promotion ID' });
    }

    const parsed = promotionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const promo = await prisma.subscriptionPromotion.findUnique({
      where: { id: parsedParams.data.id },
    });
    if (!promo) return res.status(404).json({ error: 'Promotion not found' });

    const { couponIds, ...data } = parsed.data;
    if (data.code && data.code !== promo.code) {
      const existing = await prisma.subscriptionPromotion.findUnique({
        where: { code: data.code },
      });
      if (existing && existing.id !== promo.id) {
        return res.status(409).json({ error: 'Promotion with this code already exists', code: 'CODE_EXISTS' });
      }
    }

    if (Array.isArray(couponIds)) {
      await prisma.promotionCoupon.deleteMany({
        where: { promotionId: promo.id },
      });
      if (couponIds.length > 0) {
        await prisma.promotionCoupon.createMany({
          data: couponIds.map((cid) => ({
            promotionId: promo.id,
            couponId: cid,
          })),
        });
      }
    }

    const updated = await prisma.subscriptionPromotion.update({
      where: { id: promo.id },
      data,
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
    });

    await recordPlatformAction({
      req,
      action: 'PROMOTION_UPDATED',
      targetType: 'PROMOTION',
      targetId: updated.id,
      beforeValue: {
        name: promo.name,
        active: promo.active,
        paidMonths: promo.paidMonths,
        freeMonths: promo.freeMonths,
      },
      afterValue: {
        name: updated.name,
        active: updated.active,
        paidMonths: updated.paidMonths,
        freeMonths: updated.freeMonths,
      },
    }).catch((err) => console.warn('[Promotion] audit log failed:', err.message));

    res.json({
      ...updated,
      status: getPromotionStatus(updated),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /platform/promotions/:id
 */
export async function deletePromotion(req, res, next) {
  try {
    const parsedParams = promotionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid promotion ID' });
    }

    const promo = await prisma.subscriptionPromotion.findUnique({
      where: { id: parsedParams.data.id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!promo) return res.status(404).json({ error: 'Promotion not found' });

    // If redemptions exist, soft disable rather than cascade deleting historical redemptions
    if (promo._count.redemptions > 0) {
      const disabled = await prisma.subscriptionPromotion.update({
        where: { id: promo.id },
        data: { active: false },
      });
      return res.json({ message: 'Promotion archived (has past redemptions)', promotion: disabled });
    }

    await prisma.subscriptionPromotion.delete({
      where: { id: promo.id },
    });

    res.json({ message: 'Promotion deleted successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/promotions/:id/duplicate
 * Duplicates a promotion with cloned settings and a clean name/code.
 */
export async function duplicatePromotion(req, res, next) {
  try {
    const parsedParams = promotionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid promotion ID' });
    }

    const duplicated = await duplicatePromoService(parsedParams.data.id, req.user);

    await recordPlatformAction({
      req,
      action: 'PROMOTION_CREATED',
      targetType: 'PROMOTION',
      targetId: duplicated.id,
      afterValue: {
        name: duplicated.name,
        code: duplicated.code,
        sourceId: parsedParams.data.id,
      },
    }).catch(() => {});

    res.status(201).json({
      ...duplicated,
      status: getPromotionStatus(duplicated),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /platform/promotions/:id/archive
 * Archives a promotion and deactivates it.
 */
export async function archivePromotion(req, res, next) {
  try {
    const parsedParams = promotionIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid promotion ID' });
    }

    const archived = await archivePromoService(parsedParams.data.id, req.user);

    await recordPlatformAction({
      req,
      action: 'PROMOTION_UPDATED',
      targetType: 'PROMOTION',
      targetId: archived.id,
      afterValue: { isArchived: true, active: false },
    }).catch(() => {});

    res.json({
      ...archived,
      status: getPromotionStatus(archived),
    });
  } catch (err) {
    next(err);
  }
}

