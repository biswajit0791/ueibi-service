import { computePricing } from '../lib/pricing.js';
import { getRegistrationConfig } from './registrationConfig.service.js';
import { env } from '../config/env.js';

/**
 * Calculates billable stakeholder accounts, additional seats, and transparent breakdown.
 * Core Rule: One person = One licence. Unique billable user accounts, not role assignments.
 *
 * @param {Object} params
 * @param {string} params.cmdEmail
 * @param {string} [params.hrEmail]
 * @param {boolean} [params.hrNotRequired]
 * @param {string} [params.financeEmail]
 * @param {boolean} [params.financeNotRequired]
 * @param {number} [params.additionalLicenses]
 * @param {number} [params.licenseQuantity]
 * @returns {Object} breakdown & total licenses
 */
export function calculateLicenceBreakdown({
  cmdEmail = '',
  hrEmail = '',
  hrNotRequired = false,
  financeEmail = '',
  financeNotRequired = false,
  additionalLicenses = 0,
  licenseQuantity,
}) {
  const cmd = (cmdEmail || '').trim().toLowerCase();
  const hr = hrNotRequired ? '' : (hrEmail || '').trim().toLowerCase();
  const fin = financeNotRequired ? '' : (financeEmail || '').trim().toLowerCase();

  const uniqueEmails = new Set();
  if (cmd) uniqueEmails.add(cmd);

  let hrStatus = 'NOT_REQUIRED';
  let hrBillable = false;
  if (!hrNotRequired) {
    if (!hr) {
      hrStatus = 'PENDING';
    } else if (cmd && hr === cmd) {
      hrStatus = 'HANDLED_BY_CMD';
    } else {
      uniqueEmails.add(hr);
      hrStatus = 'ASSIGNED';
      hrBillable = true;
    }
  }

  let finStatus = 'NOT_REQUIRED';
  let finBillable = false;
  if (!financeNotRequired) {
    if (!fin) {
      finStatus = 'PENDING';
    } else if (cmd && fin === cmd) {
      finStatus = 'HANDLED_BY_CMD';
    } else if (hr && fin === hr) {
      finStatus = 'COMBINED_WITH_HR';
    } else {
      uniqueEmails.add(fin);
      finStatus = 'ASSIGNED';
      finBillable = true;
    }
  }

  const stakeholderCount = Math.max(1, uniqueEmails.size);
  let additional = 0;
  if (additionalLicenses !== undefined && additionalLicenses !== null) {
    additional = Math.max(0, parseInt(additionalLicenses, 10) || 0);
  } else if (licenseQuantity !== undefined && licenseQuantity !== null) {
    additional = Math.max(0, (parseInt(licenseQuantity, 10) || stakeholderCount) - stakeholderCount);
  }

  const totalLicenses = stakeholderCount + additional;

  return {
    uniqueStakeholderEmails: Array.from(uniqueEmails),
    stakeholderCount,
    additionalLicenses: additional,
    totalLicenses,
    stakeholders: {
      cmd: {
        email: cmd,
        status: 'ASSIGNED',
        billable: true,
        role: 'SUPER_ADMIN',
        title: 'Chairman & Managing Director',
      },
      hr: {
        email: hr || null,
        notRequired: !!hrNotRequired,
        status: hrStatus,
        billable: hrBillable,
        role: 'HR',
        title: 'HR Head',
      },
      finance: {
        email: fin || null,
        notRequired: !!financeNotRequired,
        status: finStatus,
        billable: finBillable,
        role: 'FINANCE',
        title: 'Finance Head',
      },
    },
  };
}

/**
 * Calculates complete billing & license totals with dynamic Platform Owner configurations.
 *
 * @param {Object} params
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function computeRegistrationPricing(params = {}, options = {}) {
  const [unitPrice, gstRate, taxEnabled, currency] = await Promise.all([
    options.overrideUnitPrice !== undefined
      ? Number(options.overrideUnitPrice)
      : getRegistrationConfig('LICENSE_UNIT_PRICE', env.licenseUnitPrice || 3999),
    options.overrideGstRate !== undefined
      ? Number(options.overrideGstRate)
      : getRegistrationConfig('GST_RATE', env.gstRate || 0.18),
    options.taxEnabled !== undefined
      ? Boolean(options.taxEnabled)
      : getRegistrationConfig('TAX_ENABLED', true),
    getRegistrationConfig('CURRENCY', 'INR'),
  ]);

  const effectiveGstRate = taxEnabled ? gstRate : 0;
  const breakdown = calculateLicenceBreakdown(params);
  const totalLicenses = breakdown.totalLicenses;

  const pricing = computePricing({
    quantity: totalLicenses,
    unitPrice,
    coupon: options.coupon || null,
    gstRate: effectiveGstRate,
  });

  return {
    ...breakdown,
    unitPrice: pricing.unitPrice,
    subtotalAmount: pricing.subtotal,
    discountAmount: pricing.discountAmount,
    taxableAmount: pricing.discountedSubtotal,
    gstRate: pricing.gstRate,
    gstAmount: pricing.gstAmount,
    totalAmount: pricing.total,
    total: pricing.total,
    currency,
  };
}
