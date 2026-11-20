function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeDiscount(subtotal, coupon) {
  if (!coupon) return 0;
  if (coupon.discountType === 'PERCENT') {
    return round2((subtotal * Number(coupon.discountValue)) / 100);
  }
  return round2(Math.min(Number(coupon.discountValue), subtotal));
}

export function computePricing({ quantity, unitPrice, coupon, gstRate }) {
  const subtotal = round2(quantity * unitPrice);
  const discountAmount = computeDiscount(subtotal, coupon);
  const discountedSubtotal = round2(subtotal - discountAmount);
  const gstAmount = round2(discountedSubtotal * gstRate);
  const total = round2(discountedSubtotal + gstAmount);

  return {
    unitPrice: round2(unitPrice),
    subtotal,
    discountAmount,
    discountedSubtotal,
    gstRate,
    gstAmount,
    total,
  };
}

export function normalizeCompanyName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function couponValidationError(coupon, context = {}) {
  if (!coupon) return 'Coupon not found';
  if (!coupon.active) return 'Coupon is inactive';
  if (coupon.status === 'USED') return 'Coupon has already been used';
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
    return 'Coupon has expired';
  }
  if (coupon.usageLimit != null && coupon.timesUsed >= coupon.usageLimit) {
    return 'Coupon usage limit reached';
  }

  // Company-Specific Offer Validations
  if (coupon.companyName && context.companyName !== undefined) {
    const inputCompany = String(context.companyName || '').trim();
    if (!inputCompany) {
      return `This offer is exclusively reserved for "${coupon.companyName}". Please enter your registered company legal name to proceed.`;
    }
    const normCouponCo = normalizeCompanyName(coupon.companyName);
    const normInputCo = normalizeCompanyName(inputCompany);
    if (normCouponCo !== normInputCo) {
      return `This coupon was issued exclusively for "${coupon.companyName}" and cannot be used for "${inputCompany}".`;
    }
  }

  if (coupon.companyName && coupon.totalLicenses != null && context.totalLicenses !== undefined && context.totalLicenses !== null) {
    const requiredSeats = Number(coupon.totalLicenses);
    const requestedSeats = Number(context.totalLicenses);
    if (requiredSeats && requestedSeats && requestedSeats !== requiredSeats) {
      return `This coupon requires exactly ${requiredSeats} licence(s). Your current selection is for ${requestedSeats} licence(s). Please adjust your employee seats to match the offer.`;
    }
  }

  return null;
}
