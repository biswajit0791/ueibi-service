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

export function couponValidationError(coupon) {
  if (!coupon) return 'Coupon not found';
  if (!coupon.active) return 'Coupon is inactive';
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) return 'Coupon has expired';
  if (coupon.usageLimit != null && coupon.timesUsed >= coupon.usageLimit) {
    return 'Coupon usage limit reached';
  }
  return null;
}
