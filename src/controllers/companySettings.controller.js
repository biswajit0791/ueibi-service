import { prisma } from '../lib/prisma.js';
import { getCompanySettings, updateCompanySettings, normaliseDomain } from '../services/companySettings.service.js';
import { updateCompanySettingsSchema } from '../validations/companySettings.schema.js';

// Appearance is narrower than the rest of Company Settings: CMD may change
// milestone rules but not the company's look.
const THEME_EDITOR_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

function presentSettings(settings) {
  return {
    milestoneWatcherDomains: settings.milestoneWatcherDomains,
    milestoneRequireApproval: settings.milestoneRequireApproval,
    theme: settings.theme ?? null,
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
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { domainName: true } }),
      getCompanySettings(tenantId),
    ]);

    res.json({
      settings: presentSettings(settings),
      canEditTheme: THEME_EDITOR_ROLES.includes(String(req.user?.role || '').toUpperCase()),
      // The tenant's own registered domain is always an allowed watcher
      // domain too, even though it isn't stored in milestoneWatcherDomains.
      tenantDomain: tenant?.domainName || null,
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

    const { milestoneWatcherDomains, milestoneRequireApproval, theme } = parsed.data;

    if (theme !== undefined && !THEME_EDITOR_ROLES.includes(String(req.user?.role || '').toUpperCase())) {
      return res.status(403).json({ error: 'Only Super Admin, Admin or HR can change the company appearance.' });
    }

    const updated = await updateCompanySettings(req.tenantId, {
      milestoneWatcherDomains: milestoneWatcherDomains?.map(normaliseDomain),
      milestoneRequireApproval,
      theme: theme === undefined || theme === null
        ? theme
        : { ...theme, updatedBy: { id: req.user.id, name: req.user.name || req.user.email }, updatedAt: new Date().toISOString() },
    });

    res.json({ settings: presentSettings(updated) });
  } catch (err) {
    next(err);
  }
}
