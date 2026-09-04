import { prisma } from '../lib/prisma.js';

/**
 * GET /api/admin/registrations
 * List all company registrations with optional status filter and search.
 */
export async function listRegistrations(req, res, next) {
  try {
    const { status, search, page = '1', limit = '20' } = req.query;

    const where = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { domainName: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
        { tenantCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const take = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * take;

    const [items, total] = await Promise.all([
      prisma.companyRegistration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          companyName: true,
          companyType: true,
          domainName: true,
          tenantCode: true,
          fullName: true,
          designation: true,
          email: true,
          financeEmail: true,
          hrEmail: true,
          status: true,
          licenseQuantity: true,
          unitPrice: true,
          totalAmount: true,
          paymentMethod: true,
          gstin: true,
          financeApprovedAt: true,
          activatedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.companyRegistration.count({ where }),
    ]);

    // Status summary counts
    const statusCounts = await prisma.companyRegistration.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    const summary = {
      total,
      byStatus: Object.fromEntries(
        statusCounts.map((s) => [s.status, s._count.status])
      ),
    };

    res.json({ items, total, page: pageNum, limit: take, summary });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/registrations/:id
 * Get a single registration's full details.
 */
export async function getRegistration(req, res, next) {
  try {
    const registration = await prisma.companyRegistration.findUnique({
      where: { id: req.params.id },
      include: {
        tenant: true,
        coupon: true,
      },
    });

    if (!registration) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    res.json(registration);
  } catch (err) {
    next(err);
  }
}
