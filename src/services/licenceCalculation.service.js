import { computePricing } from '../lib/pricing.js';
import { getRegistrationConfig } from './registrationConfig.service.js';
import { env } from '../config/env.js';
import { findEligiblePromotion, calculateSubscriptionExtension } from './promotion.service.js';

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

  const couponYears = Number(options.coupon?.subscriptionYears) > 0
    ? Number(options.coupon.subscriptionYears)
    : 1;
  const basePaidMonths = options.termMonths || (couponYears * 12);

  // Resolve promotional extension benefits (Buy X Get Y Free)
  const startsAt = options.startsAt ? new Date(options.startsAt) : new Date();
  let promo = null;
  try {
    promo = await findEligiblePromotion({
      packageId: options.packageId || null,
      termMonths: basePaidMonths,
      seatCount: totalLicenses,
      context: 'NEW_REGISTRATIONS',
      coupon: options.coupon || null,
      code: options.promoCode || null,
    });
  } catch (err) {
    console.warn('[PRICING] Failed to resolve promotion:', err.message);
  }

  // Incorporate bonus promotional months from BDM company offer coupon
  const couponPromoMonths = options.coupon?.promoMonths ? Math.max(0, parseInt(options.coupon.promoMonths, 10) || 0) : 0;
  if (couponPromoMonths > 0) {
    if (promo) {
      promo = {
        ...promo,
        paidMonths: basePaidMonths,
        freeMonths: (promo.freeMonths || 0) + couponPromoMonths,
        totalMonths: basePaidMonths + (promo.freeMonths || 0) + couponPromoMonths,
      };
    } else {
      promo = {
        id: options.coupon.id,
        name: `BDM Offer Promo (+${couponPromoMonths} Month${couponPromoMonths > 1 ? 's' : ''})`,
        code: options.coupon.code,
        paidMonths: basePaidMonths,
        freeMonths: couponPromoMonths,
        totalMonths: basePaidMonths + couponPromoMonths,
        badgeText: `+${couponPromoMonths} MONTHS PROMO FREE`,
      };
    }
  }

  const ext = calculateSubscriptionExtension({
    startsAt,
    termMonths: basePaidMonths,
    promotion: promo,
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

    // Subscription Duration Visibility & Snapshot
    paidDurationMonths: ext.paidDurationMonths,
    freeDurationMonths: ext.freeDurationMonths,
    totalDurationMonths: ext.totalDurationMonths,
    startsAt: ext.startsAt,
    paidEndsAt: ext.paidEndsAt,
    endsAt: ext.endsAt,
    expectedExpiryDate: ext.endsAt,
    promotion: ext.promotion,
    promotionName: ext.promotion?.name || null,
    promoCode: ext.promotion?.code || null,
  };
}

/**
 * Dynamically validates requested license quantity against authoritative Billing Settings.
 * Single source of truth: MIN_LICENSE_QUANTITY and MAX_LICENSE_QUANTITY in registration configs.
 *
 * @param {number|string} quantity
 * @returns {Promise<{valid: boolean, error?: string, code?: string, totalLicenses?: number, minQuantity: number, maxQuantity: number}>}
 */
export async function validateLicenseQuantity(quantity) {
  const [minQtyConfig, maxQtyConfig] = await Promise.all([
    getRegistrationConfig('MIN_LICENSE_QUANTITY', 1),
    getRegistrationConfig('MAX_LICENSE_QUANTITY', 10000),
  ]);
  const minQuantity = Math.max(1, parseInt(minQtyConfig, 10) || 1);
  const maxQuantity = Math.max(minQuantity, parseInt(maxQtyConfig, 10) || 10000);
  const qty = parseInt(quantity, 10);

  if (Number.isNaN(qty) || qty < minQuantity) {
    const errorMsg = minQuantity === 1
      ? 'Minimum 1 employee license is required.'
      : `Minimum ${minQuantity} employee licenses are required.`;
    return {
      valid: false,
      error: errorMsg,
      code: 'MIN_LICENSE_QUANTITY_NOT_MET',
      minQuantity,
      maxQuantity,
    };
  }

  if (qty > maxQuantity) {
    return {
      valid: false,
      error: `Maximum ${maxQuantity} employee licenses are allowed.`,
      code: 'MAX_LICENSE_QUANTITY_EXCEEDED',
      minQuantity,
      maxQuantity,
    };
  }

  return {
    valid: true,
    totalLicenses: qty,
    minQuantity,
    maxQuantity,
  };
}

