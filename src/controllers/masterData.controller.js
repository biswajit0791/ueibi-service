import { prisma } from '../lib/prisma.js';
import {
  cityCreateSchema,
  cityUpdateSchema,
  industryCreateSchema,
  industryUpdateSchema,
  subscriptionDurationCreateSchema,
  subscriptionDurationUpdateSchema,
  toggleStatusSchema,
} from '../validations/masterData.schema.js';
import { PLATFORM_ACTIONS, recordPlatformAction } from '../services/platformAudit.service.js';

// ══════════════════════════════════════════════════════════════════
// 1. CITIES MANAGEMENT CRUD
// ══════════════════════════════════════════════════════════════════

export async function listCities(req, res, next) {
  try {
    const {
      search = '',
      status = 'all',
      state = '',
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

    if (state && state.trim()) {
      where.state = { equals: state.trim(), mode: 'insensitive' };
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { state: { contains: q, mode: 'insensitive' } },
        { country: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items, statsGroup, allStates] = await Promise.all([
      prisma.cityMaster.count({ where }),
      prisma.cityMaster.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip,
        take: limitNum,
        include: {
          _count: {
            select: { coupons: true },
          },
        },
      }),
      prisma.cityMaster.groupBy({
        by: ['isActive'],
        _count: true,
      }),
      prisma.cityMaster.findMany({
        distinct: ['state'],
        select: { state: true },
        orderBy: { state: 'asc' },
      }),
    ]);

    const activeCount = statsGroup.find((s) => s.isActive)?._count || 0;
    const inactiveCount = statsGroup.find((s) => !s.isActive)?._count || 0;
    const totalCount = activeCount + inactiveCount;

    res.json({
      items: items.map((c) => ({
        ...c,
        usageCount: c._count.coupons,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      stats: {
        total: totalCount,
        active: activeCount,
        inactive: inactiveCount,
        statesCount: allStates.length,
      },
      states: allStates.map((s) => s.state).filter(Boolean),
    });
  } catch (err) {
    next(err);
  }
}

export async function getCityById(req, res, next) {
  try {
    const { id } = req.params;
    const city = await prisma.cityMaster.findUnique({
      where: { id },
      include: {
        _count: {
          select: { coupons: true },
        },
      },
    });

    if (!city) {
      return res.status(404).json({ error: 'City not found' });
    }

    res.json({
      ...city,
      usageCount: city._count.coupons,
    });
  } catch (err) {
    next(err);
  }
}

export async function createCity(req, res, next) {
  try {
    const data = cityCreateSchema.parse(req.body);

    // Prevent duplicate city records using normalized city name + state + country
    const existing = await prisma.cityMaster.findFirst({
      where: {
        name: { equals: data.name, mode: 'insensitive' },
        state: { equals: data.state, mode: 'insensitive' },
        country: { equals: data.country || 'India', mode: 'insensitive' },
      },
    });

    if (existing) {
      return res.status(409).json({
        error: `City "${data.name}" in state "${data.state}" (${data.country || 'India'}) already exists.`,
      });
    }

    const city = await prisma.cityMaster.create({
      data: {
        name: data.name,
        state: data.state,
        country: data.country || 'India',
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdBy: req.user?.id || null,
        updatedBy: req.user?.id || null,
      },
    });

    try {
      await recordPlatformAction({
        req,
        action: 'CITY_CREATED',
        targetType: 'CityMaster',
        targetId: city.id,
        afterValue: city,
      });
    } catch {
      // Non-critical audit error
    }

    res.status(201).json(city);
  } catch (err) {
    next(err);
  }
}

export async function updateCity(req, res, next) {
  try {
    const { id } = req.params;
    const data = cityUpdateSchema.parse(req.body);

    const existing = await prisma.cityMaster.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'City not found' });
    }

    const newName = data.name || existing.name;
    const newState = data.state || existing.state;
    const newCountry = data.country || existing.country;

    // Duplicate check excluding self
    const duplicate = await prisma.cityMaster.findFirst({
      where: {
        id: { not: id },
        name: { equals: newName, mode: 'insensitive' },
        state: { equals: newState, mode: 'insensitive' },
        country: { equals: newCountry, mode: 'insensitive' },
      },
    });

    if (duplicate) {
      return res.status(409).json({
        error: `Another city record for "${newName}", "${newState}" (${newCountry}) already exists.`,
      });
    }

    const updated = await prisma.cityMaster.update({
      where: { id },
      data: {
        ...data,
        updatedBy: req.user?.id || null,
      },
    });

    try {
      await recordPlatformAction({
        req,
        action: 'CITY_UPDATED',
        targetType: 'CityMaster',
        targetId: id,
        beforeValue: existing,
        afterValue: updated,
      });
    } catch {
      // Non-critical audit error
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function toggleCityStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { isActive } = toggleStatusSchema.parse(req.body);

    const existing = await prisma.cityMaster.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'City not found' });
    }

    const updated = await prisma.cityMaster.update({
      where: { id },
      data: {
        isActive,
        updatedBy: req.user?.id || null,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteCity(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.cityMaster.findUnique({
      where: { id },
      include: {
        _count: {
          select: { coupons: true },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'City not found' });
    }

    // Check dependency: either foreign key relation or historical string match
    const stringMatchCount = await prisma.coupon.count({
      where: {
        OR: [
          { cityId: id },
          { city: { equals: existing.name, mode: 'insensitive' } },
        ],
      },
    });

    const totalUsage = Math.max(existing._count.coupons, stringMatchCount);
    if (totalUsage > 0) {
      return res.status(400).json({
        error: `Cannot delete city "${existing.name}" because it is referenced by ${totalUsage} existing offer/coupon(s). Please deactivate it instead to prevent new selections.`,
        usageCount: totalUsage,
      });
    }

    await prisma.cityMaster.delete({ where: { id } });

    res.json({ message: 'City deleted successfully', id });
  } catch (err) {
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════
// 2. INDUSTRIES MANAGEMENT CRUD
// ══════════════════════════════════════════════════════════════════

export async function listIndustries(req, res, next) {
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
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items, statsGroup] = await Promise.all([
      prisma.industryMaster.count({ where }),
      prisma.industryMaster.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        skip,
        take: limitNum,
        include: {
          _count: {
            select: { coupons: true },
          },
        },
      }),
      prisma.industryMaster.groupBy({
        by: ['isActive'],
        _count: true,
      }),
    ]);

    const activeCount = statsGroup.find((s) => s.isActive)?._count || 0;
    const inactiveCount = statsGroup.find((s) => !s.isActive)?._count || 0;
    const totalCount = activeCount + inactiveCount;

    res.json({
      items: items.map((i) => ({
        ...i,
        usageCount: i._count.coupons,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      stats: {
        total: totalCount,
        active: activeCount,
        inactive: inactiveCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getIndustryById(req, res, next) {
  try {
    const { id } = req.params;
    const industry = await prisma.industryMaster.findUnique({
      where: { id },
      include: {
        _count: {
          select: { coupons: true },
        },
      },
    });

    if (!industry) {
      return res.status(404).json({ error: 'Industry not found' });
    }

    res.json({
      ...industry,
      usageCount: industry._count.coupons,
    });
  } catch (err) {
    next(err);
  }
}

export async function createIndustry(req, res, next) {
  try {
    const data = industryCreateSchema.parse(req.body);

    // Prevent duplicate industry names using case-insensitive validation
    const existing = await prisma.industryMaster.findFirst({
      where: {
        name: { equals: data.name, mode: 'insensitive' },
      },
    });

    if (existing) {
      return res.status(409).json({
        error: `Industry "${data.name}" already exists.`,
      });
    }

    const industry = await prisma.industryMaster.create({
      data: {
        name: data.name,
        description: data.description || null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdBy: req.user?.id || null,
        updatedBy: req.user?.id || null,
      },
    });

    res.status(201).json(industry);
  } catch (err) {
    next(err);
  }
}

export async function updateIndustry(req, res, next) {
  try {
    const { id } = req.params;
    const data = industryUpdateSchema.parse(req.body);

    const existing = await prisma.industryMaster.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Industry not found' });
    }

    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await prisma.industryMaster.findFirst({
        where: {
          id: { not: id },
          name: { equals: data.name, mode: 'insensitive' },
        },
      });

      if (duplicate) {
        return res.status(409).json({
          error: `Another industry named "${data.name}" already exists.`,
        });
      }
    }

    const updated = await prisma.industryMaster.update({
      where: { id },
      data: {
        ...data,
        updatedBy: req.user?.id || null,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function toggleIndustryStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { isActive } = toggleStatusSchema.parse(req.body);

    const existing = await prisma.industryMaster.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Industry not found' });
    }

    const updated = await prisma.industryMaster.update({
      where: { id },
      data: {
        isActive,
        updatedBy: req.user?.id || null,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteIndustry(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.industryMaster.findUnique({
      where: { id },
      include: {
        _count: {
          select: { coupons: true },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Industry not found' });
    }

    const stringMatchCount = await prisma.coupon.count({
      where: {
        OR: [
          { industryId: id },
          { industry: { equals: existing.name, mode: 'insensitive' } },
        ],
      },
    });

    const totalUsage = Math.max(existing._count.coupons, stringMatchCount);
    if (totalUsage > 0) {
      return res.status(400).json({
        error: `Cannot delete industry "${existing.name}" because it is referenced by ${totalUsage} existing offer/coupon(s). Please deactivate it instead.`,
        usageCount: totalUsage,
      });
    }

    await prisma.industryMaster.delete({ where: { id } });

    res.json({ message: 'Industry deleted successfully', id });
  } catch (err) {
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════
// 3. SUBSCRIPTION DURATION MANAGEMENT CRUD
// ══════════════════════════════════════════════════════════════════

export async function listSubscriptionDurations(req, res, next) {
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
      const numQ = parseInt(q, 10);
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        ...(isNaN(numQ) ? [] : [{ years: numQ }, { months: numQ }]),
      ];
    }

    const [total, items, statsGroup] = await Promise.all([
      prisma.subscriptionDurationMaster.count({ where }),
      prisma.subscriptionDurationMaster.findMany({
        where,
        orderBy: [
          { displayOrder: 'asc' },
          { years: 'asc' },
        ],
        skip,
        take: limitNum,
        include: {
          _count: {
            select: { coupons: true },
          },
        },
      }),
      prisma.subscriptionDurationMaster.groupBy({
        by: ['isActive'],
        _count: true,
      }),
    ]);

    const activeCount = statsGroup.find((s) => s.isActive)?._count || 0;
    const inactiveCount = statsGroup.find((s) => !s.isActive)?._count || 0;
    const totalCount = activeCount + inactiveCount;

    res.json({
      items: items.map((d) => ({
        ...d,
        usageCount: d._count.coupons,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      stats: {
        total: totalCount,
        active: activeCount,
        inactive: inactiveCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getSubscriptionDurationById(req, res, next) {
  try {
    const { id } = req.params;
    const duration = await prisma.subscriptionDurationMaster.findUnique({
      where: { id },
      include: {
        _count: {
          select: { coupons: true },
        },
      },
    });

    if (!duration) {
      return res.status(404).json({ error: 'Subscription duration not found' });
    }

    res.json({
      ...duration,
      usageCount: duration._count.coupons,
    });
  } catch (err) {
    next(err);
  }
}

export async function createSubscriptionDuration(req, res, next) {
  try {
    const data = subscriptionDurationCreateSchema.parse(req.body);

    const years = data.years;
    const months = years * 12;

    // Check duplicate years or name
    const existing = await prisma.subscriptionDurationMaster.findFirst({
      where: {
        OR: [
          { years },
          { name: { equals: data.name, mode: 'insensitive' } },
        ],
      },
    });

    if (existing) {
      return res.status(409).json({
        error: `Subscription duration with ${years} year(s) or name "${data.name}" already exists.`,
      });
    }

    const duration = await prisma.subscriptionDurationMaster.create({
      data: {
        name: data.name,
        years,
        months,
        displayOrder: data.displayOrder !== undefined ? data.displayOrder : years,
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdBy: req.user?.id || null,
        updatedBy: req.user?.id || null,
      },
    });

    res.status(201).json(duration);
  } catch (err) {
    next(err);
  }
}

export async function updateSubscriptionDuration(req, res, next) {
  try {
    const { id } = req.params;
    const data = subscriptionDurationUpdateSchema.parse(req.body);

    const existing = await prisma.subscriptionDurationMaster.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Subscription duration not found' });
    }

    const years = data.years !== undefined ? data.years : existing.years;
    const months = years * 12;
    const name = data.name !== undefined ? data.name : existing.name;

    const duplicate = await prisma.subscriptionDurationMaster.findFirst({
      where: {
        id: { not: id },
        OR: [
          { years },
          { name: { equals: name, mode: 'insensitive' } },
        ],
      },
    });

    if (duplicate) {
      return res.status(409).json({
        error: `Another duration with ${years} year(s) or name "${name}" already exists.`,
      });
    }

    const updated = await prisma.subscriptionDurationMaster.update({
      where: { id },
      data: {
        ...data,
        years,
        months,
        updatedBy: req.user?.id || null,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function toggleSubscriptionDurationStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { isActive } = toggleStatusSchema.parse(req.body);

    const existing = await prisma.subscriptionDurationMaster.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Subscription duration not found' });
    }

    const updated = await prisma.subscriptionDurationMaster.update({
      where: { id },
      data: {
        isActive,
        updatedBy: req.user?.id || null,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteSubscriptionDuration(req, res, next) {
  try {
    const { id } = req.params;

    const existing = await prisma.subscriptionDurationMaster.findUnique({
      where: { id },
      include: {
        _count: {
          select: { coupons: true },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Subscription duration not found' });
    }

    const couponCount = await prisma.coupon.count({
      where: {
        OR: [
          { subscriptionDurationId: id },
          { subscriptionYears: existing.years },
        ],
      },
    });

    const totalUsage = Math.max(existing._count.coupons, couponCount);
    if (totalUsage > 0) {
      return res.status(400).json({
        error: `Cannot delete subscription duration "${existing.name}" because it is referenced by ${totalUsage} existing offer/coupon(s). Please deactivate it instead.`,
        usageCount: totalUsage,
      });
    }

    await prisma.subscriptionDurationMaster.delete({ where: { id } });

    res.json({ message: 'Subscription duration deleted successfully', id });
  } catch (err) {
    next(err);
  }
}

// ══════════════════════════════════════════════════════════════════
// 4. ACTIVE CONSUMER MASTER DATA ENDPOINT
// ══════════════════════════════════════════════════════════════════

/**
 * Returns active cities, industries, and subscription durations for dropdowns / form controls.
 * Usable by authenticated users (BDM, Sales, Platform Owner).
 */
export async function getActiveMasterData(req, res, next) {
  try {
    const [cities, industries, durations] = await Promise.all([
      prisma.cityMaster.findMany({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }],
        select: {
          id: true,
          name: true,
          state: true,
          country: true,
        },
      }),
      prisma.industryMaster.findMany({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
        },
      }),
      prisma.subscriptionDurationMaster.findMany({
        where: { isActive: true },
        orderBy: [
          { displayOrder: 'asc' },
          { years: 'asc' },
        ],
        select: {
          id: true,
          name: true,
          years: true,
          months: true,
          displayOrder: true,
        },
      }),
    ]);

    res.json({
      cities,
      industries,
      durations,
    });
  } catch (err) {
    next(err);
  }
}
