import {
  getAllRegistrationConfigs,
  updateRegistrationConfig,
  bulkUpdateRegistrationConfigs,
  restoreDefaultConfigurations,
  getConfigurationAuditHistory,
} from '../services/registrationConfig.service.js';

function getIpAddress(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

function getUserAgent(req) {
  return String(req.headers?.['user-agent'] || '').slice(0, 1000) || null;
}

function getActorIdentifier(req) {
  return req.user?.email || req.user?.name || req.user?.id || 'PLATFORM_OWNER';
}

/**
 * GET /api/platform-admin/registration-configurations
 */
export async function listConfigurations(req, res, next) {
  try {
    const items = await getAllRegistrationConfigs();
    res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/platform-admin/registration-configurations/:key
 */
export async function getConfigurationByKey(req, res, next) {
  try {
    const { key } = req.params;
    const items = await getAllRegistrationConfigs();
    const item = items.find((c) => c.key === key.toUpperCase());
    if (!item) {
      return res.status(404).json({ error: `Configuration "${key}" not found.` });
    }
    res.json({ item });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/platform-admin/registration-configurations/:key
 */
export async function updateConfiguration(req, res, next) {
  try {
    const { key } = req.params;
    const { value, isActive, reason } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'Field "value" is required.' });
    }

    const updated = await updateRegistrationConfig({
      key: key.toUpperCase(),
      value,
      isActive,
      actor: getActorIdentifier(req),
      reason: reason || 'Platform Owner manual update',
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    res.json({
      message: `Configuration "${updated.key}" updated successfully.`,
      item: updated,
    });
  } catch (err) {
    if (err.message.includes('must be') || err.message.includes('not found')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * PUT /api/platform-admin/registration-configurations/bulk
 */
export async function bulkUpdateConfigurations(req, res, next) {
  try {
    const { configs, reason } = req.body;

    if (!Array.isArray(configs) || configs.length === 0) {
      return res.status(400).json({ error: 'Field "configs" must be a non-empty array.' });
    }

    const updated = await bulkUpdateRegistrationConfigs({
      configs,
      actor: getActorIdentifier(req),
      reason: reason || 'Platform Owner bulk settings update',
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    res.json({
      message: 'Configurations updated successfully.',
      items: updated,
      count: updated.length,
    });
  } catch (err) {
    if (err.message.includes('must be') || err.message.includes('valid')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * POST /api/platform-admin/registration-configurations/restore-defaults
 */
export async function restoreDefaults(req, res, next) {
  try {
    const { reason } = req.body;

    const restored = await restoreDefaultConfigurations({
      actor: getActorIdentifier(req),
      reason: reason || 'Platform Owner restored default settings',
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    res.json({
      message: 'All configurations have been successfully restored to initial system defaults.',
      items: restored,
      count: restored.length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/platform-admin/registration-configurations/history
 */
export async function getConfigurationHistory(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const key = req.query.key ? String(req.query.key).toUpperCase() : null;
    const category = req.query.category ? String(req.query.category).toUpperCase() : null;

    const history = await getConfigurationAuditHistory({ limit, key, category });
    res.json({ items: history, count: history.length });
  } catch (err) {
    next(err);
  }
}

