import path from 'node:path';
import fs from 'node:fs';
import { Prisma } from '@prisma/client';
import { DEFAULT_WORK_SCHEDULE } from '../services/workSchedule.service.js';
import { prisma } from '../lib/prisma.js';
import { getCompanySettings, updateCompanySettings, normaliseDomain } from '../services/companySettings.service.js';
import { updateCompanySettingsSchema } from '../validations/companySettings.schema.js';
import { getTenantFinancialYear } from '../lib/financialYear.js';

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');

// Appearance is narrower than the rest of Company Settings: CMD may change
// milestone rules but not the company's look.
const THEME_EDITOR_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

function presentSettings(settings, tenant) {
  const fy = getTenantFinancialYear(settings);
  const logoUrl = settings.logoUrl || tenant?.logoUrl || settings.theme?.logoUrl || null;
  return {
    milestoneWatcherDomains: settings.milestoneWatcherDomains,
    milestoneRequireApproval: settings.milestoneRequireApproval,
    milestoneAlertEnabled: settings.milestoneAlertEnabled,
    milestoneAlertDaysBefore: settings.milestoneAlertDaysBefore,
    milestoneAlertFrequencyDays: settings.milestoneAlertFrequencyDays,
    milestoneAlertOnlyNoProgress: settings.milestoneAlertOnlyNoProgress,
    milestoneAlertSubject: settings.milestoneAlertSubject,
    milestoneAlertBody: settings.milestoneAlertBody,
    theme: settings.theme ? { ...settings.theme, logoUrl: settings.theme.logoUrl || logoUrl } : (logoUrl ? { logoUrl } : null),
    logoUrl,
    workingHours: settings.workingHours || DEFAULT_WORK_SCHEDULE,
    financialYearStartMonth: settings.financialYearStartMonth || 4,
    financialYearStartDay: settings.financialYearStartDay || 1,
    currentFinancialYear: {
      label: fy.label,
      startDate: fy.startDateStr,
      endDate: fy.endDateStr,
      startMonth: fy.startMonth,
      startDay: fy.startDay,
    },
    updatedAt: settings.updatedAt,
  };
}

// ─── GET /api/company/settings ─────────────────────────────────────────────
// Any authenticated tenant user may read it — the milestone controller needs
// it to validate watcher emails regardless of who's adding them.
export async function getSettings(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const [tenant, settings] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { domainName: true, logoUrl: true } }),
      getCompanySettings(tenantId),
    ]);

    res.json({
      settings: presentSettings(settings, tenant),
      canEditTheme: THEME_EDITOR_ROLES.includes(String(req.user?.role || '').toUpperCase()),
      // The tenant's own registered domain is always an allowed watcher
      // domain too, even though it isn't stored in milestoneWatcherDomains.
      tenantDomain: tenant?.domainName || null,
      logoUrl: settings.logoUrl || tenant?.logoUrl || null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/company/settings ───────────────────────────────────────────
// HR / ADMIN / SUPER_ADMIN / CMD only (enforced by the route's `authorize`);
// the `theme` field additionally excludes CMD.
export async function patchSettings(req, res, next) {
  try {
    const parsed = updateCompanySettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const {
      milestoneWatcherDomains,
      milestoneRequireApproval,
      milestoneAlertEnabled,
      milestoneAlertDaysBefore,
      milestoneAlertFrequencyDays,
      milestoneAlertOnlyNoProgress,
      milestoneAlertSubject,
      milestoneAlertBody,
      theme,
      logoUrl,
      financialYearStartMonth,
      financialYearStartDay,
      workingHours,
    } = parsed.data;

    if ((theme !== undefined || logoUrl !== undefined) && !THEME_EDITOR_ROLES.includes(String(req.user?.role || '').toUpperCase())) {
      return res.status(403).json({ error: 'Only Super Admin, Admin or HR can change the company appearance.' });
    }

    const updated = await updateCompanySettings(req.tenantId, {
      milestoneWatcherDomains: milestoneWatcherDomains?.map(normaliseDomain),
      milestoneRequireApproval,
      milestoneAlertEnabled,
      milestoneAlertDaysBefore,
      milestoneAlertFrequencyDays,
      milestoneAlertOnlyNoProgress,
      milestoneAlertSubject,
      milestoneAlertBody,
      financialYearStartMonth,
      financialYearStartDay,
      workingHours,
      logoUrl,
      theme: theme === undefined || theme === null
        ? theme
        : { ...theme, updatedBy: { id: req.user.id, name: req.user.name || req.user.email }, updatedAt: new Date().toISOString() },
    });

    res.json({ settings: presentSettings(updated) });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/company/logo ────────────────────────────────────────────────
// Upload or update the tenant's company logo
export async function uploadCompanyLogo(req, res, next) {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Tenant context required' });
    }

    const logoUrl = req.file ? `/api/uploads/${req.file.filename}` : req.body.logoUrl;
    if (!logoUrl) {
      return res.status(400).json({ error: 'No logo file or logoUrl provided' });
    }

    // Tenant isolation: read and update strictly for current tenant
    const currentTenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { logoUrl: true },
    });

    if (currentTenant?.logoUrl && currentTenant.logoUrl !== logoUrl && currentTenant.logoUrl.startsWith('/api/uploads/')) {
      const oldFilename = path.basename(currentTenant.logoUrl);
      const oldPath = path.resolve(uploadDir, oldFilename);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { logoUrl },
    });

    const settings = await getCompanySettings(tenantId);
    const existingTheme = settings.theme && typeof settings.theme === 'object' ? settings.theme : {};
    await prisma.tenantSettings.upsert({
      where: { tenantId },
      update: {
        logoUrl,
        theme: {
          ...existingTheme,
          logoUrl,
          updatedBy: { id: req.user.id, name: req.user.name || req.user.email },
          updatedAt: new Date().toISOString(),
        },
      },
      create: {
        tenantId,
        logoUrl,
        theme: {
          logoUrl,
          updatedBy: { id: req.user.id, name: req.user.name || req.user.email },
          updatedAt: new Date().toISOString(),
        },
      },
    });

    res.json({
      message: 'Company logo uploaded successfully',
      logoUrl,
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/company/logo ──────────────────────────────────────────────
// Remove the tenant's company logo and restore default branding
export async function deleteCompanyLogo(req, res, next) {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: 'Tenant context required' });
    }

    const currentTenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { logoUrl: true },
    });

    if (currentTenant?.logoUrl && currentTenant.logoUrl.startsWith('/api/uploads/')) {
      const oldFilename = path.basename(currentTenant.logoUrl);
      const oldPath = path.resolve(uploadDir, oldFilename);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { logoUrl: null },
    });

    const settings = await getCompanySettings(tenantId);
    let updatedTheme = null;
    if (settings.theme && typeof settings.theme === 'object') {
      const { logoUrl, ...rest } = settings.theme;
      updatedTheme = Object.keys(rest).length > 0 ? rest : null;
    }

    await prisma.tenantSettings.upsert({
      where: { tenantId },
      update: {
        logoUrl: null,
        theme: updatedTheme === null ? Prisma.DbNull : updatedTheme,
      },
      create: {
        tenantId,
        logoUrl: null,
      },
    });

    res.json({
      message: 'Company logo removed successfully',
      logoUrl: null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/company/watcher-candidates ───────────────────────────────────
// Returns every active member (with designation) so any of them can be picked as a milestone watcher.
export async function getWatcherCandidates(req, res, next) {
  try {
    const employees = await prisma.tenantUser.findMany({
      where: {
        tenantId: req.tenantId,
        status: 'ACTIVE',
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        designation: true,
        managerId: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({ employees });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/company/top-level-employees ──────────────────────────────────
// Returns top-level employees (Leadership, CMD, Admin, HR, Directors) for Watcher selection.
export async function getTopLevelEmployees(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const TOP_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CMD', 'DIRECTOR', 'HR', 'LEADERSHIP'];

    const employees = await prisma.tenantUser.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        isDeleted: false,
        role: { in: TOP_ROLES },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        designation: true,
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });

    res.json({ employees });
  } catch (err) {
    next(err);
  }
}
