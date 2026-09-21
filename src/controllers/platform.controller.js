/**
 * platform.controller.js
 *
 * Read-only operator view of the platform itself: how many companies exist,
 * how many seats they use, what is waiting to be onboarded.
 *
 * These are the ONLY handlers in the codebase that intentionally read across
 * tenants, so two rules apply and are enforced by the route wiring:
 *
 *   1. Every route is behind requireAuth + requirePlatformOwner. No company
 *      role reaches them, however elevated it is inside its own tenant.
 *   2. They return company metadata and COUNTS only — never a goal, employee
 *      record, message, dispute or any other tenant-owned row. Aggregates keep
 *      the operator informed without handing them customer data.
 */
import { prisma } from '../lib/prisma.js';
import { platformTenantQuerySchema } from '../validations/platform.schema.js';

/** Tenants that belong to customers — the internal platform tenant is not a company. */
const CUSTOMER_TENANTS = { isPlatform: false };

/** GET /platform/overview — headline counts for the operator dashboard. */
export async function getPlatformOverview(req, res, next) {
  try {
    const [companies, activeUsers, pendingRegistrations, licenceRows, contractAgg] = await Promise.all([
      prisma.tenant.count({ where: CUSTOMER_TENANTS }),
      prisma.tenantUser.count({
        where: { isDeleted: false, status: 'ACTIVE', tenant: CUSTOMER_TENANTS },
      }),
      prisma.companyRegistration.count({ where: { status: { not: 'ACTIVE' } } }),
      prisma.tenant.findMany({ where: CUSTOMER_TENANTS, select: { licenseLimit: true } }),
      // Licence fees actually invoiced. This is a one-time contracted amount per
      // registration, NOT recurring revenue — there is no subscription/plan model
      // in the schema, so it must not be presented as MRR.
      prisma.companyRegistration.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { totalAmount: true },
      }),
    ]);

    const licencesPurchased = licenceRows.reduce((sum, t) => sum + (t.licenseLimit || 0), 0);

    res.json({
      overview: {
        companies,
        activeUsers,
        pendingRegistrations,
        licencesPurchased,
        licencesUsed: activeUsers,
        licenceUtilisation: licencesPurchased > 0
          ? Math.round((activeUsers / licencesPurchased) * 100)
          : 0,
        // Rupees: unitPrice/GST are configured in INR (see env LICENSE_UNIT_PRICE).
        contractedValue: Number(contractAgg._sum.totalAmount || 0),
        currency: 'INR',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/tenants — one row per customer company.
 *
 * Company metadata plus a seat count. Deliberately no drill-down into the
 * tenant's own records.
 */
export async function listPlatformTenants(req, res, next) {
  try {
    const parsed = platformTenantQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { search, page, limit } = parsed.data;

    const where = { ...CUSTOMER_TENANTS };
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { tenantCode: { contains: search, mode: 'insensitive' } },
        { domainName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;
    const [total, tenants] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        select: {
          id: true,
          companyName: true,
          tenantCode: true,
          domainName: true,
          licenseLimit: true,
          createdAt: true,
          // Onboarding record: carries the legal entity type, the approval
          // status and what was actually invoiced.
          registration: {
            select: { companyType: true, status: true, licenseQuantity: true, totalAmount: true },
          },
          // Same predicate as activeUsers in getPlatformOverview, so the table
          // rows sum to the headline figure rather than disagreeing with it.
          _count: { select: { users: { where: { isDeleted: false, status: 'ACTIVE' } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    res.json({
      items: tenants.map((t) => ({
        id: t.id,
        companyName: t.companyName,
        tenantCode: t.tenantCode,
        domainName: t.domainName,
        licenseLimit: t.licenseLimit,
        userCount: t._count.users,
        createdAt: t.createdAt,
        // `companyType` is the legal entity type ("Private Limited"), not an
        // industry — the frontend labels it accordingly rather than inventing
        // a sector the schema does not record.
        companyType: t.registration?.companyType || null,
        // Tenants that predate the registration flow have no record; they exist,
        // so they are active.
        status: t.registration?.status || 'ACTIVE',
        contractedValue: t.registration?.totalAmount != null
          ? Number(t.registration.totalAmount)
          : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}
