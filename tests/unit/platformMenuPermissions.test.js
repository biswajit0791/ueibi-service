import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { prisma } from '../../src/lib/prisma.js';

describe('Individual Platform Owner Menu Access Control', () => {
  it('defines exactly the 21 required Platform Owner menus', () => {
    expect(PLATFORM_MENUS.length).toBe(21);
    expect(ALL_MENU_KEYS).toContain('platform_overview');
    expect(ALL_MENU_KEYS).toContain('companies');
    expect(ALL_MENU_KEYS).toContain('users');
    expect(ALL_MENU_KEYS).toContain('internal_team');
    expect(ALL_MENU_KEYS).toContain('organization_structures');
    expect(ALL_MENU_KEYS).toContain('designations');
    expect(ALL_MENU_KEYS).toContain('registration_settings');
    expect(ALL_MENU_KEYS).toContain('onboarding');
    expect(ALL_MENU_KEYS).toContain('verification');
    expect(ALL_MENU_KEYS).toContain('audit_trail');
    expect(ALL_MENU_KEYS).toContain('packages');
    expect(ALL_MENU_KEYS).toContain('renewal');
    expect(ALL_MENU_KEYS).toContain('invoices');
    expect(ALL_MENU_KEYS).toContain('revenue');
    expect(ALL_MENU_KEYS).toContain('bdm_coupons');
    expect(ALL_MENU_KEYS).toContain('customer_reviews');
    expect(ALL_MENU_KEYS).toContain('invoice_design');
    expect(ALL_MENU_KEYS).toContain('document_templates');
    expect(ALL_MENU_KEYS).toContain('invoice_settings');
    expect(ALL_MENU_KEYS).toContain('brand_logo');
    expect(ALL_MENU_KEYS).toContain('legal');
  });

  it('root PLATFORM_OWNER always receives master access to all 21 menus', async () => {
    const permissions = await getUserPlatformPermissions('owner-1', 'PLATFORM_OWNER');
    expect(Object.keys(permissions).length).toBe(21);
    for (const key of ALL_MENU_KEYS) {
      expect(permissions[key]).toBe(true);
    }
  });

  it('non-platform roles receive false for all platform menus', async () => {
    const permissions = await getUserPlatformPermissions('emp-1', 'EMPLOYEE');
    for (const key of ALL_MENU_KEYS) {
      expect(permissions[key]).toBe(false);
    }
  });

  it('middleware allows PLATFORM_OWNER unconditionally', async () => {
    const req = { user: { id: 'owner-1', role: 'PLATFORM_OWNER' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    const middleware = requirePlatformMenu('revenue');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('middleware blocks unauthorized roles with 403', async () => {
    const req = { user: { id: 'emp-1', role: 'EMPLOYEE' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    const middleware = requirePlatformMenu('revenue');
    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
