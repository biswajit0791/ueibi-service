/**
 * customerReview.controller.js — Platform Owner Review Management & Public API.
 *
 * Platform Owner has full CRUD control over customer testimonials displayed on
 * the public landing page. Public API delivers published, featured reviews.
 */
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const reviewInputSchema = z.object({
  companyName: z.string().trim().min(2, 'Company name is required').max(150),
  clientName: z.string().trim().min(2, 'Client / Reviewer name is required').max(120),
  designation: z.string().trim().max(120).optional().nullable(),
  avatarUrl: z.string().trim().url('Invalid avatar URL').optional().nullable().or(z.literal('')),
  rating: z.coerce.number().int().min(1).max(5).default(5),
  headline: z.string().trim().max(200).optional().nullable(),
  reviewText: z.string().trim().min(5, 'Review content must be at least 5 characters').max(2000),
  isFeatured: z.boolean().default(false),
  isPublished: z.boolean().default(true),
  orderIndex: z.coerce.number().int().default(0),
});

const reviewUpdateSchema = reviewInputSchema.partial();

/**
 * GET /api/public/reviews — Unauthenticated public endpoint for landing pages.
 */
export async function getPublicReviews(req, res, next) {
  try {
    const reviews = await prisma.customerReview.findMany({
      where: { isPublished: true },
      orderBy: [
        { isFeatured: 'desc' },
        { orderIndex: 'asc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        companyName: true,
        clientName: true,
        designation: true,
        avatarUrl: true,
        rating: true,
        headline: true,
        reviewText: true,
        isFeatured: true,
        createdAt: true,
      },
    });

    const averageRating = reviews.length > 0
      ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1))
      : 5.0;

    res.json({
      reviews,
      summary: {
        totalReviews: reviews.length,
        averageRating,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/reviews — Platform Owner list with complete management details.
 */
export async function listAdminReviews(req, res, next) {
  try {
    const { search, status, rating } = req.query;

    const where = {};
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { companyName: { contains: q, mode: 'insensitive' } },
        { clientName: { contains: q, mode: 'insensitive' } },
        { headline: { contains: q, mode: 'insensitive' } },
        { reviewText: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (status === 'published') where.isPublished = true;
    if (status === 'draft') where.isPublished = false;
    if (status === 'featured') where.isFeatured = true;

    if (rating && !isNaN(rating)) {
      where.rating = Number(rating);
    }

    const reviews = await prisma.customerReview.findMany({
      where,
      orderBy: [
        { isFeatured: 'desc' },
        { orderIndex: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    const allCounts = await prisma.customerReview.findMany({
      select: { rating: true, isPublished: true, isFeatured: true },
    });

    const totalCount = allCounts.length;
    const publishedCount = allCounts.filter((r) => r.isPublished).length;
    const featuredCount = allCounts.filter((r) => r.isFeatured).length;
    const avgRating = totalCount > 0
      ? Number((allCounts.reduce((s, r) => s + r.rating, 0) / totalCount).toFixed(1))
      : 5.0;

    res.json({
      reviews,
      stats: {
        total: totalCount,
        published: publishedCount,
        draft: totalCount - publishedCount,
        featured: featuredCount,
        averageRating: avgRating,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/reviews — Create a new customer review.
 */
export async function createCustomerReview(req, res, next) {
  try {
    const parsed = reviewInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const data = {
      ...parsed.data,
      avatarUrl: parsed.data.avatarUrl || null,
      designation: parsed.data.designation || null,
      headline: parsed.data.headline || null,
    };

    const review = await prisma.customerReview.create({ data });

    res.status(201).json({
      message: 'Customer review created successfully.',
      review,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /platform/reviews/:id — Update existing customer review or toggle status.
 */
export async function updateCustomerReview(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.customerReview.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Customer review not found' });
    }

    const parsed = reviewUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const data = { ...parsed.data };
    if ('avatarUrl' in data && !data.avatarUrl) data.avatarUrl = null;
    if ('designation' in data && !data.designation) data.designation = null;
    if ('headline' in data && !data.headline) data.headline = null;

    const updated = await prisma.customerReview.update({
      where: { id },
      data,
    });

    res.json({
      message: 'Customer review updated successfully.',
      review: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /platform/reviews/:id — Delete customer review.
 */
export async function deleteCustomerReview(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.customerReview.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Customer review not found' });
    }

    await prisma.customerReview.delete({ where: { id } });

    res.json({ message: 'Customer review deleted successfully.' });
  } catch (err) {
    next(err);
  }
}
