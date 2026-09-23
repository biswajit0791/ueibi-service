import { prisma } from '../lib/prisma.js';
import { couponSchema, couponIdParamSchema, listCouponsQuerySchema } from '../validations/coupon.schema.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';

export async function list(req, res, next) {
  try {
    const parsedQuery = listCouponsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { active, search } = parsedQuery.data;
    const where = {};
    if (active === 'true') where.active = true;
    if (active === 'false') where.active = false;
    if (search) where.code = { contains: String(search).toUpperCase() };

    const items = await prisma.coupon.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const parsed = couponSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const coupon = await prisma.coupon.create({ data: parsed.data });
    // Coupons move money, so who issued one and when is worth recording.
    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.COUPON_CREATED,
      targetType: 'COUPON',
      targetId: coupon.id,
      afterValue: { code: coupon.code, discountType: coupon.discountType, discountValue: String(coupon.discountValue) },
    }).catch((err) => console.warn('[Coupon] audit write failed:', err.message));
    res.status(201).json(coupon);
  } catch (err) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Coupon code already exists' });
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const parsedParams = couponIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid coupon ID parameter', details: parsedParams.error.issues });
    }
    const coupon = await prisma.coupon.findUnique({ where: { id: parsedParams.data.id } });
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
    res.json(coupon);
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const parsedParams = couponIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid coupon ID parameter', details: parsedParams.error.issues });
    }
    const parsed = couponSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const before = await prisma.coupon.findUnique({ where: { id: parsedParams.data.id } });
    const coupon = await prisma.coupon.update({ where: { id: parsedParams.data.id }, data: parsed.data });
    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.COUPON_UPDATED,
      targetType: 'COUPON',
      targetId: coupon.id,
      beforeValue: before ? { code: before.code, discountValue: String(before.discountValue), active: before.active } : null,
      afterValue: { code: coupon.code, discountValue: String(coupon.discountValue), active: coupon.active },
    }).catch((err) => console.warn('[Coupon] audit write failed:', err.message));
    res.json(coupon);
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Coupon not found' });
    next(err);
  }
}

/**
 * DELETE /admin/coupons/:id/permanent — remove a coupon outright.
 *
 * For a coupon created by mistake, which the soft delete below cannot clear off
 * the screen. It is refused the moment a coupon has been attached to a
 * registration: CompanyRegistration.couponId is an optional relation, so
 * deleting the row would silently null the link on a real invoice and destroy
 * the record of which coupon produced that discount. Once used, the only
 * correct action is to deactivate.
 */
export async function removePermanently(req, res, next) {
  try {
    const parsedParams = couponIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid coupon ID parameter', details: parsedParams.error.issues });
    }

    const coupon = await prisma.coupon.findUnique({
      where: { id: parsedParams.data.id },
      select: { id: true, code: true, discountType: true, discountValue: true, timesUsed: true, active: true },
    });
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });

    // timesUsed is the counter; the registration count is the truth. Check both,
    // because a counter can drift and an orphaned invoice cannot be undone.
    const attached = await prisma.companyRegistration.count({ where: { couponId: coupon.id } });
    if (attached > 0 || coupon.timesUsed > 0) {
      return res.status(409).json({
        error: `${coupon.code} has been used on ${attached || coupon.timesUsed} registration(s). Deleting it would erase which discount they were given. Deactivate it instead so it cannot be used again.`,
        code: 'COUPON_IN_USE',
      });
    }

    await prisma.coupon.delete({ where: { id: coupon.id } });
    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.COUPON_DELETED,
      targetType: 'COUPON',
      targetId: coupon.id,
      beforeValue: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: String(coupon.discountValue),
        active: coupon.active,
      },
    }).catch((err) => console.warn('[Coupon] audit write failed:', err.message));

    res.json({ deleted: true, code: coupon.code });
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Coupon not found' });
    next(err);
  }
}

export async function remove(req, res, next) {
  try {
    const parsedParams = couponIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid coupon ID parameter', details: parsedParams.error.issues });
    }
    // A soft delete: the row stays so historical redemptions still resolve.
    const coupon = await prisma.coupon.update({ where: { id: parsedParams.data.id }, data: { active: false } });
    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.COUPON_DEACTIVATED,
      targetType: 'COUPON',
      targetId: coupon.id,
      beforeValue: { active: true },
      afterValue: { active: false, code: coupon.code },
    }).catch((err) => console.warn('[Coupon] audit write failed:', err.message));
    res.json(coupon);
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Coupon not found' });
    next(err);
  }
}
