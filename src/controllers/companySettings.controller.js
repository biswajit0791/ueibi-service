import { prisma } from '../lib/prisma.js';
import { getCompanySettings, updateCompanySettings, normaliseDomain } from '../services/companySettings.service.js';
import { updateCompanySettingsSchema } from '../validations/companySettings.schema.js';

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
      settings: {
        milestoneWatcherDomains: settings.milestoneWatcherDomains,
        milestoneRequireApproval: settings.milestoneRequireApproval,
        updatedAt: settings.updatedAt,
      },
      // The tenant's own registered domain is always an allowed watcher
      // domain too, even though it isn't stored in milestoneWatcherDomains.
      tenantDomain: tenant?.domainName || null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/company/settings ───────────────────────────────────────────
// HR / ADMIN / SUPER_ADMIN / CMD only (enforced by the route's `authorize`).
export async function patchSettings(req, res, next) {
  try {
    const parsed = updateCompanySettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const { milestoneWatcherDomains, milestoneRequireApproval } = parsed.data;
    const updated = await updateCompanySettings(req.tenantId, {
      milestoneWatcherDomains: milestoneWatcherDomains?.map(normaliseDomain),
      milestoneRequireApproval,
    });

    res.json({
      settings: {
        milestoneWatcherDomains: updated.milestoneWatcherDomains,
        milestoneRequireApproval: updated.milestoneRequireApproval,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
}
