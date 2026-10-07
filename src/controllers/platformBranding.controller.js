/**
 * platformBranding.controller.js — Controller for platform branding and logo.
 */
import {
  getPlatformBranding,
  savePlatformBranding,
  resetPlatformBranding,
} from '../services/platformBranding.service.js';
import { platformBrandingSchema } from '../validations/platformBranding.schema.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';

/**
 * GET /platform/branding
 * Public endpoint: accessible to unauthenticated visitors (login, signup) and authenticated users alike.
 */
export async function getBranding(req, res, next) {
  try {
    const branding = await getPlatformBranding();
    res.json({ branding });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /platform/branding
 * Operator-only: updates platform logos, name, colors, and legal text.
 */
export async function updateBranding(req, res, next) {
  try {
    const parsed = platformBrandingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const previous = await getPlatformBranding();
    const updated = await savePlatformBranding(parsed.data, req.user?.id);

    // Audit the action
    await recordPlatformAction({
      action: PLATFORM_ACTIONS.BRANDING_UPDATED,
      actorId: req.user?.id,
      entityType: 'PLATFORM_BRANDING',
      entityId: 'singleton',
      metadata: {
        changedBy: req.user?.email,
        before: {
          platformName: previous.platformName,
          logoUrl: previous.logoUrl,
          iconUrl: previous.iconUrl,
        },
        after: {
          platformName: updated.platformName,
          logoUrl: updated.logoUrl,
          iconUrl: updated.iconUrl,
        },
      },
      req,
    }).catch((auditErr) => console.warn('[Branding] Failed to record audit log:', auditErr.message));

    res.json({
      branding: updated,
      message: 'Platform branding successfully updated.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /platform/branding/reset
 * Operator-only: resets branding to system defaults.
 */
export async function resetBranding(req, res, next) {
  try {
    const reset = await resetPlatformBranding(req.user?.id);

    await recordPlatformAction({
      action: PLATFORM_ACTIONS.BRANDING_UPDATED,
      actorId: req.user?.id,
      entityType: 'PLATFORM_BRANDING',
      entityId: 'singleton',
      metadata: {
        action: 'RESET_TO_DEFAULTS',
        resetBy: req.user?.email,
      },
      req,
    }).catch((auditErr) => console.warn('[Branding] Failed to record audit log:', auditErr.message));

    res.json({
      branding: reset,
      message: 'Platform branding reset to defaults.',
    });
  } catch (err) {
    next(err);
  }
}
