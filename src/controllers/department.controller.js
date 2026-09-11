/**
 * @file department.controller.js
 * @description CRUD for the tenant-scoped Department master list.
 *
 * RBAC:
 *   GET  /api/departments            → All authenticated roles (read-only)
 *   POST /api/departments            → SUPER_ADMIN, ADMIN, HR
 *   PATCH /api/departments/:id       → SUPER_ADMIN, ADMIN, HR
 *   DELETE /api/departments/:id      → SUPER_ADMIN, ADMIN  (soft-delete)
 *
 * Multi-tenant isolation: every query is scoped by req.tenantId.
 * Departments are NEVER hard-deleted — isActive:false archives them so that
 * historical employee records that reference the dept name remain readable.
 */

import { prisma } from '../lib/prisma.js';
import { createDepartmentSchema, updateDepartmentSchema } from '../validations/department.schema.js';

// ─── Default seed list ────────────────────────────────────────────────────────
// Applied automatically when a tenant has zero departments (first access).
// Colors use the brand-adjacent palette to look good in the UI out of the box.
const DEFAULT_DEPARTMENTS = [
  { name: 'Engineering',   color: '#6366f1', sortOrder: 0 },
  { name: 'Design',        color: '#f59e0b', sortOrder: 1 },
  { name: 'HR',            color: '#10b981', sortOrder: 2 },
  { name: 'Finance',       color: '#0ea5e9', sortOrder: 3 },
  { name: 'Marketing',     color: '#ec4899', sortOrder: 4 },
  { name: 'Operations',    color: '#8b5cf6', sortOrder: 5 },
  { name: 'Sales',         color: '#f97316', sortOrder: 6 },
  { name: 'Executive',     color: '#14b8a6', sortOrder: 7 },
  { name: 'Product',       color: '#e11d48', sortOrder: 8 },
  { name: 'Legal',         color: '#64748b', sortOrder: 9 },
  { name: 'General',       color: '#94a3b8', sortOrder: 10 },
];

/**
 * Ensures a tenant always has a base set of departments.
 * Called internally by listDepartments on first access.
 * Uses createMany with skipDuplicates — safe to call multiple times.
 */
async function seedDefaultsIfEmpty(tenantId) {
  const count = await prisma.department.count({ where: { tenantId } });
  if (count === 0) {
    await prisma.department.createMany({
      data: DEFAULT_DEPARTMENTS.map((d) => ({ ...d, tenantId })),
      skipDuplicates: true,
    });
  }
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * GET /api/departments
 * Returns all active departments for the tenant, ordered by sortOrder then name.
 * If tenant has no departments, auto-seeds defaults first.
 *
 * Query params:
 *   ?includeArchived=true  → also return isActive:false depts (for admin UI)
 */
export async function listDepartments(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const includeArchived = req.query.includeArchived === 'true';

    // Auto-seed defaults on first access
    await seedDefaultsIfEmpty(tenantId);

    const where = { tenantId };
    if (!includeArchived) {
      where.isActive = true;
    }

    const departments = await prisma.department.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        isActive: true,
        sortOrder: true,
        createdAt: true,
      },
    });

    // Attach usage count: how many active employees are in each department
    const usageCounts = await prisma.tenantUser.groupBy({
      by: ['department'],
      where: { tenantId, isDeleted: false, status: { in: ['ACTIVE', 'INVITED'] } },
      _count: { department: true },
    });
    const usageMap = Object.fromEntries(
      usageCounts.map((u) => [u.department, u._count.department])
    );

    const enriched = departments.map((d) => ({
      ...d,
      usageCount: usageMap[d.name] ?? 0,
    }));

    res.json({ departments: enriched });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/departments
 * Creates a new department for the tenant.
 * Protected: SUPER_ADMIN, ADMIN, HR only.
 */
export async function createDepartment(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = createDepartmentSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { name, description, color, sortOrder } = parsed.data;

    // Check for duplicate name (case-insensitive)
    const existing = await prisma.department.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      if (!existing.isActive) {
        // Department exists but was archived — just reactivate it
        const reactivated = await prisma.department.update({
          where: { id: existing.id },
          data: { isActive: true, description, color, sortOrder, updatedAt: new Date() },
        });
        return res.status(200).json({
          message: `Department "${name}" was archived and has been reactivated.`,
          department: reactivated,
        });
      }
      return res.status(409).json({
        error: `A department named "${name}" already exists in your organization.`,
      });
    }

    const department = await prisma.department.create({
      data: {
        tenantId,
        name,
        description,
        color,
        sortOrder: sortOrder ?? 0,
        createdBy: req.user?.id ?? null,
      },
    });

    res.status(201).json({ message: 'Department created successfully', department });
  } catch (err) {
    // Prisma unique constraint fallback (race condition safety)
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A department with this name already exists.' });
    }
    next(err);
  }
}

/**
 * PATCH /api/departments/:id
 * Updates department fields (name, description, color, sortOrder, isActive).
 * Protected: SUPER_ADMIN, ADMIN, HR only.
 */
export async function updateDepartment(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    // Verify ownership
    const existing = await prisma.department.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Department not found' });
    }

    const parsed = updateDepartmentSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const { name, description, color, sortOrder, isActive } = parsed.data;

    // If renaming, check no duplicate
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = await prisma.department.findFirst({
        where: { tenantId, name: { equals: name, mode: 'insensitive' }, NOT: { id } },
      });
      if (dup) {
        return res.status(409).json({ error: `A department named "${name}" already exists.` });
      }
    }

    const updated = await prisma.department.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json({ message: 'Department updated successfully', department: updated });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A department with this name already exists.' });
    }
    next(err);
  }
}

/**
 * DELETE /api/departments/:id
 * Soft-deletes (archives) a department by setting isActive: false.
 * Hard delete is intentionally not supported to preserve historical records.
 * Protected: SUPER_ADMIN, ADMIN only.
 */
export async function deactivateDepartment(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const existing = await prisma.department.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Department not found' });
    }
    if (!existing.isActive) {
      return res.status(409).json({ error: 'This department is already archived' });
    }

    // Warn if employees are still assigned to it
    const usageCount = await prisma.tenantUser.count({
      where: {
        tenantId,
        isDeleted: false,
        status: { in: ['ACTIVE', 'INVITED'] },
        department: { equals: existing.name, mode: 'insensitive' },
      },
    });

    await prisma.department.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({
      message: `Department "${existing.name}" has been archived.`,
      warning:
        usageCount > 0
          ? `${usageCount} active employee(s) still have this department assigned. Their records are preserved, but the department will no longer appear in dropdowns.`
          : null,
    });
  } catch (err) {
    next(err);
  }
}
