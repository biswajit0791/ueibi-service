import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const couponSchema = z.object({
  code: z.string().min(1).toUpperCase(),
  discountType: z.enum(['PERCENT', 'FLAT']),
  discountValue: z.number().positive(),
  bdmName: z.string().optional(),
  expiresAt: z.coerce.date().optional(),
  usageLimit: z.number().int().positive().optional(),
  active: z.boolean().optional(),
});

export async function list(req, res, next) {
  try {
    const { active, search } = req.query;
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
    const data = couponSchema.parse(req.body);
    const coupon = await prisma.coupon.create({ data });
    res.status(201).json(coupon);
  } catch (err) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Coupon code already exists' });
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: err.issues });
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const coupon = await prisma.coupon.findUnique({ where: { id: req.params.id } });
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
    res.json(coupon);
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const data = couponSchema.partial().parse(req.body);
    const coupon = await prisma.coupon.update({ where: { id: req.params.id }, data });
    res.json(coupon);
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Coupon not found' });
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: err.issues });
    next(err);
  }
}

export async function remove(req, res, next) {
  try {
    const coupon = await prisma.coupon.update({ where: { id: req.params.id }, data: { active: false } });
    res.json(coupon);
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Coupon not found' });
    next(err);
  }
}
