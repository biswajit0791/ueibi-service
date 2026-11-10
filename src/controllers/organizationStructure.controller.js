import { prisma } from '../lib/prisma.js';
import {
  createOrganizationStructureSchema,
  updateOrganizationStructureSchema,
  updateOrganizationStructureStatusSchema,
} from '../validations/organizationStructure.schema.js';
import { PLATFORM_ACTIONS, recordPlatformAction } from '../services/platformAudit.service.js';

/**
 * Public API: List active organization structures for public registration dropdowns.
 * Accessible without authentication.
 */
export async function listOrganizationStructuresPublic(req, res, next) {
  try {
    const structures = await prisma.organizationStructure.findMany({
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
      },
    });

    res.json({ items: structures });
  } catch (err) {
    next(err);
  }
}

/**
 * Platform Owner API: List organization structures with pagination, search, status filter, and registered company counts.
 */
export async function listOrganizationStructuresAdmin(req, res, next) {
  try {
    const {
      search = '',
      status = 'all',
      page = 1,
      limit = 50,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
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

    const [total, structures, statsGroup, totalCompanies] = await Promise.all([
      prisma.organizationStructure.count({ where }),
      prisma.organizationStructure.findMany({
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
      prisma.organizationStructure.groupBy({
        by: ['isActive'],
        _count: { id: true },
      }),
      prisma.companyRegistration.count(),
    ]);

    const activeCount = statsGroup.find((g) => g.isActive)?._count?.id || 0;
    const inactiveCount = statsGroup.find((g) => !g.isActive)?._count?.id || 0;
    const allTotal = activeCount + inactiveCount;

    // Enhance each structure with companies count
    const items = structures.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      description: s.description,
      isActive: s.isActive,
      displayOrder: s.displayOrder,
      companiesCount: s._count?.companyRegistrations || 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
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
 * Platform Owner API: Get single organization structure by ID.
 */
export async function getOrganizationStructureAdmin(req, res, next) {
  try {
    const { id } = req.params;

    const structure = await prisma.organizationStructure.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            companyRegistrations: true,
          },
        },
      },
    });

    if (!structure) {
      return res.status(404).json({ error: 'Organization structure not found' });
    }

    res.json({
      ...structure,
      companiesCount: structure._count?.companyRegistrations || 0,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Platform Owner API: Create a new organization structure.
 */
export async function createOrganizationStructure(req, res, next) {
  try {
    const parsed = createOrganizationStructureSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { name, code, description, isActive, displayOrder } = parsed.data;

    // Check code uniqueness
    const existingCode = await prisma.organizationStructure.findUnique({
      where: { code },
    });
    if (existingCode) {
      return res.status(409).json({
        error: `Organization structure with code "${code}" already exists`,
      });
    }

    // Check name uniqueness (case-insensitive)
    const existingName = await prisma.organizationStructure.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existingName) {
      return res.status(409).json({
        error: `Organization structure with name "${name}" already exists`,
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.organizationStructure.create({
        data: {
          name,
          code,
          description: description || null,
          isActive: isActive !== undefined ? isActive : true,
          displayOrder: displayOrder !== undefined ? displayOrder : 0,
        },
      });

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.ORGANIZATION_STRUCTURE_CREATED,
        targetType: 'OrganizationStructure',
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
 * Platform Owner API: Update an existing organization structure.
 */
export async function updateOrganizationStructure(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.organizationStructure.findUnique({
      where: { id },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Organization structure not found' });
    }

    const parsed = updateOrganizationStructureSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { name, code, description, isActive, displayOrder } = parsed.data;

    // Check code uniqueness if changed
    if (code !== existing.code) {
      const conflictCode = await prisma.organizationStructure.findFirst({
        where: { code, id: { not: id } },
      });
      if (conflictCode) {
        return res.status(409).json({
          error: `Organization structure with code "${code}" already exists`,
        });
      }
    }

    // Check name uniqueness if changed
    if (name.toLowerCase() !== existing.name.toLowerCase()) {
      const conflictName = await prisma.organizationStructure.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (conflictName) {
        return res.status(409).json({
          error: `Organization structure with name "${name}" already exists`,
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.organizationStructure.update({
        where: { id },
        data: {
          name,
          code,
          description: description !== undefined ? description : existing.description,
          isActive: isActive !== undefined ? isActive : existing.isActive,
          displayOrder: displayOrder !== undefined ? displayOrder : existing.displayOrder,
        },
      });

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.ORGANIZATION_STRUCTURE_UPDATED,
        targetType: 'OrganizationStructure',
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
 * Platform Owner API: Toggle / update active status of an organization structure.
 */
export async function updateOrganizationStructureStatus(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.organizationStructure.findUnique({
      where: { id },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Organization structure not found' });
    }

    const parsed = updateOrganizationStructureStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { isActive } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.organizationStructure.update({
        where: { id },
        data: { isActive },
      });

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.ORGANIZATION_STRUCTURE_STATUS_CHANGED,
        targetType: 'OrganizationStructure',
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
 * Platform Owner API: Delete an organization structure.
 * Prevent deletion if any company registration references it.
 */
export async function deleteOrganizationStructure(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.organizationStructure.findUnique({
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
      return res.status(404).json({ error: 'Organization structure not found' });
    }

    // Comprehensive reference check: check both foreign key relation and legacy companyType string matches
    const referencesCount = await prisma.companyRegistration.count({
      where: {
        OR: [
          { organizationStructureId: id },
          { companyType: { equals: existing.name, mode: 'insensitive' } },
          { companyType: { equals: existing.code, mode: 'insensitive' } },
        ],
      },
    });

    if (referencesCount > 0) {
      return res.status(400).json({
        error: `Cannot delete organization structure "${existing.name}" because it is currently referenced by ${referencesCount} registered company/companies. You can deactivate it instead to prevent new registrations from selecting it.`,
        companiesCount: referencesCount,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.organizationStructure.delete({
        where: { id },
      });

      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.ORGANIZATION_STRUCTURE_DELETED,
        targetType: 'OrganizationStructure',
        targetId: id,
        beforeValue: existing,
      });
    });

    res.json({ message: 'Organization structure deleted successfully', id });
  } catch (err) {
    next(err);
  }
}

