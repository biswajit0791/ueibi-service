/**
 * What an exited / deactivated employee is told when they try to sign in,
 * reset their password, or use a still-valid session.
 *
 * Defined once because login, forgot/reset password and requireAuth all
 * enforce it. This deliberately tells an ex-employee why they cannot get in
 * (instead of a generic "invalid" reply) so they know to contact HR for their
 * settlement or documents.
 */
export const ACCOUNT_EXITED = {
  code: 'ACCOUNT_EXITED',
  message:
    'Your access to this portal has been deactivated as you are no longer an active employee of the organisation. ' +
    'For relieving documents, full & final settlement or any other queries, please contact your HR team.',
};
