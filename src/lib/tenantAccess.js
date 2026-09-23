/**
 * Which tenant lifecycle states deny access, and what to tell the user.
 *
 * Defined once because two places enforce it — the login controller and
 * requireAuth — and if they drift, a company is either locked out of the app
 * while still able to sign in, or the reverse.
 *
 * TRIAL and GRACE_PERIOD are deliberately absent: a grace period exists
 * precisely so a lapsed customer keeps working while payment is resolved.
 */
export const DENIED_TENANT_STATES = {
  SUSPENDED: {
    code: 'TENANT_SUSPENDED',
    message: 'This company account is suspended. Please contact your administrator.',
  },
  EXPIRED: {
    code: 'TENANT_EXPIRED',
    message: 'This company subscription has expired. Please contact your administrator.',
  },
  CANCELLED: {
    code: 'TENANT_CANCELLED',
    message: 'This company account has been closed. Please contact your administrator.',
  },
};

/** The denial for a tenant status, or null when access is allowed. */
export function tenantAccessDenial(status) {
  return DENIED_TENANT_STATES[status] || null;
}
