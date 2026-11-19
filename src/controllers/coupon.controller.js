import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { couponSchema, couponIdParamSchema, listCouponsQuerySchema } from '../validations/coupon.schema.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function addCalendarMonths(date, months) {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  const targetYear = d.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const day = d.getDate();
  const result = new Date(targetYear, normalizedMonth, day);
  if (result.getMonth() !== normalizedMonth) {
    result.setDate(0);
  }
  return result;
}

export async function list(req, res, next) {
  try {
    const parsedQuery = listCouponsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { active, search, filter, salesRepId, company, startDate, endDate } = parsedQuery.data;
    const isSales = req.user?.role === 'PLATFORM_SALES';

    const where = {};
    if (active === 'true') where.active = true;
    if (active === 'false') where.active = false;

    // Scoped permissions:
    // If user is PLATFORM_SALES, default to their coupons unless specifically querying
    if (isSales) {
      where.salesRepId = req.user.id;
    } else if (salesRepId) {
      where.salesRepId = salesRepId;
    }

    if (search) {
      const q = String(search).trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { offerReference: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { bdmName: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { industry: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (company) {
      where.companyName = { contains: String(company).trim(), mode: 'insensitive' };
    }

    if (startDate) {
      where.createdAt = { ...(where.createdAt || {}), gte: new Date(startDate) };
    }
    if (endDate) {
      const endD = new Date(endDate);
      endD.setHours(23, 59, 59, 999);
      where.createdAt = { ...(where.createdAt || {}), lte: endD };
    }

    // Filter tabs: ALL, MY, UNUSED, USED, EXPIRED
    const now = new Date();
    if (filter === 'MY' && req.user?.id) {
      where.salesRepId = req.user.id;
    } else if (filter === 'UNUSED') {
      where.status = { not: 'USED' };
      where.timesUsed = 0;
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gte: now } },
      ];
    } else if (filter === 'USED') {
      where.OR = [
        { status: 'USED' },
        { timesUsed: { gt: 0 } },
      ];
    } else if (filter === 'EXPIRED') {
      where.status = { not: 'USED' };
      where.timesUsed = 0;
      where.expiresAt = { lt: now };
    }

    const items = await prisma.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        salesRep: {
          select: { id: true, name: true, email: true, designation: true, status: true, isDeleted: true },
        },
      },
    });

    // Derive live computed status for every item
    const enriched = items.map((c) => {
      let computedStatus = 'UNUSED';
      if (c.status === 'USED' || c.timesUsed > 0) {
        computedStatus = 'USED';
      } else if (c.expiresAt && new Date(c.expiresAt) < now) {
        computedStatus = 'EXPIRED';
      } else if (!c.active) {
        computedStatus = 'INACTIVE';
      }
      return {
        ...c,
        computedStatus,
      };
    });

    res.json({ items: enriched });
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
    const data = { ...parsed.data };
    const isSales = req.user?.role === 'PLATFORM_SALES';

    // 1. Authenticated BDM attribution:
    // If user is PLATFORM_SALES, derive BDM identity strictly from session
    if (isSales) {
      data.salesRepId = req.user.id;
      data.bdmName = req.user.name || 'Sales Representative';
    } else if (data.salesRepId) {
      const rep = await prisma.tenantUser.findUnique({
        where: { id: data.salesRepId },
        select: { id: true, name: true, email: true, role: true, status: true, isDeleted: true },
      });
      if (!rep || rep.role !== 'PLATFORM_SALES') {
        return res.status(400).json({ error: 'Assigned user must be an active Sales Team member', code: 'INVALID_SALES_REP' });
      }
      if (rep.status !== 'ACTIVE' || rep.isDeleted) {
        return res.status(400).json({ error: 'Inactive Sales Team members cannot receive coupon assignments', code: 'STAFF_INACTIVE' });
      }
      data.bdmName = rep.name;
    } else if (data.salesRepId === null) {
      data.bdmName = null;
    } else if (!data.salesRepId && req.user?.name) {
      data.bdmName = req.user.name;
    }

    // 2. Company Offer Automatic Calculations:
    if (data.companyName) {
      const totalLicenses = Math.max(1, parseInt(data.totalLicenses) || 1);
      const perLicenseCost = Math.max(0, parseFloat(data.perLicenseCost) || 3999);
      const licenseAmount = round2(totalLicenses * perLicenseCost);
      const discountPercent = Math.min(100, Math.max(0, parseFloat(data.discountPercent) || 0));
      const discountAmount = round2((licenseAmount * discountPercent) / 100);
      const finalAmount = round2(licenseAmount - discountAmount);

      data.totalLicenses = totalLicenses;
      data.perLicenseCost = perLicenseCost;
      data.licenseAmount = licenseAmount;
      data.discountPercent = discountPercent;
      data.discountValue = discountPercent;
      data.discountType = 'PERCENT';
      data.finalAmount = finalAmount;
      data.usageLimit = 1;
      data.status = 'UNUSED';

      const promoMonths = Math.max(0, parseInt(data.promoMonths) || 0);
      data.promoMonths = promoMonths;

      const startDate = data.startDate ? new Date(data.startDate) : new Date();
      data.startDate = startDate;
      // End Date = Start Date + 12 Months + Additional Promotional Months
      const endDate = addCalendarMonths(startDate, 12 + promoMonths);
      data.endDate = endDate;
      data.expiresAt = endDate;

      if (!data.offerReference) {
        data.offerReference = 'OFFER-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      }
      if (!data.code) {
        data.code = data.offerReference;
      }
    } else {
      // Standard generic coupon
      if (!data.code) {
        return res.status(400).json({ error: 'Coupon code is required' });
      }
      data.code = data.code.toUpperCase();
      if (!data.discountValue || data.discountValue <= 0) {
        return res.status(400).json({ error: 'Discount value must be greater than zero' });
      }
    }

    const coupon = await prisma.coupon.create({
      data,
      include: {
        salesRep: {
          select: { id: true, name: true, email: true, designation: true, status: true, isDeleted: true },
        },
      },
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.COUPON_CREATED,
      targetType: 'COUPON',
      targetId: coupon.id,
      afterValue: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: String(coupon.discountValue),
        salesRepId: coupon.salesRepId,
        bdmName: coupon.bdmName,
        companyName: coupon.companyName,
        offerReference: coupon.offerReference,
      },
    }).catch((err) => console.warn('[Coupon] audit write failed:', err.message));

    res.status(201).json({
      ...coupon,
      computedStatus: 'UNUSED',
    });
  } catch (err) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Coupon code or offer reference already exists' });
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const parsedParams = couponIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid coupon ID parameter', details: parsedParams.error.issues });
    }
    const coupon = await prisma.coupon.findUnique({
      where: { id: parsedParams.data.id },
      include: {
        salesRep: {
          select: { id: true, name: true, email: true, designation: true, status: true, isDeleted: true },
        },
      },
    });
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });

    // Scoped permissions check for BDM
    if (req.user?.role === 'PLATFORM_SALES' && coupon.salesRepId && coupon.salesRepId !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden: you can only view your own offers' });
    }

    const now = new Date();
    let computedStatus = coupon.status || 'UNUSED';
    if (coupon.status === 'USED' || coupon.timesUsed > 0) {
      computedStatus = 'USED';
    } else if (coupon.expiresAt && new Date(coupon.expiresAt) < now) {
      computedStatus = 'EXPIRED';
    } else if (!coupon.active) {
      computedStatus = 'INACTIVE';
    }

    res.json({ ...coupon, computedStatus });
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
    const data = { ...parsed.data };
    const isSales = req.user?.role === 'PLATFORM_SALES';

    const before = await prisma.coupon.findUnique({ where: { id: parsedParams.data.id } });
    if (!before) return res.status(404).json({ error: 'Coupon not found' });

    // Scoped permission check
    if (isSales && before.salesRepId && before.salesRepId !== req.user.id) {
      return res.status(403).json({ error: 'Access forbidden: you can only edit your own offers' });
    }

    // Prevent modifying already-used coupons
    if (before.status === 'USED' || before.timesUsed > 0) {
      return res.status(400).json({ error: 'Cannot modify an offer that has already been used and activated.' });
    }

    if (isSales) {
      data.salesRepId = req.user.id;
      data.bdmName = req.user.name || before.bdmName;
    } else if (data.salesRepId !== undefined) {
      if (data.salesRepId) {
        const rep = await prisma.tenantUser.findUnique({
          where: { id: data.salesRepId },
          select: { id: true, name: true, email: true, role: true, status: true, isDeleted: true },
        });
        if (!rep || rep.role !== 'PLATFORM_SALES') {
          return res.status(400).json({ error: 'Assigned user must be an active Sales Team member', code: 'INVALID_SALES_REP' });
        }
        if (rep.status !== 'ACTIVE' || rep.isDeleted) {
          return res.status(400).json({ error: 'Inactive Sales Team members cannot receive coupon assignments', code: 'STAFF_INACTIVE' });
        }
        data.bdmName = rep.name;
      } else {
        data.salesRepId = null;
        data.bdmName = null;
      }
    }

    // Recalculate company offer values if pricing/duration was touched
    const totalLicenses = data.totalLicenses !== undefined ? Math.max(1, parseInt(data.totalLicenses) || 1) : before.totalLicenses;
    const perLicenseCost = data.perLicenseCost !== undefined ? Math.max(0, parseFloat(data.perLicenseCost) || 0) : Number(before.perLicenseCost || 3999);
    const discountPercent = data.discountPercent !== undefined ? Math.min(100, Math.max(0, parseFloat(data.discountPercent) || 0)) : Number(before.discountPercent || 0);

    if (totalLicenses && perLicenseCost) {
      const licenseAmount = round2(totalLicenses * perLicenseCost);
      const discountAmount = round2((licenseAmount * discountPercent) / 100);
      const finalAmount = round2(licenseAmount - discountAmount);

      data.totalLicenses = totalLicenses;
      data.perLicenseCost = perLicenseCost;
      data.licenseAmount = licenseAmount;
      data.discountPercent = discountPercent;
      data.discountValue = discountPercent;
      data.discountType = 'PERCENT';
      data.finalAmount = finalAmount;
    }

    if (data.startDate || data.promoMonths !== undefined) {
      const startDate = data.startDate ? new Date(data.startDate) : (before.startDate ? new Date(before.startDate) : new Date());
      const promoMonths = data.promoMonths !== undefined ? Math.max(0, parseInt(data.promoMonths) || 0) : (before.promoMonths || 0);
      const endDate = addCalendarMonths(startDate, 12 + promoMonths);
      data.startDate = startDate;
      data.promoMonths = promoMonths;
      data.endDate = endDate;
      data.expiresAt = endDate;
    }

    const coupon = await prisma.coupon.update({
      where: { id: parsedParams.data.id },
      data,
      include: {
        salesRep: {
          select: { id: true, name: true, email: true, designation: true, status: true, isDeleted: true },
        },
      },
    });

    await recordPlatformAction({
      req,
      action: PLATFORM_ACTIONS.COUPON_UPDATED,
      targetType: 'COUPON',
      targetId: coupon.id,
      beforeValue: before ? {
        code: before.code,
        discountValue: String(before.discountValue),
        active: before.active,
        salesRepId: before.salesRepId,
        bdmName: before.bdmName,
      } : null,
      afterValue: {
        code: coupon.code,
        discountValue: String(coupon.discountValue),
        active: coupon.active,
        salesRepId: coupon.salesRepId,
        bdmName: coupon.bdmName,
      },
    }).catch((err) => console.warn('[Coupon] audit write failed:', err.message));

    const now = new Date();
    let computedStatus = coupon.status || 'UNUSED';
    if (coupon.status === 'USED' || coupon.timesUsed > 0) {
      computedStatus = 'USED';
    } else if (coupon.expiresAt && new Date(coupon.expiresAt) < now) {
      computedStatus = 'EXPIRED';
    } else if (!coupon.active) {
      computedStatus = 'INACTIVE';
    }

    res.json({ ...coupon, computedStatus });
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Coupon not found' });
    next(err);
  }
}

/**
 * Manually marks a coupon as USED with payment / company references (Finance/Admin audit).
 */
export async function markUsed(req, res, next) {
  try {
    const parsedParams = couponIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid coupon ID parameter' });
    }
    const { paymentReference, companyId, activationReference } = req.body || {};
    const coupon = await prisma.coupon.findUnique({ where: { id: parsedParams.data.id } });
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
    if (coupon.status === 'USED' || coupon.timesUsed >= (coupon.usageLimit || 1)) {
      return res.status(400).json({ error: 'Coupon has already been used and activated.' });
    }

    const updated = await prisma.coupon.update({
      where: { id: coupon.id },
      data: {
        status: 'USED',
        timesUsed: { increment: 1 },
        usedAt: new Date(),
        usedCompanyId: companyId || coupon.usedCompanyId || null,
        paymentReference: paymentReference || null,
        activationReference: activationReference || null,
      },
      include: {
        salesRep: {
          select: { id: true, name: true, email: true, designation: true },
        },
      },
    });

    res.json({ ...updated, computedStatus: 'USED' });
  } catch (err) {
    next(err);
  }
}

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
