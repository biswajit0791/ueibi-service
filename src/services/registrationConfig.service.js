import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import {
  DEFAULT_CONFIGURATIONS,
  seedRegistrationConfigurations,
} from '../../scripts/seed-registration-configurations.js';

// In-memory cache for ultra-fast reads without database bottlenecks
let _configCache = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 30000; // 30-second TTL; invalidated immediately on mutations

export function invalidateConfigCache() {
  _configCache = null;
  _cacheExpiry = 0;
}

/**
 * Casts stored string values to their native JavaScript types based on dataType.
 */
export function parseConfigValue(rawValue, dataType) {
  if (rawValue === null || rawValue === undefined) return null;
  switch (dataType) {
    case 'NUMBER': {
      const num = parseFloat(rawValue);
      return Number.isNaN(num) ? 0 : num;
    }
    case 'PERCENT': {
      const pct = parseFloat(rawValue);
      return Number.isNaN(pct) ? 0 : pct;
    }
    case 'BOOLEAN':
      return rawValue === 'true' || rawValue === true || rawValue === '1' || rawValue === 1;
    case 'STRING':
    default:
      return String(rawValue);
  }
}

/**
 * Validates value formatting and constraints per configuration key.
 */
export function validateConfigValue(key, value) {
  const strVal = String(value).trim();

  switch (key) {
    case 'LICENSE_UNIT_PRICE': {
      const price = parseFloat(strVal);
      if (Number.isNaN(price) || price < 1) {
        throw new Error('Employee License Unit Price must be a positive number (minimum ₹1).');
      }
      return strVal;
    }
    case 'GST_RATE': {
      const rate = parseFloat(strVal);
      if (Number.isNaN(rate) || rate < 0 || rate > 1) {
        throw new Error('GST Rate must be a valid decimal between 0 and 1 (e.g. 0.18 for 18%).');
      }
      return strVal;
    }
    case 'MIN_LICENSE_QUANTITY': {
      const qty = parseInt(strVal, 10);
      if (Number.isNaN(qty) || qty < 1) {
        throw new Error('Minimum License Purchase Quantity must be at least 1.');
      }
      return String(qty);
    }
    case 'MAX_LICENSE_QUANTITY': {
      const qty = parseInt(strVal, 10);
      if (Number.isNaN(qty) || qty < 1) {
        throw new Error('Maximum License Purchase Quantity must be at least 1.');
      }
      return String(qty);
    }
    case 'OTP_TTL_MINUTES': {
      const mins = parseInt(strVal, 10);
      if (Number.isNaN(mins) || mins < 1 || mins > 120) {
        throw new Error('OTP Expiry Time must be between 1 and 120 minutes.');
      }
      return String(mins);
    }
    case 'OTP_MAX_ATTEMPTS': {
      const attempts = parseInt(strVal, 10);
      if (Number.isNaN(attempts) || attempts < 1 || attempts > 20) {
        throw new Error('Maximum OTP Verification Attempts must be between 1 and 20.');
      }
      return String(attempts);
    }
    case 'OTP_RESEND_COOLDOWN_SECONDS': {
      const secs = parseInt(strVal, 10);
      if (Number.isNaN(secs) || secs < 0 || secs > 600) {
        throw new Error('OTP Resend Cooldown must be between 0 and 600 seconds.');
      }
      return String(secs);
    }
    case 'OTP_MAX_RESEND_ATTEMPTS': {
      const attempts = parseInt(strVal, 10);
      if (Number.isNaN(attempts) || attempts < 1 || attempts > 20) {
        throw new Error('Maximum Resend Attempts must be between 1 and 20.');
      }
      return String(attempts);
    }
    case 'OTP_LENGTH': {
      const len = parseInt(strVal, 10);
      if (Number.isNaN(len) || (len !== 4 && len !== 6 && len !== 8)) {
        throw new Error('OTP Length must be 4, 6, or 8 digits.');
      }
      return String(len);
    }
    case 'ACTION_TOKEN_TTL_DAYS': {
      const days = parseInt(strVal, 10);
      if (Number.isNaN(days) || days < 1 || days > 365) {
        throw new Error('Action Token Expiry must be between 1 and 365 days.');
      }
      return String(days);
    }
    case 'CURRENCY': {
      if (!strVal || strVal.length > 10) {
        throw new Error('Currency code must be non-empty and max 10 characters.');
      }
      return strVal.toUpperCase();
    }
    case 'TAX_DISPLAY_NAME': {
      if (!strVal || strVal.length > 20) {
        throw new Error('Tax Display Name must be non-empty and max 20 characters.');
      }
      return strVal;
    }
    case 'TAX_CALCULATION_METHOD': {
      const upper = strVal.toUpperCase();
      if (upper !== 'EXCLUSIVE' && upper !== 'INCLUSIVE') {
        throw new Error('Tax Calculation Method must be EXCLUSIVE or INCLUSIVE.');
      }
      return upper;
    }
    case 'LICENSE_PRICING_ACTIVE':
    case 'TAX_ENABLED':
    case 'TAX_ACTIVE':
    case 'ACTION_TOKEN_ENABLED':
    case 'LOGIN_2FA_ENABLED': {
      const boolVal = strVal.toLowerCase();
      if (boolVal !== 'true' && boolVal !== 'false') {
        throw new Error('Status value must be "true" or "false".');
      }
      return boolVal;
    }
    case 'LOGIN_2FA_ENFORCEMENT': {
      const upper = strVal.toUpperCase();
      if (upper !== 'MANDATORY' && upper !== 'OPTIONAL') {
        throw new Error('2FA Enforcement Mode must be MANDATORY or OPTIONAL.');
      }
      return upper;
    }
    case 'LOGIN_2FA_ROLES': {
      if (!strVal) {
        throw new Error('2FA Enforced Roles cannot be empty (use "ALL" or comma-separated roles).');
      }
      return strVal.toUpperCase();
    }
    case 'LOGIN_MAX_ACTIVE_CHALLENGES': {
      const qty = parseInt(strVal, 10);
      if (Number.isNaN(qty) || qty < 1 || qty > 50) {
        throw new Error('Max Active Login Challenges must be between 1 and 50.');
      }
      return String(qty);
    }
    default:
      return strVal;
  }
}

/**
 * Loads all active configurations into memory cache.
 */
async function loadConfigCache(force = false) {
  const now = Date.now();
  if (!force && _configCache && now < _cacheExpiry) {
    return _configCache;
  }

  let items = await prisma.registrationConfiguration.findMany({
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });

  // Cold start or unseeded table fallback
  if (!items || items.length === 0) {
    await seedRegistrationConfigurations();
    items = await prisma.registrationConfiguration.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
  }

  const map = new Map();
  for (const item of items) {
    map.set(item.key, {
      ...item,
      parsedValue: parseConfigValue(item.value, item.dataType),
    });
  }

  _configCache = map;
  _cacheExpiry = now + CACHE_TTL_MS;
  return _configCache;
}

/**
 * Centralized reader for dynamic configuration.
 * Returns parsed value with fallback to .env or initial default.
 */
export async function getRegistrationConfig(key, fallback = null) {
  try {
    const cache = await loadConfigCache();
    const cfg = cache.get(key);
    if (!cfg) return fallback;
    if (cfg.isActive === false) return fallback;
    return cfg.parsedValue;
  } catch (err) {
    console.error(`[CONFIG_SERVICE] Failed to read "${key}" from database. Using fallback.`, err.message);
    return fallback;
  }
}

/**
 * Returns all configuration records for Platform Owner dashboard.
 */
export async function getAllRegistrationConfigs() {
  const cache = await loadConfigCache(true);
  return Array.from(cache.values());
}

/**
 * Updates a single configuration with atomic audit logging.
 */
export async function updateRegistrationConfig({
  key,
  value,
  isActive = undefined,
  actor = 'PLATFORM_OWNER',
  reason = 'Admin configuration update',
  ipAddress = null,
  userAgent = null,
}) {
  const validatedValue = validateConfigValue(key, value);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.registrationConfiguration.findUnique({
      where: { key },
    });

    if (!existing) {
      throw new Error(`Configuration key "${key}" not found.`);
    }

    const updated = await tx.registrationConfiguration.update({
      where: { key },
      data: {
        value: validatedValue,
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        updatedBy: actor,
      },
    });

    await tx.registrationConfigurationAudit.create({
      data: {
        configurationId: updated.id,
        key: updated.key,
        oldValue: existing.value,
        newValue: updated.value,
        category: updated.category,
        reason,
        changedBy: actor,
        ipAddress,
        userAgent,
      },
    });

    return updated;
  });

  invalidateConfigCache();
  return {
    ...result,
    parsedValue: parseConfigValue(result.value, result.dataType),
  };
}

/**
 * Bulk updates multiple configuration settings atomically in a single transaction.
 */
export async function bulkUpdateRegistrationConfigs({
  configs = [],
  actor = 'PLATFORM_OWNER',
  reason = 'Bulk settings update',
  ipAddress = null,
  userAgent = null,
}) {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error('Configurations array must be non-empty.');
  }

  // Pre-validate all values before initiating database transaction
  const validatedList = configs.map((cfg) => {
    if (!cfg.key) throw new Error('Each configuration item must have a key.');
    const validatedVal = validateConfigValue(cfg.key, cfg.value);
    return {
      key: cfg.key,
      value: validatedVal,
      isActive: cfg.isActive,
    };
  });

  const updatedRecords = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const item of validatedList) {
      const existing = await tx.registrationConfiguration.findUnique({
        where: { key: item.key },
      });

      if (!existing) continue;

      const updated = await tx.registrationConfiguration.update({
        where: { key: item.key },
        data: {
          value: item.value,
          ...(item.isActive !== undefined ? { isActive: Boolean(item.isActive) } : {}),
          updatedBy: actor,
        },
      });

      await tx.registrationConfigurationAudit.create({
        data: {
          configurationId: updated.id,
          key: updated.key,
          oldValue: existing.value,
          newValue: updated.value,
          category: updated.category,
          reason,
          changedBy: actor,
          ipAddress,
          userAgent,
        },
      });

      results.push(updated);
    }
    return results;
  });

  invalidateConfigCache();
  return updatedRecords.map((r) => ({
    ...r,
    parsedValue: parseConfigValue(r.value, r.dataType),
  }));
}

/**
 * Restores configurations to standard system defaults.
 */
export async function restoreDefaultConfigurations({
  actor = 'PLATFORM_OWNER',
  reason = 'Restored to system defaults',
  ipAddress = null,
  userAgent = null,
}) {
  const restored = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const def of DEFAULT_CONFIGURATIONS) {
      const existing = await tx.registrationConfiguration.findUnique({
        where: { key: def.key },
      });

      if (!existing) continue;

      const updated = await tx.registrationConfiguration.update({
        where: { key: def.key },
        data: {
          value: def.value,
          isActive: def.isActive,
          updatedBy: actor,
        },
      });

      await tx.registrationConfigurationAudit.create({
        data: {
          configurationId: updated.id,
          key: updated.key,
          oldValue: existing.value,
          newValue: def.value,
          category: updated.category,
          reason,
          changedBy: actor,
          ipAddress,
          userAgent,
        },
      });

      results.push(updated);
    }
    return results;
  });

  invalidateConfigCache();
  return restored.map((r) => ({
    ...r,
    parsedValue: parseConfigValue(r.value, r.dataType),
  }));
}

/**
 * Retrieves audit history log for Platform Owner review.
 */
export async function getConfigurationAuditHistory({
  limit = 50,
  key = null,
  category = null,
} = {}) {
  const where = {};
  if (key) where.key = key;
  if (category) where.category = category;

  return prisma.registrationConfigurationAudit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, limit), 200),
  });
}

