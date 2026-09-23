import { Router } from 'express';
import {
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
} from '../controllers/package.controller.js';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  issueInvoice,
  voidInvoice,
  sendInvoice,
  recordPayment,
  recordRefund,
} from '../controllers/invoice.controller.js';
import {
  listSubscriptions,
  getSubscription,
  startSubscription,
  renewSubscription,
  cancelSubscription,
} from '../controllers/subscription.controller.js';
import { getRevenue, getCouponPerformance } from '../controllers/revenue.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformOwner } from '../middleware/rbac.js';

/**
 * Billing routes — packages, subscriptions, invoices, payments and refunds.
 *
 * Same gate as every other platform route: requireAuth + requirePlatformOwner,
 * and deliberately no requireTenant. Billing reads across tenants by nature, and
 * requireTenant would pin these to the platform's own tenant row.
 *
 * Nothing here is reachable by a company role, including SUPER_ADMIN. A tenant
 * seeing another tenant's invoices would be the worst leak in the product.
 */
const router = Router();

// ── Plans & Packages ────────────────────────────────────────────────────────
// DELETE is permanent and refused once a package has been sold; a sold package
// is deactivated via PATCH { active: false } instead.
router.get('/platform/packages', requireAuth, requirePlatformOwner, listPackages);
router.post('/platform/packages', requireAuth, requirePlatformOwner, createPackage);
router.get('/platform/packages/:id', requireAuth, requirePlatformOwner, getPackage);
router.patch('/platform/packages/:id', requireAuth, requirePlatformOwner, updatePackage);
router.delete('/platform/packages/:id', requireAuth, requirePlatformOwner, deletePackage);

// ── Invoices, payments and refunds ──────────────────────────────────────────
// The invoice number is allocated at ISSUE, not creation, so an abandoned draft
// never leaves a gap in the GST series. A voided invoice keeps its number.
router.get('/platform/invoices', requireAuth, requirePlatformOwner, listInvoices);
router.post('/platform/invoices', requireAuth, requirePlatformOwner, createInvoice);
router.get('/platform/invoices/:id', requireAuth, requirePlatformOwner, getInvoice);
router.post('/platform/invoices/:id/issue', requireAuth, requirePlatformOwner, issueInvoice);
router.post('/platform/invoices/:id/void', requireAuth, requirePlatformOwner, voidInvoice);
router.post('/platform/invoices/:id/send', requireAuth, requirePlatformOwner, sendInvoice);
// Recorded, never charged: money arrives outside the system and an operator
// writes it down here.
router.post('/platform/invoices/:id/payments', requireAuth, requirePlatformOwner, recordPayment);
router.post('/platform/invoices/:id/refunds', requireAuth, requirePlatformOwner, recordRefund);

// ── Subscriptions ───────────────────────────────────────────────────────────
// A renewal creates a NEW term linked to the old one; nothing is overwritten,
// so the chain IS the history. Starting or renewing sets Tenant.licenseLimit
// from the seats sold, which license.service.js then enforces.
router.get('/platform/subscriptions', requireAuth, requirePlatformOwner, listSubscriptions);
router.get('/platform/subscriptions/:id', requireAuth, requirePlatformOwner, getSubscription);
router.post('/platform/tenants/:id/subscription', requireAuth, requirePlatformOwner, startSubscription);
router.post('/platform/subscriptions/:id/renew', requireAuth, requirePlatformOwner, renewSubscription);
router.post('/platform/subscriptions/:id/cancel', requireAuth, requirePlatformOwner, cancelSubscription);

// ── Revenue ─────────────────────────────────────────────────────────────────
// Every figure comes from Invoice/Payment/Refund rows. No MRR: nothing recurs
// by itself, so a monthly recurring figure would be invented.
router.get('/platform/revenue', requireAuth, requirePlatformOwner, getRevenue);
router.get('/platform/coupons/performance', requireAuth, requirePlatformOwner, getCouponPerformance);

export default router;
