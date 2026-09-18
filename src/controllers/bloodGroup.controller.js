import { prisma } from '../lib/prisma.js';
import {
  listBloodGroupsQuerySchema,
  createBloodGroupSchema,
  updateBloodGroupSchema,
  bloodGroupIdParamSchema,
} from '../validations/bloodGroup.schema.js';

// The eight ABO/Rh groups, seeded on first access so a new tenant's dropdown is
// never empty. Rare phenotypes are added by the tenant, not shipped by default.
const DEFAULT_BLOOD_GROUPS = [
  { name: 'A+', sortOrder: 0 },
  { name: 'A-', sortOrder: 1 },
  { name: 'B+', sortOrder: 2 },
  { name: 'B-', sortOrder: 3 },
  { name: 'AB+', sortOrder: 4 },
  { name: 'AB-', sortOrder: 5 },
  { name: 'O+', sortOrder: 6 },
  { name: 'O-', sortOrder: 7 },
];

async function seedDefaultsIfEmpty(tenantId) {
  const count = await prisma.bloodGroup.count({ where: { tenantId } });
  if (count === 0) {
    await prisma.bloodGroup.createMany({
      data: DEFAULT_BLOOD_GROUPS.map((b) => ({ ...b, tenantId })),
      skipDuplicates: true,
    });
  }
}

function invalid(res, error) {
  return res.status(400).json({
    error: 'Validation failed',
    details: (error?.issues || []).map((i) => ({ field: i.path.join('.'), message: i.message })),
  });
}

/**
 * GET /api/blood-groups
 * Every authenticated role can read — this feeds the onboarding dropdown.
 * ?includeArchived=true returns archived rows as well, for the admin screen.
 */
export async function listBloodGroups(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = listBloodGroupsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return invalid(res, parsed.error);

    const { search } = parsed.data;
    const includeArchived = parsed.data.includeArchived === 'true';

    await seedDefaultsIfEmpty(tenantId);

    const where = { tenantId };
    if (!includeArchived) where.isActive = true;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const bloodGroups = await prisma.bloodGroup.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, isActive: true, sortOrder: true, createdAt: true },
    });

    // How many active employees currently hold each value — shown in the admin
    // UI so nobody archives a group that is still in use without realising.
    const usage = await prisma.tenantUser.groupBy({
      by: ['bloodGroup'],
      where: { tenantId, isDeleted: false, status: { in: ['ACTIVE', 'INVITED'] } },
      _count: { bloodGroup: true },
    });
    const usageMap = Object.fromEntries(usage.map((u) => [u.bloodGroup, u._count.bloodGroup]));

    res.json({
      bloodGroups: bloodGroups.map((b) => ({ ...b, usageCount: usageMap[b.name] ?? 0 })),
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/blood-groups — SUPER_ADMIN, ADMIN, HR */
export async function createBloodGroup(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = createBloodGroupSchema.safeParse(req.body || {});
    if (!parsed.success) return invalid(res, parsed.error);

    const { name, sortOrder } = parsed.data;

    const existing = await prisma.bloodGroup.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, isActive: true },
    });
    if (existing) {
      // Re-adding an archived value restores it rather than colliding with the
      // unique index and returning a confusing 409.
      if (!existing.isActive) {
        const restored = await prisma.bloodGroup.update({
          where: { id: existing.id },
          data: { isActive: true, ...(sortOrder !== undefined ? { sortOrder } : {}) },
        });
        return res.status(200).json({ message: 'Blood group restored', bloodGroup: restored });
      }
      return res.status(409).json({ error: 'That blood group already exists' });
    }

    const created = await prisma.bloodGroup.create({
      data: {
        tenantId,
        name,
        sortOrder: sortOrder ?? 100,
        createdBy: req.user?.id ?? null,
      },
    });
    res.status(201).json({ message: 'Blood group created', bloodGroup: created });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/blood-groups/:id — SUPER_ADMIN, ADMIN, HR */
export async function updateBloodGroup(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const params = bloodGroupIdParamSchema.safeParse(req.params || {});
    if (!params.success) return invalid(res, params.error);
    const body = updateBloodGroupSchema.safeParse(req.body || {});
    if (!body.success) return invalid(res, body.error);

    const current = await prisma.bloodGroup.findFirst({
      where: { id: params.data.id, tenantId },
      select: { id: true, name: true },
    });
    if (!current) return res.status(404).json({ error: 'Blood group not found' });

    if (body.data.name && body.data.name.toLowerCase() !== current.name.toLowerCase()) {
      const clash = await prisma.bloodGroup.findFirst({
        where: { tenantId, name: { equals: body.data.name, mode: 'insensitive' }, id: { not: current.id } },
        select: { id: true },
      });
      if (clash) return res.status(409).json({ error: 'Another blood group already uses that name' });
    }

    const updated = await prisma.bloodGroup.update({
      where: { id: current.id },
      data: body.data,
    });

    // Employee records store the blood group as a string, so a rename has to be
    // carried across or historical values would silently stop matching the list.
    if (body.data.name && body.data.name !== current.name) {
      await prisma.tenantUser.updateMany({
        where: { tenantId, bloodGroup: current.name },
        data: { bloodGroup: body.data.name },
      });
    }

    res.json({ message: 'Blood group updated', bloodGroup: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/blood-groups/:id — SUPER_ADMIN, ADMIN
 * Archives rather than deletes: employee records hold the value as a string, so
 * a hard delete would orphan them.
 */
export async function deactivateBloodGroup(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const params = bloodGroupIdParamSchema.safeParse(req.params || {});
    if (!params.success) return invalid(res, params.error);

    const existing = await prisma.bloodGroup.findFirst({
      where: { id: params.data.id, tenantId },
      select: { id: true, name: true },
    });
    if (!existing) return res.status(404).json({ error: 'Blood group not found' });

    const inUse = await prisma.tenantUser.count({
      where: { tenantId, bloodGroup: existing.name, isDeleted: false },
    });

    const archived = await prisma.bloodGroup.update({
      where: { id: existing.id },
      data: { isActive: false },
    });

    res.json({
      message: inUse > 0
        ? `Blood group archived. ${inUse} employee record${inUse === 1 ? ' keeps' : 's keep'} this value.`
        : 'Blood group archived',
      bloodGroup: archived,
      usageCount: inUse,
    });
  } catch (err) {
    next(err);
  }
}
