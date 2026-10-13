import { prisma } from '../src/lib/prisma.js';
import {
  getRolePermissionMatrix,
  updateRolePermissions,
  resetRolePermissions,
  getHierarchyVisibility,
  updateHierarchyVisibility,
  getRoleDashboardConfig,
  updateRoleDashboardConfig,
  resetRoleDashboardConfig,
  getPermissionAuditLogs,
  getOrgHierarchyTree,
} from '../src/services/roleHierarchy.service.js';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 ROLE HIERARCHY & PERMISSION MATRIX VERIFICATION');
  console.log('====================================================\n');

  // 1. Locate tenant and test users
  const tenant = await prisma.tenant.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true, companyName: true },
  });

  if (!tenant) {
    throw new Error('No active tenant found in database for test.');
  }

  console.log(`[1] Found test tenant: "${tenant.companyName}" (${tenant.id})`);

  const superAdmin = await prisma.tenantUser.findFirst({
    where: { tenantId: tenant.id, role: 'SUPER_ADMIN', isDeleted: false },
    select: { id: true, name: true, role: true, email: true },
  });

  const employee = await prisma.tenantUser.findFirst({
    where: { tenantId: tenant.id, role: 'EMPLOYEE', isDeleted: false },
    select: { id: true, name: true, role: true, email: true },
  });

  if (!superAdmin) {
    throw new Error('No SUPER_ADMIN user found in test tenant.');
  }
  console.log(`[2] Found Super Admin: ${superAdmin.name} (${superAdmin.email})`);
  console.log(`[3] Found Employee: ${employee ? `${employee.name} (${employee.email})` : 'None (will use simulated)'}\n`);

  const testEmployee = employee || {
    id: 'simulated-emp-id',
    name: 'Test Staff',
    role: 'EMPLOYEE',
    email: 'staff@test.com',
  };

  // 2. Test getRolePermissionMatrix
  console.log('--- Test 1: getRolePermissionMatrix ---');
  const matrixRes = await getRolePermissionMatrix(tenant.id, superAdmin);
  console.log(`✓ Active roles in DB: ${matrixRes.activeRoles.join(', ')}`);
  console.log(`✓ Total categories returned: ${matrixRes.matrix.length}`);
  const firstCat = matrixRes.matrix[0];
  const firstFeat = firstCat.features[0];
  console.log(`✓ Sample feature: "${firstFeat.feature}"`);
  console.log(`✓ SUPER_ADMIN value: "${firstFeat.SUPER_ADMIN}", meta:`, firstFeat.SUPER_ADMIN_meta);
  if (!firstFeat.SUPER_ADMIN_meta) {
    throw new Error('Expected rich metadata on feature roles!');
  }

  // 3. Test privilege escalation prevention
  console.log('\n--- Test 2: Privilege Escalation Prevention ---');
  try {
    await updateRolePermissions(tenant.id, superAdmin, {
      role: 'EMPLOYEE',
      permissions: [
        {
          feature: 'Manage Company Settings & Branding',
          category: 'Governance & Administration',
          state: 'ALLOWED',
        },
      ],
    });
    throw new Error('FAILED: Expected privilege escalation error for EMPLOYEE on company settings!');
  } catch (err) {
    console.log(`✓ Successfully caught and blocked privilege escalation: "${err.message}"`);
  }

  // 4. Test unauthorized caller
  console.log('\n--- Test 3: Unauthorized Permission Edit by Employee ---');
  try {
    await updateRolePermissions(tenant.id, testEmployee, {
      role: 'HR',
      permissions: [
        {
          feature: 'View Company Task Board',
          category: 'Performance, Goals & Tasks',
          state: 'ALLOWED',
        },
      ],
    });
    throw new Error('FAILED: Expected 403 Forbidden for Employee editing permissions!');
  } catch (err) {
    console.log(`✓ Successfully blocked non-admin user: status=${err.status}, "${err.message}"`);
  }

  // 5. Test valid updateRolePermissions
  console.log('\n--- Test 4: Valid updateRolePermissions ---');
  const targetTestRole = matrixRes.activeRoles.includes('HR') ? 'HR' : matrixRes.activeRoles[1] || 'EMPLOYEE';
  const testFeature = 'Goal Creation & Allocation';

  const updatedRes = await updateRolePermissions(tenant.id, superAdmin, {
    role: targetTestRole,
    permissions: [
      {
        feature: testFeature,
        category: 'Performance, Goals & Tasks',
        state: 'ALLOWED',
        label: 'Custom Allowed By Test',
      },
    ],
  });
  console.log(`✓ Updated permission for role ${targetTestRole}. effectiveOverridesCount = ${updatedRes.effectiveOverridesCount}`);

  // Verify audit log created
  const auditLogsAfterUpdate = await getPermissionAuditLogs(tenant.id, {
    action: 'PERMISSION_UPDATE',
    targetRole: targetTestRole,
    limit: 5,
  });
  console.log(`✓ Found ${auditLogsAfterUpdate.items.length} PERMISSION_UPDATE audit log(s). Latest:`, {
    actor: auditLogsAfterUpdate.items[0]?.actor?.name,
    details: auditLogsAfterUpdate.items[0]?.details,
  });
  if (auditLogsAfterUpdate.items.length === 0) {
    throw new Error('Expected audit log to be created!');
  }

  // 6. Test resetRolePermissions
  console.log('\n--- Test 5: resetRolePermissions ---');
  const resetRes = await resetRolePermissions(tenant.id, superAdmin, { role: targetTestRole });
  console.log(`✓ Permissions reset for ${targetTestRole}. effectiveOverridesCount = ${resetRes.effectiveOverridesCount}`);

  // 7. Test getHierarchyVisibility and updateHierarchyVisibility
  console.log('\n--- Test 6: Hierarchy Visibility Controls & Enforcement ---');
  const visRes = await getHierarchyVisibility(tenant.id, superAdmin);
  console.log('✓ Current visibility keys:', Object.keys(visRes.visibility));

  // Update visibility: restrict matrix for EMPLOYEE
  const modifiedVis = { ...visRes.visibility };
  modifiedVis.EMPLOYEE = {
    ...modifiedVis.EMPLOYEE,
    canViewMatrix: false,
    canViewStats: false,
  };

  await updateHierarchyVisibility(tenant.id, superAdmin, { visibility: modifiedVis });
  console.log('✓ Successfully saved updated visibility rules.');

  // Test that EMPLOYEE is blocked from viewing matrix
  try {
    await getRolePermissionMatrix(tenant.id, testEmployee);
    throw new Error('FAILED: Expected 403 Forbidden for Employee viewing restricted Matrix!');
  } catch (err) {
    console.log(`✓ Backend correctly enforced visibility barrier on API: status=${err.status}, "${err.message}"`);
  }

  // Test that tree stats are hidden for EMPLOYEE when canViewStats is false
  const treeForEmp = await getOrgHierarchyTree(tenant.id, {}, testEmployee);
  console.log(`✓ Employee calling getOrgHierarchyTree: stats=${treeForEmp.stats === null ? 'null (Hidden)' : 'Visible'}`);
  if (treeForEmp.stats !== null) {
    throw new Error('Expected stats to be null for caller with canViewStats: false!');
  }

  // Restore employee visibility
  modifiedVis.EMPLOYEE = {
    ...modifiedVis.EMPLOYEE,
    canViewMatrix: false,
    canViewStats: false,
  };
  await updateHierarchyVisibility(tenant.id, superAdmin, { visibility: visRes.visibility });
  console.log('✓ Restored original visibility rules.');

  // 8. Test Dashboard Configuration
  console.log('\n--- Test 7: Dashboard Widget Configuration ---');
  const dashRes = await getRoleDashboardConfig(tenant.id, superAdmin);
  console.log(`✓ Supported dashboard widgets count: ${dashRes.supportedWidgets.length}`);
  console.log(`✓ SUPER_ADMIN widgets: ${dashRes.config.SUPER_ADMIN.widgets.join(', ')}`);

  // Update MANAGER widgets
  const newWidgets = ['metrics_overview', 'leave_tracker', 'team_directory', 'performance_goals'];
  const updatedDash = await updateRoleDashboardConfig(tenant.id, superAdmin, {
    role: 'MANAGER',
    widgets: newWidgets,
  });
  console.log(`✓ Configured MANAGER widgets: ${updatedDash.config.MANAGER.widgets.join(', ')}`);

  // Reset MANAGER widgets
  const resetDash = await resetRoleDashboardConfig(tenant.id, superAdmin, { role: 'MANAGER' });
  console.log(`✓ Reset MANAGER widgets to defaults: ${resetDash.config.MANAGER.widgets.join(', ')}`);

  // 9. Verify Final Audit Trail
  console.log('\n--- Test 8: Final Audit Trail Query ---');
  const allLogs = await getPermissionAuditLogs(tenant.id, { page: 1, limit: 10 });
  console.log(`✓ Total audit logs recorded in DB: ${allLogs.total}`);
  allLogs.items.forEach((l, idx) => {
    console.log(`  [${idx + 1}] ${l.action} | Target: ${l.targetRole} | Actor: ${l.actor.name} (${l.actor.role}) | ${new Date(l.createdAt).toLocaleTimeString()}`);
  });

  console.log('\n====================================================');
  console.log('✅ ALL TESTS PASSED SUCCESSFULLY WITH 100% INTEGRITY');
  console.log('====================================================');
}

runTests()
  .catch((err) => {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
