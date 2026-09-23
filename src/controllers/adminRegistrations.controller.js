import { prisma } from '../lib/prisma.js';
import { listRegistrationsQuerySchema, registrationIdParamSchema } from '../validations/adminRegistrations.schema.js';

/**
 * GET /api/admin/registrations
 * List all company registrations with optional status filter and search.
 */
export async function listRegistrations(req, res, next) {
  try {
    const parsedQuery = listRegistrationsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { status, search, page, limit } = parsedQuery.data;

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

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.companyRegistration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
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

    res.json({ items, total, page, limit, summary });
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
    const parsedParams = registrationIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid registration ID parameter', details: parsedParams.error.issues });
    }
    // Explicit select, not `include`. A bare include returns every scalar on the
    // model, and CompanyRegistration carries the CMD's bcrypt passwordHash —
    // which was being sent to the browser. A password hash must never leave the
    // server, whoever is asking.
    const registration = await prisma.companyRegistration.findUnique({
      where: { id: parsedParams.data.id },
      select: {
        id: true,
        companyName: true, companyType: true, domainName: true, tenantCode: true,
        fullName: true, designation: true, email: true,
        financeEmail: true, hrEmail: true, acceptedTermsAt: true,
        gstin: true, licenseQuantity: true, unitPrice: true,
        discountAmount: true, subtotalAmount: true,
        gstRate: true, gstAmount: true, totalAmount: true,
        paymentMethod: true, paymentReference: true,
        chequeNumber: true, chequeDate: true, transactionId: true,
        financeApprovedAt: true, activatedAt: true,
        status: true, createdAt: true, updatedAt: true,
        couponId: true,
        tenant: {
          select: {
            id: true, companyName: true, tenantCode: true, domainName: true,
            status: true, licenseLimit: true, createdAt: true,
          },
        },
        coupon: {
          select: {
            id: true, code: true, discountType: true, discountValue: true,
            bdmName: true, active: true, expiresAt: true,
          },
        },
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
