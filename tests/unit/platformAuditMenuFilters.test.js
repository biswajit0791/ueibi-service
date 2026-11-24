import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_MENUS,
  resolveAuditMenu,
  getPrismaWhereForMenu,
  listPlatformAudit,
} from '../../src/services/platformAudit.service.js';

test('resolveAuditMenu maps explicit metadata menu if present', () => {
  const recordWithAfter = {
    action: 'SOME_ACTION',
    targetType: 'CUSTOM',
    afterValue: { menu: 'master_data' },
  };
  const resolved = resolveAuditMenu(recordWithAfter);
  assert.equal(resolved.key, 'master_data');
  assert.equal(resolved.label, 'Master Data Management');

  const recordWithBefore = {
    action: 'CUSTOM_ACT',
    beforeValue: { module: 'bdm_coupons' },
  };
  assert.equal(resolveAuditMenu(recordWithBefore).key, 'bdm_coupons');
});

test('resolveAuditMenu correctly categorizes actions and targetTypes to Platform Owner menus', () => {
  // Master data
  assert.equal(resolveAuditMenu({ targetType: 'CityMaster' }).key, 'master_data');
  assert.equal(resolveAuditMenu({ targetType: 'IndustryMaster' }).key, 'master_data');
  assert.equal(resolveAuditMenu({ targetType: 'SubscriptionDurationMaster' }).key, 'master_data');
  assert.equal(resolveAuditMenu({ action: 'CITY_CREATED' }).key, 'master_data');

  // BDM Coupons
  assert.equal(resolveAuditMenu({ targetType: 'COUPON', action: 'COUPON_CREATED' }).key, 'bdm_coupons');
  assert.equal(resolveAuditMenu({ action: 'COUPON_UPDATED' }).key, 'bdm_coupons');

  // Companies
  assert.equal(resolveAuditMenu({ targetType: 'TENANT', action: 'TENANT_SUSPENDED' }).key, 'companies');
  assert.equal(resolveAuditMenu({ action: 'TENANT_RESTORED' }).key, 'companies');
  assert.equal(resolveAuditMenu({ action: 'AUTOMATIC_TENANT_ACTIVATION' }).key, 'companies');

  // Users
  assert.equal(resolveAuditMenu({ targetType: 'USER', action: 'USER_DEACTIVATED' }).key, 'users');
  assert.equal(resolveAuditMenu({ action: 'USER_PASSWORD_RESET_SENT' }).key, 'users');

  // Internal Team
  assert.equal(resolveAuditMenu({ targetType: 'OrganizationStructure' }).key, 'internal_team');
  assert.equal(resolveAuditMenu({ targetType: 'Designation' }).key, 'internal_team');
  assert.equal(resolveAuditMenu({ action: 'STAFF_CREATED' }).key, 'internal_team');
  assert.equal(resolveAuditMenu({ action: 'PLATFORM_STAFF_PERMISSIONS_UPDATED' }).key, 'internal_team');

  // Verification & Onboarding & Signup Data
  assert.equal(resolveAuditMenu({ targetType: 'REGISTRATION', action: 'REGISTRATION_VERIFIED' }).key, 'verification');
  assert.equal(resolveAuditMenu({ targetType: 'REGISTRATION', action: 'REGISTRATION_LINK_RESENT' }).key, 'signup_data');
  assert.equal(resolveAuditMenu({ targetType: 'REGISTRATION', action: 'PAYMENT_CONFIRMED' }).key, 'onboarding');

  // Packages & Renewal & Invoices
  assert.equal(resolveAuditMenu({ targetType: 'PACKAGE', action: 'PACKAGE_CREATED' }).key, 'packages');
  assert.equal(resolveAuditMenu({ targetType: 'SUBSCRIPTION', action: 'SUBSCRIPTION_RENEWED' }).key, 'renewal');
  assert.equal(resolveAuditMenu({ targetType: 'INVOICE', action: 'INVOICE_SENT' }).key, 'invoices');
  assert.equal(resolveAuditMenu({ targetType: 'INVOICE_SETTINGS' }).key, 'invoice_settings');
  assert.equal(resolveAuditMenu({ targetType: 'INVOICE_TEMPLATE' }).key, 'invoice_design');
  assert.equal(resolveAuditMenu({ targetType: 'LEGAL_DOCUMENT' }).key, 'legal');
  assert.equal(resolveAuditMenu({ targetType: 'BRANDING' }).key, 'brand_logo');
});

test('getPrismaWhereForMenu generates valid Prisma filter objects', () => {
  const masterFilter = getPrismaWhereForMenu('master_data');
  assert.ok(masterFilter.OR);
  assert.ok(Array.isArray(masterFilter.OR));

  const couponFilter = getPrismaWhereForMenu('bdm_coupons');
  assert.ok(couponFilter.OR);

  const invalid = getPrismaWhereForMenu('');
  assert.equal(invalid, null);
});

test('listPlatformAudit queries real database and enriches with menu metadata', async () => {
  const res = await listPlatformAudit({ limit: 10 });
  assert.ok(res.items);
  assert.ok(Array.isArray(res.items));
  assert.ok(res.pagination);
  assert.ok(res.pagination.total >= 0);

  if (res.items.length > 0) {
    const first = res.items[0];
    assert.ok(first.menu, 'Each item must have a resolved menu key');
    assert.ok(first.menuLabel, 'Each item must have a resolved menu label');
    assert.ok(first.menuInfo, 'Each item must have menuInfo');
  }
});

test('listPlatformAudit correctly filters by menu, dates, and search', async () => {
  // Menu filter for bdm_coupons
  const couponResult = await listPlatformAudit({ menu: 'bdm_coupons', limit: 10 });
  for (const item of couponResult.items) {
    assert.equal(item.menu, 'bdm_coupons');
  }

  // Date range filter
  const dateResult = await listPlatformAudit({ fromDate: '2026-01-01', toDate: '2026-12-31', limit: 5 });
  assert.ok(dateResult.pagination.total >= 0);

  // Combined search and menu filter
  const combined = await listPlatformAudit({ menu: 'bdm_coupons', search: 'coupon', limit: 5 });
  assert.ok(combined.pagination.total >= 0);
  for (const item of combined.items) {
    assert.equal(item.menu, 'bdm_coupons');
  }
});
