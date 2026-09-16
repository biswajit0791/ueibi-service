import { prisma } from '../lib/prisma.js';
import { couponSchema, couponIdParamSchema, listCouponsQuerySchema } from '../validations/coupon.schema.js';

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
    const coupon = await prisma.coupon.update({ where: { id: parsedParams.data.id }, data: parsed.data });
    res.json(coupon);
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
    res.json(coupon);
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Coupon not found' });
    next(err);
  }
}
