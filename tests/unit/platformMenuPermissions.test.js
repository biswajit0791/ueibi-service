import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_MENUS,
  ALL_MENU_KEYS,
  DEFAULT_INTERNAL_STAFF_MENU_KEYS,
  getUserPlatformPermissions,
  hasPlatformMenuPermission,
  updateUserPlatformPermissions,
  initializeDefaultPlatformPermissions,
} from '../../src/services/platformPermissions.service.js';
import { requirePlatformMenu } from '../../src/middleware/rbac.js';

describe('Individual Platform Owner Menu Access Control', () => {
  it('defines the required Platform Owner menus including unified Sign-up Data', () => {
    assert.equal(PLATFORM_MENUS.length, 20);
    assert.ok(ALL_MENU_KEYS.includes('platform_overview'));
    assert.ok(ALL_MENU_KEYS.includes('companies'));
    assert.ok(ALL_MENU_KEYS.includes('users'));
    assert.ok(ALL_MENU_KEYS.includes('internal_team'));
    assert.ok(ALL_MENU_KEYS.includes('signup_data'));
    assert.ok(ALL_MENU_KEYS.includes('organization_structures'));
    assert.ok(ALL_MENU_KEYS.includes('designations'));
    assert.ok(ALL_MENU_KEYS.includes('registration_settings'));
    assert.ok(ALL_MENU_KEYS.includes('billing_settings'));
    assert.ok(ALL_MENU_KEYS.includes('onboarding'));
    assert.ok(ALL_MENU_KEYS.includes('verification'));
    assert.ok(ALL_MENU_KEYS.includes('audit_trail'));
    assert.ok(ALL_MENU_KEYS.includes('packages'));
    assert.ok(ALL_MENU_KEYS.includes('renewal'));
    assert.ok(ALL_MENU_KEYS.includes('invoices'));
    assert.ok(ALL_MENU_KEYS.includes('revenue'));
    assert.ok(ALL_MENU_KEYS.includes('bdm_coupons'));
    assert.ok(ALL_MENU_KEYS.includes('customer_reviews'));
    assert.ok(ALL_MENU_KEYS.includes('invoice_design'));
    assert.ok(ALL_MENU_KEYS.includes('document_templates'));
    assert.ok(ALL_MENU_KEYS.includes('invoice_settings'));
    assert.ok(ALL_MENU_KEYS.includes('brand_logo'));
    assert.ok(ALL_MENU_KEYS.includes('legal'));
  });

  it('root PLATFORM_OWNER always receives master access to all menus', async () => {
    const permissions = await getUserPlatformPermissions('owner-1', 'PLATFORM_OWNER');
    assert.equal(Object.keys(permissions).length, ALL_MENU_KEYS.length);
    for (const key of ALL_MENU_KEYS) {
      assert.equal(permissions[key], true);
    }
  });

  it('non-platform roles receive false for all platform menus', async () => {
    const permissions = await getUserPlatformPermissions('emp-1', 'EMPLOYEE');
    for (const key of ALL_MENU_KEYS) {
      assert.equal(permissions[key], false);
    }
  });

  it('middleware allows PLATFORM_OWNER unconditionally', async () => {
    let nextCalled = false;
    let statusCalledWith = null;
    const req = { user: { id: 'owner-1', role: 'PLATFORM_OWNER' } };
    const res = {
      status(s) {
        statusCalledWith = s;
        return this;
      },
      json() {},
    };
    const next = () => { nextCalled = true; };

    const middleware = requirePlatformMenu('revenue');
    await middleware(req, res, next);

    assert.equal(nextCalled, true);
    assert.equal(statusCalledWith, null);
  });

  it('middleware blocks unauthorized roles with 403', async () => {
    let nextCalled = false;
    let statusCalledWith = null;
    const req = { user: { id: 'emp-1', role: 'EMPLOYEE' } };
    const res = {
      status(s) {
        statusCalledWith = s;
        return this;
      },
      json() {},
    };
    const next = () => { nextCalled = true; };

    const middleware = requirePlatformMenu('revenue');
    await middleware(req, res, next);

    assert.equal(nextCalled, false);
    assert.equal(statusCalledWith, 403);
  });
});
