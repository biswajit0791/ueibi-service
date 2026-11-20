import { prisma } from '../lib/prisma.js';
import {
  createDesignationSchema,
  updateDesignationSchema,
  updateDesignationStatusSchema,
} from '../validations/designation.schema.js';
import { PLATFORM_ACTIONS, recordPlatformAction } from '../services/platformAudit.service.js';

/**
 * Public API: List active designations for public registration dropdowns (e.g. CMD signup Step 2).
 * Accessible without authentication.
 */
export async function listDesignationsPublic(req, res, next) {
  try {
    const items = await prisma.designation.findMany({
      where: { isActive: true },
      orderBy: [
        { displayOrder: 'asc' },
        { name: 'asc' },
      ],
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        displayOrder: true,
        isDefault: true,
      },
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

/**
 * Platform Owner API: List designations with search, status filter, and registered company counts.
 */
export async function listDesignationsAdmin(req, res, next) {
  try {
    const {
      search = '',
      status = 'all',
      page = 1,
      limit = 100,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, designations, statsGroup, totalCompanies] = await Promise.all([
      prisma.designation.count({ where }),
      prisma.designation.findMany({
        where,
        orderBy: [
          { displayOrder: 'asc' },
          { name: 'asc' },
        ],
        skip,
        take: limitNum,
        include: {
          _count: {
            select: {
              companyRegistrations: true,
            },
          },
        },
      }),
      prisma.designation.groupBy({
        by: ['isActive'],
        _count: { id: true },
      }),
      prisma.companyRegistration.count(),
    ]);

    const activeCount = statsGroup.find((g) => g.isActive)?._count?.id || 0;
    const inactiveCount = statsGroup.find((g) => !g.isActive)?._count?.id || 0;
    const allTotal = activeCount + inactiveCount;

    const items = designations.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      description: d.description,
      isActive: d.isActive,
      isDefault: d.isDefault,
      displayOrder: d.displayOrder,
      createdBy: d.createdBy,
      updatedBy: d.updatedBy,
      companiesCount: d._count?.companyRegistrations || 0,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    res.json({
      items,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      summary: {
        total: allTotal,
        active: activeCount,
        inactive: inactiveCount,
        totalCompanies,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Platform Owner API: Get single designation by ID.
 */
export async function getDesignationAdmin(req, res, next) {
  try {
    const { id } = req.params;

    const designation = await prisma.designation.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            companyRegistrations: true,
          },
        },
      },
    });

    if (!designation) {
      return res.status(404).json({ error: 'Designation not found' });
    }

    res.json({
      ...designation,
      companiesCount: designation._count?.companyRegistrations || 0,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Platform Owner API: Create a new designation.
 */
export async function createDesignation(req, res, next) {
  try {
    const parsed = createDesignationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { name, code, description, isActive, isDefault, displayOrder } = parsed.data;

    // Check code uniqueness
    const existingCode = await prisma.designation.findUnique({
      where: { code },
    });
    if (existingCode) {
      return res.status(409).json({
        error: `Designation with code "${code}" already exists`,
      });
    }

    // Check name uniqueness (case-insensitive)
    const existingName = await prisma.designation.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existingName) {
      return res.status(409).json({
        error: `Designation with name "${name}" already exists`,
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      // If setting as default, unset existing defaults
      if (isDefault) {
        await tx.designation.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      const record = await tx.designation.create({
        data: {
          name,
          code,
          description: description || null,
          isActive: isActive !== undefined ? isActive : true,
          isDefault: Boolean(isDefault),
          displayOrder: displayOrder !== undefined ? displayOrder : 0,
          createdBy: req.user?.email || req.user?.name || req.user?.id || 'PLATFORM_OWNER',
        },
      });

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.DESIGNATION_CREATED,
        targetType: 'Designation',
        targetId: record.id,
        afterValue: record,
      });

      return record;
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

/**
 * Platform Owner API: Update an existing designation.
 */
export async function updateDesignation(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.designation.findUnique({
      where: { id },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Designation not found' });
    }

    const parsed = updateDesignationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { name, code, description, isActive, isDefault, displayOrder } = parsed.data;

    // Check code uniqueness if changed
    if (code !== existing.code) {
      const conflictCode = await prisma.designation.findFirst({
        where: { code, id: { not: id } },
      });
      if (conflictCode) {
        return res.status(409).json({
          error: `Designation with code "${code}" already exists`,
        });
      }
    }

    // Check name uniqueness if changed
    if (name.toLowerCase() !== existing.name.toLowerCase()) {
      const conflictName = await prisma.designation.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (conflictName) {
        return res.status(409).json({
          error: `Designation with name "${name}" already exists`,
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // If setting as default, unset existing defaults on other rows
      if (isDefault) {
        await tx.designation.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      const record = await tx.designation.update({
        where: { id },
        data: {
          name,
          code,
          description: description !== undefined ? description : existing.description,
          isActive: isActive !== undefined ? isActive : existing.isActive,
          isDefault: isDefault !== undefined ? isDefault : existing.isDefault,
          displayOrder: displayOrder !== undefined ? displayOrder : existing.displayOrder,
          updatedBy: req.user?.email || req.user?.name || req.user?.id || 'PLATFORM_OWNER',
        },
      });

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.DESIGNATION_UPDATED,
        targetType: 'Designation',
        targetId: record.id,
        beforeValue: existing,
        afterValue: record,
      });

      return record;
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

/**
 * Platform Owner API: Toggle / update active status of a designation.
 */
export async function updateDesignationStatus(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.designation.findUnique({
      where: { id },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Designation not found' });
    }

    const parsed = updateDesignationStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { isActive } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.designation.update({
        where: { id },
        data: {
          isActive,
          updatedBy: req.user?.email || req.user?.name || req.user?.id || 'PLATFORM_OWNER',
        },
      });

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.DESIGNATION_STATUS_CHANGED,
        targetType: 'Designation',
        targetId: record.id,
        beforeValue: { isActive: existing.isActive },
        afterValue: { isActive: record.isActive },
      });

      return record;
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

/**
 * Platform Owner API: Delete a designation.
 * Prevents deletion if referenced by registrations or if marked as default.
 */
export async function deleteDesignation(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.designation.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            companyRegistrations: true,
          },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Designation not found' });
    }

    // Safety guard: cannot delete the designated default designation
    if (existing.isDefault) {
      return res.status(400).json({
        error: `Cannot delete default designation "${existing.name}". Please set another designation as default before deleting this one.`,
      });
    }

    // Comprehensive reference check: check foreign key link and historical string match
    const referencesCount = await prisma.companyRegistration.count({
      where: {
        OR: [
          { designationId: id },
          { designation: { equals: existing.name, mode: 'insensitive' } },
          { designation: { equals: existing.code, mode: 'insensitive' } },
        ],
      },
    });

    if (referencesCount > 0) {
      return res.status(400).json({
        error: `Cannot delete designation "${existing.name}" because it is currently referenced by ${referencesCount} registered company/companies. Deactivate it instead to prevent new registrations from selecting it while preserving historical records.`,
        companiesCount: referencesCount,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.designation.delete({
        where: { id },
      });

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.DESIGNATION_DELETED,
        targetType: 'Designation',
        targetId: id,
        beforeValue: existing,
      });
    });

    res.json({ message: 'Designation deleted successfully', id });
  } catch (err) {
    next(err);
  }
}
