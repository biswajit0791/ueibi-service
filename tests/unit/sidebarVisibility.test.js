import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma.js';
import {
  SIDEBAR_MENU_CATALOG,
  DEFAULT_SIDEBAR_VISIBILITY,
  getHierarchyVisibility,
  updateHierarchyVisibility,
  resetHierarchyVisibility,
  getCallerSidebarVisibility,
} from '../../src/services/roleHierarchy.service.js';

describe('Sidebar Menu Visibility Management Tests', () => {
  const timestamp = Date.now();
  const testTenantCode = `sb-test-${timestamp}`;
  const testDomain = `sb-${timestamp}.com`;

  let createdTenant;
  let adminUser;
  let empUser;

  before(async () => {
    createdTenant = await prisma.tenant.create({
      data: {
        companyName: `Sidebar Test Org ${timestamp}`,
        domainName: testDomain,
        tenantCode: testTenantCode,
        status: 'ACTIVE',
      },
    });

    adminUser = await prisma.tenantUser.create({
      data: {
        tenantId: createdTenant.id,
        email: `admin@${testDomain}`,
        passwordHash: 'dummy',
        name: 'Admin Tester',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    empUser = await prisma.tenantUser.create({
      data: {
        tenantId: createdTenant.id,
        email: `emp@${testDomain}`,
        passwordHash: 'dummy',
        name: 'Employee Tester',
        role: 'EMPLOYEE',
        status: 'ACTIVE',
      },
    });
  });

  after(async () => {
    await prisma.tenantSettings.deleteMany({
      where: { tenantId: createdTenant.id },
    }).catch(() => {});
    await prisma.permissionAuditLog.deleteMany({
      where: { tenantId: createdTenant.id },
    }).catch(() => {});
    await prisma.tenantUser.deleteMany({
      where: { tenantId: createdTenant.id },
    }).catch(() => {});
    await prisma.tenant.delete({
      where: { id: createdTenant.id },
    }).catch(() => {});
  });

  test('1. SIDEBAR_MENU_CATALOG contains all expected navigation modules', () => {
    assert.ok(SIDEBAR_MENU_CATALOG.length >= 20, 'Catalog should contain at least 20 menu items');
    const keys = SIDEBAR_MENU_CATALOG.map((i) => i.key);
    assert.ok(keys.includes('dashboard'));
    assert.ok(keys.includes('hr_dashboard'));
    assert.ok(keys.includes('employee_records'));
    assert.ok(keys.includes('goals'));
    assert.ok(keys.includes('tasks'));
    assert.ok(keys.includes('leaves'));
    assert.ok(keys.includes('reports'));
    assert.ok(keys.includes('role_hierarchy'));
    assert.ok(keys.includes('departments'));
    assert.ok(keys.includes('company_settings'));
  });

  test('2. DEFAULT_SIDEBAR_VISIBILITY defines rules for all corporate roles', () => {
    const roles = ['SUPER_ADMIN', 'CMD', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE', 'STUDENT', 'MENTOR'];
    roles.forEach((r) => {
      assert.ok(DEFAULT_SIDEBAR_VISIBILITY[r], `Default visibility must exist for role ${r}`);
      assert.equal(typeof DEFAULT_SIDEBAR_VISIBILITY[r].dashboard, 'boolean');
      assert.equal(typeof DEFAULT_SIDEBAR_VISIBILITY[r].profile, 'boolean');
    });

    // Verify SUPER_ADMIN has everything enabled
    assert.equal(DEFAULT_SIDEBAR_VISIBILITY.SUPER_ADMIN.reports, true);
    assert.equal(DEFAULT_SIDEBAR_VISIBILITY.SUPER_ADMIN.company_settings, true);

    // Verify EMPLOYEE has administrative items disabled by default
    assert.equal(DEFAULT_SIDEBAR_VISIBILITY.EMPLOYEE.reports, false);
    assert.equal(DEFAULT_SIDEBAR_VISIBILITY.EMPLOYEE.departments, false);
    assert.equal(DEFAULT_SIDEBAR_VISIBILITY.EMPLOYEE.company_settings, false);
  });

  test('3. getHierarchyVisibility returns effective sidebar visibility and catalog', async () => {
    const res = await getHierarchyVisibility(createdTenant.id, empUser);
    assert.ok(res.visibility);
    assert.ok(res.sidebarVisibility);
    assert.ok(Array.isArray(res.sidebarCatalog));
    assert.equal(res.canConfigure, false, 'Employee cannot configure visibility');
    assert.equal(res.mySidebarVisibility.reports, false);
    assert.equal(res.mySidebarVisibility.dashboard, true);

    const adminRes = await getHierarchyVisibility(createdTenant.id, adminUser);
    assert.equal(adminRes.canConfigure, true, 'Admin can configure visibility');
  });

  test('4. updateHierarchyVisibility updates sidebar menu permissions and preserves Root Authority', async () => {
    const customSidebar = {
      ...DEFAULT_SIDEBAR_VISIBILITY,
      EMPLOYEE: {
        ...DEFAULT_SIDEBAR_VISIBILITY.EMPLOYEE,
        reports: true, // Enable reports for employee
        goals: false,   // Disable goals for employee
      },
      SUPER_ADMIN: {
        ...DEFAULT_SIDEBAR_VISIBILITY.SUPER_ADMIN,
        reports: false, // Attempt to disable for super admin (must be overridden)
      },
    };

    const updateRes = await updateHierarchyVisibility(createdTenant.id, adminUser, {
      sidebarVisibility: customSidebar,
    });

    assert.equal(updateRes.sidebarVisibility.EMPLOYEE.reports, true, 'Reports should now be enabled for employee');
    assert.equal(updateRes.sidebarVisibility.EMPLOYEE.goals, false, 'Goals should now be disabled for employee');
    assert.equal(updateRes.sidebarVisibility.SUPER_ADMIN.reports, true, 'SUPER_ADMIN Root Authority must stay true');

    // Check caller's effective view
    const empView = await getCallerSidebarVisibility(createdTenant.id, empUser);
    assert.equal(empView.reports, true);
    assert.equal(empView.goals, false);
  });

  test('5. Non-admin users are rejected when trying to update visibility', async () => {
    await assert.rejects(
      async () => {
        await updateHierarchyVisibility(createdTenant.id, empUser, {
          sidebarVisibility: DEFAULT_SIDEBAR_VISIBILITY,
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        assert.ok(err.message.includes('Only administrators'));
        return true;
      }
    );
  });

  test('6. resetHierarchyVisibility resets to default configuration', async () => {
    await resetHierarchyVisibility(createdTenant.id, adminUser, 'SIDEBAR');

    const empView = await getCallerSidebarVisibility(createdTenant.id, empUser);
    assert.equal(empView.reports, false, 'Reports should revert to default false for employee');
    assert.equal(empView.goals, true, 'Goals should revert to default true for employee');
  });
});

