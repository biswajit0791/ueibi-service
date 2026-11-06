
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
  verifyRegistration,
  getRegistrationVerification,
} from '../controllers/platform.controller.js';
import {
  getBranding,
  updateBranding,
  resetBranding,
} from '../controllers/platformBranding.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner, requirePlatformStaff } from '../middleware/rbac.js';
import {
  listPlatformStaff,
  createPlatformStaff,
  updatePlatformStaff,
  directResetStaffPassword,
  getSalesPerformanceSummary,
  getStaffRenewalHistory
} from '../controllers/platformStaff.controller.js';
import {
  getPublicReviews,
  listAdminReviews,
  createCustomerReview,
  updateCustomerReview,
  deleteCustomerReview
} from '../controllers/customerReview.controller.js';

const router = Router();

// Platform Branding: GET is public so Login & Auth pages load the brand before login
router.get('/platform/branding', getBranding);
router.put('/platform/branding', requireAuth, requirePlatformOwner, updateBranding);
router.post('/platform/branding/reset', requireAuth, requirePlatformOwner, resetBranding);

// Note the absence of requireTenant: these handlers read ACROSS tenants by
// design, and requireTenant would pin them to the platform's own tenant row.
// requirePlatformOwner is what keeps them closed — no company role passes it.
router.get('/platform/overview', requireAuth, requirePlatformOwner, getPlatformOverview);
// Computed on every request, never stored: nothing in this product expires on
// its own, so an alert is a prompt to act rather than a record of an event.
router.get('/platform/alerts', requireAuth, requirePlatformOwner, getPlatformAlerts);
router.get('/platform/tenants', requireAuth, requirePlatformStaff, listPlatformTenants);

// Lifecycle. Every mutation writes a PlatformAuditLog row in the same
// transaction as the change itself.
router.get('/platform/tenants/:id', requireAuth, requirePlatformStaff, getPlatformTenant);
router.post('/platform/tenants/:id/lifecycle', requireAuth, requirePlatformOwner, setTenantLifecycle);
router.patch('/platform/tenants/:id/licences', requireAuth, requirePlatformOwner, updateTenantLicences);
router.post('/platform/tenants/:id/suspend', requireAuth, requirePlatformOwner, suspendTenant);
router.post('/platform/tenants/:id/restore', requireAuth, requirePlatformOwner, restoreTenant);

// Global user management — the only cross-tenant view of users. Identity and
// account state only; no company record is returned.
// Platform Sales/BD staff — owner only; only PLATFORM_SALES can be created.
router.get('/platform/staff', requireAuth, requirePlatformOwner, listPlatformStaff);
router.post('/platform/staff', requireAuth, requirePlatformOwner, createPlatformStaff);
router.patch('/platform/staff/:id', requireAuth, requirePlatformOwner, updatePlatformStaff);
router.post('/platform/staff/:id/direct-reset', requireAuth, requirePlatformOwner, directResetStaffPassword);
router.get('/platform/staff/performance', requireAuth, requirePlatformOwner, getSalesPerformanceSummary);
router.get('/platform/staff/:id/renewals', requireAuth, requirePlatformOwner, getStaffRenewalHistory);

// Public Customer Reviews (for unauthenticated landing & marketing pages)
router.get('/public/reviews', getPublicReviews);

// Customer Reviews Management — Platform Owner only
router.get('/platform/reviews', requireAuth, requirePlatformOwner, listAdminReviews);
router.post('/platform/reviews', requireAuth, requirePlatformOwner, createCustomerReview);
router.patch('/platform/reviews/:id', requireAuth, requirePlatformOwner, updateCustomerReview);
router.delete('/platform/reviews/:id', requireAuth, requirePlatformOwner, deleteCustomerReview);
router.get('/platform/users', requireAuth, requirePlatformOwner, listPlatformUsers);
router.get('/platform/users/:id', requireAuth, requirePlatformOwner, getPlatformUser);
router.post('/platform/users/:id/deactivate', requireAuth, requirePlatformOwner, deactivatePlatformUser);
router.post('/platform/users/:id/reactivate', requireAuth, requirePlatformOwner, reactivatePlatformUser);
router.post('/platform/users/:id/force-reset', requireAuth, requirePlatformOwner, forceResetPlatformUser);


// Onboarding queue and verification review — both read CompanyRegistration.
// Neither can advance a registration: approval stays with the emailed action
// links, which is the path live companies are onboarding through right now.
router.get('/platform/registrations', requireAuth, requirePlatformStaff, listOnboarding);
router.get('/platform/registrations/:id', requireAuth, requirePlatformStaff, getOnboarding);
router.post('/platform/registrations/:id/resend', requireAuth, requirePlatformOwner, resendOnboardingLink);
router.get('/platform/registrations/:id/verification', requireAuth, requirePlatformOwner, getRegistrationVerification);
router.post('/platform/registrations/:id/verify', requireAuth, requirePlatformOwner, verifyRegistration);

// The trail of what the operator has done.
router.get('/platform/audit', requireAuth, requirePlatformOwner, getPlatformAudit);

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
