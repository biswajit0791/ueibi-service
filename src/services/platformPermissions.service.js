/**
 * platformPermissions.service.js
 *
 * Individual Platform Owner Sidebar Menu Access Control.
 * Controls which Platform Owner menus each internal team member can view and access.
 * Root PLATFORM_OWNER retains master access to every menu.
 * Tenant/company permissions remain strictly isolated.
 */
import { prisma } from '../lib/prisma.js';

export const PLATFORM_MENUS = [
  { key: 'platform_overview', label: 'Platform Overview', path: '/platform/overview' },
  { key: 'companies', label: 'Companies', path: '/admin/companies' },
  { key: 'users', label: 'Users', path: '/platform/users' },
  { key: 'internal_team', label: 'Internal Team', path: '/platform/staff' },
  { key: 'organization_structures', label: 'Organization Structures', path: '/platform/organization-structures' },
  { key: 'designations', label: 'Designations', path: '/platform/designations' },
  { key: 'registration_settings', label: 'Registration & Billing Settings', path: '/platform/registration-settings' },
  { key: 'onboarding', label: 'Onboarding', path: '/platform/onboarding' },
  { key: 'verification', label: 'Verification', path: '/platform/verification' },
  { key: 'audit_trail', label: 'Audit Trail', path: '/platform/audit' },
  { key: 'packages', label: 'Packages', path: '/platform/packages' },
  { key: 'renewal', label: 'Renewal', path: '/platform/subscriptions' },
  { key: 'invoices', label: 'Invoices', path: '/platform/invoices' },
  { key: 'revenue', label: 'Revenue', path: '/platform/revenue' },
  { key: 'bdm_coupons', label: 'BDM Coupons', path: '/admin/coupons' },
  { key: 'customer_reviews', label: 'Customer Reviews', path: '/platform/reviews' },
  { key: 'invoice_design', label: 'Invoice Design', path: '/platform/invoice-templates' },
  { key: 'document_templates', label: 'Document Templates', path: '/uer/document-templates' },
  { key: 'invoice_settings', label: 'Invoice Settings', path: '/platform/invoice-settings' },
  { key: 'brand_logo', label: 'Brand & Logo', path: '/platform/branding' },
  { key: 'legal', label: 'Legal', path: '/platform/legal' },
];

export const ALL_MENU_KEYS = PLATFORM_MENUS.map((m) => m.key);

export const DEFAULT_INTERNAL_STAFF_MENU_KEYS = [
  'companies',
  'renewal',
  'invoices',
  'bdm_coupons',
];

/**
 * Returns effective boolean permissions for all 21 Platform Owner menus.
 * Root PLATFORM_OWNER always receives true for all menus.
 */
export async function getUserPlatformPermissions(userId, role) {
  const normalizedRole = String(role || '').toUpperCase();

  // Root platform owner holds complete administrative access
  if (normalizedRole === 'PLATFORM_OWNER') {
    const allAllowed = {};
    for (const key of ALL_MENU_KEYS) {
      allAllowed[key] = true;
    }
    return allAllowed;
  }

  // Not a platform role
  if (normalizedRole !== 'PLATFORM_SALES') {
    const allDenied = {};
    for (const key of ALL_MENU_KEYS) {
      allDenied[key] = false;
    }
    return allDenied;
  }

  const records = await prisma.platformMenuPermission.findMany({
    where: { userId },
  });

  const permissionsMap = {};

  if (records.length === 0) {
    // Legacy fallback: default permitted deal-making menus
    for (const key of ALL_MENU_KEYS) {
      permissionsMap[key] = DEFAULT_INTERNAL_STAFF_MENU_KEYS.includes(key);
    }
  } else {
    const recordMap = new Map(records.map((r) => [r.menuKey, r.isEnabled]));
    for (const key of ALL_MENU_KEYS) {
      permissionsMap[key] = recordMap.has(key) ? Boolean(recordMap.get(key)) : false;
    }
  }

  return permissionsMap;
}

/**
 * Check if a user has access to a specific platform menu key.
 */
export async function hasPlatformMenuPermission(userId, role, menuKey) {
  const normalizedRole = String(role || '').toUpperCase();
  if (normalizedRole === 'PLATFORM_OWNER') return true;
  if (normalizedRole !== 'PLATFORM_SALES') return false;

  const permissions = await getUserPlatformPermissions(userId, role);
  return permissions[menuKey] === true;
}

/**
 * Update individual user's menu permissions.
 * Only applicable to PLATFORM_SALES internal team users.
 */
export async function updateUserPlatformPermissions(userId, permissionsInput) {
  const targetUser = await prisma.tenantUser.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true, email: true },
  });

  if (!targetUser) {
    throw new Error('Internal team member not found');
  }

  if (targetUser.role !== 'PLATFORM_SALES') {
    throw new Error('Permissions can only be configured for internal team members');
  }

  const updates = [];
  for (const key of ALL_MENU_KEYS) {
    if (permissionsInput[key] !== undefined) {
      const isEnabled = Boolean(permissionsInput[key]);
      updates.push(
        prisma.platformMenuPermission.upsert({
          where: {
            userId_menuKey: {
              userId,
              menuKey: key,
            },
          },
          update: { isEnabled },
          create: {
            userId,
            menuKey: key,
            isEnabled,
          },
        })
      );
    }
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  return getUserPlatformPermissions(userId, targetUser.role);
}

/**
 * Initialize default permissions for newly invited internal staff
 */
export async function initializeDefaultPlatformPermissions(userId, customAllowedKeys = DEFAULT_INTERNAL_STAFF_MENU_KEYS) {
  const creates = ALL_MENU_KEYS.map((key) => ({
    userId,
    menuKey: key,
    isEnabled: customAllowedKeys.includes(key),
  }));

  for (const item of creates) {
    await prisma.platformMenuPermission.upsert({
      where: {
        userId_menuKey: {
          userId: item.userId,
          menuKey: item.menuKey,
        },
      },
      update: { isEnabled: item.isEnabled },
      create: item,
    });
  }

  return getUserPlatformPermissions(userId, 'PLATFORM_SALES');
}
