import { prisma } from '../lib/prisma.js';
import { GOAL_CATEGORIES, GOAL_TYPES, GOAL_PRIORITIES } from './goal.service.js';

/**
 * Tenant-managed master lists behind the goal form's Category / Goal Type /
 * Priority dropdowns.
 *
 * Seeded from the previous hardcoded constants on first read, so an existing
 * tenant sees exactly the same options until an admin changes them.
 *
 * Goal.category / goalType / priority store the option's `value` as a plain
 * string with no foreign key. That is why archiving is a soft-delete (existing
 * goals keep their value) and renaming cascades (or those goals would silently
 * stop matching the list and drop out of filters).
 */

export const GOAL_OPTION_KINDS = ['CATEGORY', 'TYPE', 'PRIORITY'];

// Priority is the one list whose order is SEMANTIC, not just cosmetic — low is
// genuinely below critical. sortOrder carries that, which is why every read
// orders by it rather than alphabetically.
const PRIORITY_SEED = [
  { value: 'low', label: 'Low', color: '#64748b' },
  { value: 'medium', label: 'Medium', color: '#f59e0b' },
  { value: 'high', label: 'High', color: '#f97316' },
  { value: 'critical', label: 'Critical', color: '#ef4444' },
];

function defaultsFor(kind) {
  if (kind === 'CATEGORY') return GOAL_CATEGORIES.map((c, i) => ({ value: c, label: c, sortOrder: i, color: null }));
  if (kind === 'TYPE') return GOAL_TYPES.map((t, i) => ({ value: t, label: t, sortOrder: i, color: null }));
  // Seed priority from the canonical order, falling back to the constant if it
  // ever gains a value the seed list does not know about.
  const known = new Set(PRIORITY_SEED.map((p) => p.value));
  const extra = GOAL_PRIORITIES.filter((p) => !known.has(p)).map((p, i) => ({
    value: p,
    label: p.charAt(0).toUpperCase() + p.slice(1),
    color: null,
    sortOrder: PRIORITY_SEED.length + i,
  }));
  return [...PRIORITY_SEED.map((p, i) => ({ ...p, sortOrder: i })), ...extra];
}

async function seedIfEmpty(tenantId, kind) {
  const count = await prisma.goalOption.count({ where: { tenantId, kind } });
  if (count > 0) return;
  await prisma.goalOption.createMany({
    data: defaultsFor(kind).map((o) => ({ ...o, tenantId, kind })),
    skipDuplicates: true,
  });
}

export class GoalOptionService {
  /** Active options for one dropdown, in sortOrder. Seeds on first access. */
  async list({ tenantId, kind, includeArchived = false }) {
    await seedIfEmpty(tenantId, kind);
    return prisma.goalOption.findMany({
      where: { tenantId, kind, ...(includeArchived ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: { id: true, kind: true, label: true, value: true, isActive: true, sortOrder: true, color: true },
    });
  }

  /** The stored values only — what the legacy endpoints return. */
  async listValues({ tenantId, kind }) {
    const rows = await this.list({ tenantId, kind });
    return rows.map((r) => r.value);
  }

  /** All three lists plus usage counts, for the admin screen. */
  async listAllWithUsage({ tenantId, includeArchived = true }) {
    const out = {};
    for (const kind of GOAL_OPTION_KINDS) {
      const rows = await this.list({ tenantId, kind, includeArchived });
      const field = kind === 'CATEGORY' ? 'category' : kind === 'TYPE' ? 'goalType' : 'priority';
      const usage = await prisma.goal.groupBy({
        by: [field],
        where: { tenantId },
        _count: { _all: true },
      });
      const usageMap = Object.fromEntries(usage.map((u) => [u[field], u._count._all]));
      out[kind] = rows.map((r) => ({ ...r, usageCount: usageMap[r.value] ?? 0 }));
    }
    return out;
  }

  async create({ tenantId, kind, label, value, color, sortOrder, createdBy }) {
    // Priority values are stored lowercase; the goal schema lowercases incoming
    // values, so the stored option has to match or nothing would ever validate.
    const storedValue = (value ?? label).trim();
    const finalValue = kind === 'PRIORITY' ? storedValue.toLowerCase() : storedValue;

    const existing = await prisma.goalOption.findFirst({
      where: { tenantId, kind, value: { equals: finalValue, mode: 'insensitive' } },
      select: { id: true, isActive: true },
    });
    if (existing) {
      // Re-adding an archived option restores it rather than colliding with the
      // unique index and returning a confusing 409.
      if (!existing.isActive) {
        return prisma.goalOption.update({
          where: { id: existing.id },
          data: { isActive: true, label: label.trim(), ...(color !== undefined ? { color } : {}) },
        });
      }
      throw Object.assign(new Error('That option already exists'), { status: 409 });
    }

    const last = await prisma.goalOption.findFirst({
      where: { tenantId, kind },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return prisma.goalOption.create({
      data: {
        tenantId,
        kind,
        label: label.trim(),
        value: finalValue,
        color: color ?? null,
        sortOrder: sortOrder ?? (last ? last.sortOrder + 1 : 0),
        createdBy: createdBy ?? null,
      },
    });
  }

  /**
   * Update an option. Renaming the stored `value` cascades to every goal holding
   * the old one — without that, those goals would drop out of the dropdown and
   * out of any filter built on it.
   */
  async update({ tenantId, id, label, value, color, sortOrder, isActive }) {
    const current = await prisma.goalOption.findFirst({
      where: { id, tenantId },
      select: { id: true, kind: true, value: true },
    });
    if (!current) throw Object.assign(new Error('Option not found'), { status: 404 });

    let nextValue;
    if (value !== undefined && value !== null) {
      nextValue = current.kind === 'PRIORITY' ? String(value).trim().toLowerCase() : String(value).trim();
      if (nextValue !== current.value) {
        const clash = await prisma.goalOption.findFirst({
          where: { tenantId, kind: current.kind, value: { equals: nextValue, mode: 'insensitive' }, id: { not: id } },
          select: { id: true },
        });
        if (clash) throw Object.assign(new Error('Another option already uses that value'), { status: 409 });
      }
    }

    const updated = await prisma.goalOption.update({
      where: { id },
      data: {
        ...(label !== undefined ? { label: String(label).trim() } : {}),
        ...(nextValue !== undefined ? { value: nextValue } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    if (nextValue !== undefined && nextValue !== current.value) {
      const field = current.kind === 'CATEGORY' ? 'category' : current.kind === 'TYPE' ? 'goalType' : 'priority';
      await prisma.goal.updateMany({
        where: { tenantId, [field]: current.value },
        data: { [field]: nextValue },
      });
    }

    return updated;
  }

  /** Archive. Goals keep their value; the option just leaves the dropdown. */
  async archive({ tenantId, id }) {
    const current = await prisma.goalOption.findFirst({
      where: { id, tenantId },
      select: { id: true, kind: true, value: true },
    });
    if (!current) throw Object.assign(new Error('Option not found'), { status: 404 });

    const field = current.kind === 'CATEGORY' ? 'category' : current.kind === 'TYPE' ? 'goalType' : 'priority';
    const inUse = await prisma.goal.count({ where: { tenantId, [field]: current.value } });

    // Refuse to leave a dropdown with nothing in it.
    const remaining = await prisma.goalOption.count({
      where: { tenantId, kind: current.kind, isActive: true, id: { not: id } },
    });
    if (remaining === 0) {
      throw Object.assign(new Error('At least one option must stay active for this list'), { status: 400 });
    }

    const archived = await prisma.goalOption.update({ where: { id }, data: { isActive: false } });
    return { option: archived, usageCount: inUse };
  }

  /** Values a goal may currently be saved with — used by validation. */
  async allowedValues({ tenantId, kind }) {
    await seedIfEmpty(tenantId, kind);
    const rows = await prisma.goalOption.findMany({
      where: { tenantId, kind, isActive: true },
      select: { value: true },
    });
    return rows.map((r) => r.value);
  }
}

export default new GoalOptionService();
