import crypto from 'node:crypto';

/**
 * Generates a cryptographically secure numeric OTP of configured length (default: 6).
 *
 * @param {number} [length=6] Number of digits (4, 6, 8, etc.)
 * @returns {string} Zero-padded numeric OTP string
 */
export function generateOtp(length = 6) {
  const digits = Math.max(4, Math.min(10, parseInt(length, 10) || 6));
  const max = Math.pow(10, digits);
  return String(crypto.randomInt(0, max)).padStart(digits, '0');
}

export function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

export function verifyOtpHash(otp, hash) {
  if (!otp || !hash) return false;
  const candidate = Buffer.from(hashOtp(String(otp).trim()));
  const expected = Buffer.from(String(hash).trim());
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}
