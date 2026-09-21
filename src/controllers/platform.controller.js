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
import {
  platformTenantQuerySchema,
  tenantIdParamSchema,
  suspendTenantSchema,
  platformAuditQuerySchema,
} from '../validations/platform.schema.js';
import {
  recordPlatformAction,
  listPlatformAudit,
  PLATFORM_ACTIONS,
} from '../services/platformAudit.service.js';

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
          // Commercial lifecycle — distinct from the onboarding status below.
          status: true,
          suspendedAt: true,
          suspendedReason: true,
          planEndsAt: true,
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
        // Two different things, kept apart because they answer different
        // questions: `status` is whether we let them in, `onboardingStatus` is
        // how far their signup got. A fully onboarded company can be suspended,
        // and a half-onboarded one is not suspended.
        status: t.status,
        suspendedAt: t.suspendedAt,
        suspendedReason: t.suspendedReason,
        planEndsAt: t.planEndsAt,
        // Tenants that predate the registration flow have no record; they exist,
        // so their onboarding is complete.
        onboardingStatus: t.registration?.status || 'ACTIVE',
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

// ─────────────────────────────────────────────────────────────────────────────
// TENANT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /platform/tenants/:id/suspend
 *
 * Freezes a customer company. Their users can no longer sign in, and are told
 * why rather than being handed a generic 401 or a half-loaded app.
 *
 * The suspension and its audit row are written in one transaction: an
 * unrecorded suspension, or a record of one that did not happen, are both
 * worse than failing.
 */
export async function suspendTenant(req, res, next) {
  try {
    const parsedParams = tenantIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const parsed = suspendTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: parsedParams.data.id },
      select: { id: true, companyName: true, status: true, isPlatform: true },
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Company not found' });
    }
    // Suspending the platform's own tenant would lock the operator out of the
    // console they are using to do it.
    if (tenant.isPlatform) {
      return res.status(400).json({ error: 'The platform tenant cannot be suspended' });
    }
    if (tenant.status === 'SUSPENDED') {
      return res.status(409).json({ error: `${tenant.companyName} is already suspended` });
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED', suspendedAt: now, suspendedReason: parsed.data.reason },
        select: { id: true, companyName: true, status: true, suspendedAt: true, suspendedReason: true },
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.TENANT_SUSPENDED,
        targetType: 'TENANT',
        targetId: tenant.id,
        tenantId: tenant.id,
        beforeValue: { status: tenant.status },
        afterValue: { status: 'SUSPENDED' },
        reason: parsed.data.reason,
      });
      return t;
    });

    // Existing JWTs stay valid until they expire, but requireAuth re-reads the
    // tenant on every request, so access stops on the next call either way.
    res.json({ tenant: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/tenants/:id/restore
 *
 * Returns a suspended company to ACTIVE and clears the suspension metadata.
 */
export async function restoreTenant(req, res, next) {
  try {
    const parsedParams = tenantIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: parsedParams.data.id },
      select: { id: true, companyName: true, status: true, suspendedReason: true },
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Company not found' });
    }
    if (tenant.status !== 'SUSPENDED') {
      return res.status(409).json({ error: `${tenant.companyName} is not suspended (status: ${tenant.status})` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE', suspendedAt: null, suspendedReason: null },
        select: { id: true, companyName: true, status: true },
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.TENANT_RESTORED,
        targetType: 'TENANT',
        targetId: tenant.id,
        tenantId: tenant.id,
        beforeValue: { status: 'SUSPENDED', suspendedReason: tenant.suspendedReason },
        afterValue: { status: 'ACTIVE' },
      });
      return t;
    });

    res.json({ tenant: updated });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/audit — what the operator has done. */
export async function getPlatformAudit(req, res, next) {
  try {
    const parsed = platformAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    res.json(await listPlatformAudit(parsed.data));
  } catch (err) {
    next(err);
  }
}
