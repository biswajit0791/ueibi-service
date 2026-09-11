/**
 * passwordPolicy.js
 *
 * Minimum password strength rules, shared by onboarding and password reset.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * @param {string} password
 * @returns {{ ok: boolean, message?: string }}
 */
export function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long` };
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, message: 'Password must contain at least one letter and one number' };
  }
  return { ok: true };
}
