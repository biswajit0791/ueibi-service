
import {
  listPlatformTickets, getPlatformTicket, replyPlatformTicket, updatePlatformTicketStatus
} from '../controllers/platformTicket.controller.js';
import {
  listSalesLeads, createSalesLead, updateSalesLead
} from '../controllers/sales.controller.js';
import {
  getPlatformHealth, setPlatformAnnouncement
} from '../controllers/platformHealth.controller.js';
import { Router } from 'express';
import {
  getPlatformOverview,
  getPlatformAlerts,
  listPlatformTenants,
  suspendTenant,
  restoreTenant,
  getPlatformAudit,
  getPlatformTenant,
  setTenantLifecycle,
  updateTenantLicences,
  listPlatformUsers,
  getPlatformUser,
  deactivatePlatformUser,
  reactivatePlatformUser,
  forceResetPlatformUser,
  listOnboarding,
  getOnboarding,
  resendOnboardingLink,
  sendRegistrationRoleLink,
  updateRegistrationRecipientEmail,
  reSignupRegistration,
  manualChequeVerify,
  refundRegistration,
  confirmPaymentRegistration,
  verifyRegistration,
  getRegistrationVerification,
} from '../controllers/platform.controller.js';
import {
  getBranding,
  updateBranding,
  resetBranding,
} from '../controllers/platformBranding.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner, requirePlatformStaff, requirePlatformMenu } from '../middleware/rbac.js';
import {
  listPlatformStaff,
  createPlatformStaff,
  updatePlatformStaff,
  directResetStaffPassword,
  getSalesPerformanceSummary,
  getStaffRenewalHistory,
  getStaffPermissions,
  updateStaffPermissions,
  getMyPlatformPermissions,
} from '../controllers/platformStaff.controller.js';
import {
  getPublicReviews,
  listAdminReviews,
  createCustomerReview,
  updateCustomerReview,
  deleteCustomerReview
} from '../controllers/customerReview.controller.js';
import {
  getLoginHistory,
  getLoginHistoryCompanies,
  getLoginHistoryUsers,
  getUserSessionsDetail,
  terminateUserSession,
  blockPlatformUser,
  unblockPlatformUser,
  exportLoginHistoryCsv,
  getLiveMonitoringMetrics,
  getLoginAnalytics,
} from '../controllers/loginHistory.controller.js';

const router = Router();

// Platform Branding: GET is public so Login & Auth pages load the brand before login
router.get('/platform/branding', getBranding);
router.put('/platform/branding', requireAuth, requirePlatformOwner, updateBranding);
router.post('/platform/branding/reset', requireAuth, requirePlatformOwner, resetBranding);

// Platform Overview & Alerts
router.get('/platform/overview', requireAuth, requirePlatformMenu('platform_overview'), getPlatformOverview);
router.get('/platform/alerts', requireAuth, requirePlatformMenu('platform_overview'), getPlatformAlerts);

// Companies & Tenant Management
router.get('/platform/tenants', requireAuth, requirePlatformMenu('companies'), listPlatformTenants);
router.get('/platform/tenants/:id', requireAuth, requirePlatformMenu('companies'), getPlatformTenant);
router.post('/platform/tenants/:id/lifecycle', requireAuth, requirePlatformOwner, setTenantLifecycle);
router.patch('/platform/tenants/:id/licences', requireAuth, requirePlatformOwner, updateTenantLicences);
router.post('/platform/tenants/:id/suspend', requireAuth, requirePlatformOwner, suspendTenant);
router.post('/platform/tenants/:id/restore', requireAuth, requirePlatformOwner, restoreTenant);

// Internal Team (formerly Sales Team) & Individual Menu Permissions
router.get('/platform/my-permissions', requireAuth, requirePlatformStaff, getMyPlatformPermissions);
router.get('/platform/staff', requireAuth, requirePlatformMenu('internal_team'), listPlatformStaff);
router.get('/platform/internal-team', requireAuth, requirePlatformMenu('internal_team'), listPlatformStaff);
router.post('/platform/staff', requireAuth, requirePlatformOwner, createPlatformStaff);
router.post('/platform/internal-team', requireAuth, requirePlatformOwner, createPlatformStaff);
router.patch('/platform/staff/:id', requireAuth, requirePlatformOwner, updatePlatformStaff);
router.post('/platform/staff/:id/direct-reset', requireAuth, requirePlatformOwner, directResetStaffPassword);
router.get('/platform/staff/:id/permissions', requireAuth, requirePlatformOwner, getStaffPermissions);
router.put('/platform/staff/:id/permissions', requireAuth, requirePlatformOwner, updateStaffPermissions);
router.get('/platform/staff/performance', requireAuth, requirePlatformMenu('internal_team'), getSalesPerformanceSummary);
router.get('/platform/staff/:id/renewals', requireAuth, requirePlatformMenu('internal_team'), getStaffRenewalHistory);

// Public Customer Reviews (for unauthenticated landing & marketing pages)
router.get('/public/reviews', getPublicReviews);

// Customer Reviews Management
router.get('/platform/reviews', requireAuth, requirePlatformMenu('customer_reviews'), listAdminReviews);
router.post('/platform/reviews', requireAuth, requirePlatformOwner, createCustomerReview);
router.patch('/platform/reviews/:id', requireAuth, requirePlatformOwner, updateCustomerReview);
router.delete('/platform/reviews/:id', requireAuth, requirePlatformOwner, deleteCustomerReview);

// Users Management
router.get('/platform/users', requireAuth, requirePlatformMenu('users'), listPlatformUsers);
router.get('/platform/users/:id', requireAuth, requirePlatformMenu('users'), getPlatformUser);
router.post('/platform/users/:id/deactivate', requireAuth, requirePlatformOwner, deactivatePlatformUser);
router.post('/platform/users/:id/reactivate', requireAuth, requirePlatformOwner, reactivatePlatformUser);
router.post('/platform/users/:id/force-reset', requireAuth, requirePlatformOwner, forceResetPlatformUser);

// Login History & Usage Management
router.get('/platform/login-history', requireAuth, requirePlatformMenu('login_history'), getLoginHistory);
router.get('/platform/login-history/metrics', requireAuth, requirePlatformMenu('login_history'), getLiveMonitoringMetrics);
router.get('/platform/login-history/analytics', requireAuth, requirePlatformMenu('login_history'), getLoginAnalytics);
router.get('/platform/login-history/companies', requireAuth, requirePlatformMenu('login_history'), getLoginHistoryCompanies);
router.get('/platform/login-history/users', requireAuth, requirePlatformMenu('login_history'), getLoginHistoryUsers);
router.get('/platform/login-history/users/:userId', requireAuth, requirePlatformMenu('login_history'), getUserSessionsDetail);
router.post('/platform/login-history/sessions/:sessionId/terminate', requireAuth, requirePlatformOwner, terminateUserSession);
router.post('/platform/login-history/users/:userId/block', requireAuth, requirePlatformOwner, blockPlatformUser);
router.post('/platform/login-history/users/:userId/unblock', requireAuth, requirePlatformOwner, unblockPlatformUser);
router.get('/platform/login-history/export', requireAuth, requirePlatformMenu('login_history'), exportLoginHistoryCsv);

// Onboarding queue and verification review
router.get('/platform/registrations', requireAuth, requirePlatformMenu('onboarding'), listOnboarding);
router.get('/platform/registrations/:id', requireAuth, requirePlatformMenu('onboarding'), getOnboarding);
router.post('/platform/registrations/:id/resend', requireAuth, requirePlatformOwner, resendOnboardingLink);
router.post('/platform/registrations/:id/send-link', requireAuth, requirePlatformOwner, sendRegistrationRoleLink);
router.patch('/platform/registrations/:id/recipient-email', requireAuth, requirePlatformOwner, updateRegistrationRecipientEmail);
router.delete('/platform/registrations/:id/re-signup', requireAuth, requirePlatformOwner, reSignupRegistration);
router.post('/platform/registrations/:id/manual-cheque-verify', requireAuth, requirePlatformOwner, manualChequeVerify);
router.post('/platform/registrations/:id/refund', requireAuth, requirePlatformOwner, refundRegistration);
router.post('/platform/registrations/:id/confirm-payment', requireAuth, requirePlatformOwner, confirmPaymentRegistration);
router.get('/platform/registrations/:id/verification', requireAuth, requirePlatformMenu('verification'), getRegistrationVerification);
router.post('/platform/registrations/:id/verify', requireAuth, requirePlatformOwner, verifyRegistration);

// Audit Trail
router.get('/platform/audit', requireAuth, requirePlatformMenu('audit_trail'), getPlatformAudit);

export default router;

// ── Support Tickets (Cross-tenant) ──
router.get('/platform/tickets', requireAuth, requirePlatformStaff, listPlatformTickets);
router.get('/platform/tickets/:id', requireAuth, requirePlatformStaff, getPlatformTicket);
router.post('/platform/tickets/:id/messages', requireAuth, requirePlatformStaff, replyPlatformTicket);
router.patch('/platform/tickets/:id/status', requireAuth, requirePlatformOwner, updatePlatformTicketStatus);

// ── Sales CRM Pipeline ──
router.get('/platform/sales/leads', requireAuth, requirePlatformStaff, listSalesLeads);
router.post('/platform/sales/leads', requireAuth, requirePlatformStaff, createSalesLead);
router.patch('/platform/sales/leads/:id', requireAuth, requirePlatformStaff, updateSalesLead);

// ── System Health & Maintenance ──
router.get('/platform/system-health', requireAuth, requirePlatformOwner, getPlatformHealth);
router.post('/platform/announcements', requireAuth, requirePlatformOwner, setPlatformAnnouncement);
