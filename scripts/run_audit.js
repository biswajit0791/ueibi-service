import { prisma } from '../src/lib/prisma.js';
import {
  getOrgHierarchyTree,
  getEmployeeHierarchyChain,
  assignEmployeeManager,
} from '../src/services/roleHierarchy.service.js';
import {
  getEffectiveUserPermissions,
  checkUserPermission,
  getReportingDownlineUserIds,
  setUserPermissions,
  resetUserPermissionsToDefaults,
  ensureTenantDefaultProfiles,
  listAccessProfiles,
} from '../src/services/permission.service.js';
import bcrypt from 'bcryptjs';

async function audit() {
  console.log('================================================================');
  console.log('   STARTING COMPREHENSIVE RECURSIVE HIERARCHY & ACCESS AUDIT    ');
  console.log('================================================================\n');

  const auditResults = [];

  function record(testName, expected, actual, pass) {
    auditResults.push({
      test: testName,
      expected,
      actual,
      status: pass ? 'PASS' : 'FAIL',
    });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${testName}`);
    if (!pass) {
      console.log(`       Expected: ${expected}`);
      console.log(`       Actual:   ${actual}`);
    }
  }

  // 1. Setup Test Tenant and 5-Level Deep Hierarchies
  console.log('Step 1: Setting up isolated test tenant & 5-level hierarchy fixtures...');

  let testTenant = await prisma.tenant.findFirst({
    where: { domainName: 'audit-hierarchy-test.com' },
  });

  if (!testTenant) {
    testTenant = await prisma.tenant.create({
      data: {
        tenantCode: 'AUDIT_' + Date.now(),
        companyName: 'Audit Hierarchy Corp',
        domainName: 'audit-hierarchy-test.com',
        status: 'ACTIVE',
      },
    });
  }

  // Clean old audit users
  await prisma.tenantUser.deleteMany({
    where: { tenantId: testTenant.id },
  });

  const pwdHash = await bcrypt.hash('AuditPass@123', 10);

  // Helper to create user
  async function createUser(email, name, role, department, designation, managerId = null) {
    return prisma.tenantUser.create({
      data: {
        tenantId: testTenant.id,
        email,
        name,
        role,
        department,
        designation,
        managerId,
        passwordHash: pwdHash,
        status: 'ACTIVE',
        employeeId: 'AUD-' + Math.floor(1000 + Math.random() * 9000),
      },
    });
  }

  // Hierarchy A: 5 Nested Levels of HR (HR -> HR -> HR -> HR -> HR)
  const hr1 = await createUser('hr1@test.com', 'HR Head (L1)', 'HR', 'Human Resources', 'Chief HR Officer', null);
  const hr2 = await createUser('hr2@test.com', 'HR Director (L2)', 'HR', 'Human Resources', 'HR Director', hr1.id);
  const hr3 = await createUser('hr3@test.com', 'Senior HR Manager (L3)', 'HR', 'Human Resources', 'Sr HR Manager', hr2.id);
  const hr4 = await createUser('hr4@test.com', 'HR Lead (L4)', 'HR', 'Human Resources', 'HR Team Lead', hr3.id);
  const hr5 = await createUser('hr5@test.com', 'Junior HR Associate (L5)', 'HR', 'Human Resources', 'HR Associate', hr4.id);

  // Hierarchy B: 5 Nested Levels of Managers (MANAGER -> MANAGER -> MANAGER -> MANAGER -> EMPLOYEE)
  const mgr1 = await createUser('mgr1@test.com', 'VP Engineering (L1)', 'MANAGER', 'Engineering', 'VP Engineering', null);
  const mgr2A = await createUser('mgr2a@test.com', 'Director Platform (L2-A)', 'MANAGER', 'Engineering', 'Engineering Director', mgr1.id);
  const mgr2B = await createUser('mgr2b@test.com', 'Director QA (L2-B)', 'MANAGER', 'QA', 'QA Director', mgr1.id);
  const mgr3 = await createUser('mgr3@test.com', 'Backend Lead (L3)', 'MANAGER', 'Engineering', 'Lead Backend', mgr2A.id);
  const mgr4 = await createUser('mgr4@test.com', 'Team Lead Services (L4)', 'MANAGER', 'Engineering', 'Team Lead', mgr3.id);
  const dev5 = await createUser('dev5@test.com', 'Staff Developer (L5)', 'EMPLOYEE', 'Engineering', 'Staff Engineer', mgr4.id);

  // Hierarchy C: 3 Nested Levels of Finance (FINANCE -> FINANCE -> FINANCE)
  const fin1 = await createUser('fin1@test.com', 'CFO (L1)', 'FINANCE', 'Finance', 'Chief Financial Officer', null);
  const fin2 = await createUser('fin2@test.com', 'Senior Finance Controller (L2)', 'FINANCE', 'Finance', 'Finance Controller', fin1.id);
  const fin3 = await createUser('fin3@test.com', 'Junior Finance Associate (L3)', 'FINANCE', 'Finance', 'Accounts Executive', fin2.id);

  // Hierarchy D: 3 Nested Levels of Admin (ADMIN -> ADMIN -> ADMIN)
  const adm1 = await createUser('adm1@test.com', 'Principal Admin (L1)', 'ADMIN', 'Administration', 'Admin Lead', null);
  const adm2 = await createUser('adm2@test.com', 'Operations Admin (L2)', 'ADMIN', 'Administration', 'Operations Admin', adm1.id);
  const adm3 = await createUser('adm3@test.com', 'Facility Admin (L3)', 'ADMIN', 'Administration', 'Facility Admin', adm2.id);

  console.log('✅ Created 14 test users spanning 5 levels of nesting across HR, Manager, Finance, and Admin.\n');

  // =========================================================================
  // TEST SUITE 1: EXISTING RECURSIVE REPORTING HIERARCHY VERIFICATION
  // =========================================================================
  console.log('--- TEST SUITE 1: RECURSIVE REPORTING HIERARCHY ---');

  // 1.1 HR Recursive Hierarchy Tree
  const hrDownline1 = await getReportingDownlineUserIds(testTenant.id, hr1.id);
  record(
    'HR recursive hierarchy (L1 -> L2 -> L3 -> L4 -> L5)',
    '4 descendants [hr2, hr3, hr4, hr5]',
    `${hrDownline1.length} descendants found`,
    hrDownline1.length === 4 &&
      hrDownline1.includes(hr2.id) &&
      hrDownline1.includes(hr3.id) &&
      hrDownline1.includes(hr4.id) &&
      hrDownline1.includes(hr5.id)
  );

  // 1.2 Intermediate HR node downline
  const hrDownline3 = await getReportingDownlineUserIds(testTenant.id, hr3.id);
  record(
    'Intermediate HR downline (L3 -> L4 -> L5)',
    '2 descendants [hr4, hr5]',
    `${hrDownline3.length} descendants found`,
    hrDownline3.length === 2 && hrDownline3.includes(hr4.id) && hrDownline3.includes(hr5.id)
  );

  // 1.3 Manager Recursive Hierarchy
  const mgrDownline1 = await getReportingDownlineUserIds(testTenant.id, mgr1.id);
  record(
    'Manager recursive hierarchy (5 levels deep)',
    '5 descendants [mgr2a, mgr2b, mgr3, mgr4, dev5]',
    `${mgrDownline1.length} descendants found`,
    mgrDownline1.length === 5 && mgrDownline1.includes(dev5.id)
  );

  // 1.4 Finance Recursive Hierarchy
  const finDownline1 = await getReportingDownlineUserIds(testTenant.id, fin1.id);
  record(
    'Finance recursive hierarchy (3 levels deep)',
    '2 descendants [fin2, fin3]',
    `${finDownline1.length} descendants found`,
    finDownline1.length === 2 && finDownline1.includes(fin2.id) && finDownline1.includes(fin3.id)
  );

  // 1.5 Admin Recursive Hierarchy
  const admDownline1 = await getReportingDownlineUserIds(testTenant.id, adm1.id);
  record(
    'Admin recursive hierarchy (3 levels deep)',
    '2 descendants [adm2, adm3]',
    `${admDownline1.length} descendants found`,
    admDownline1.length === 2 && admDownline1.includes(adm2.id) && admDownline1.includes(adm3.id)
  );

  // 1.6 Visual Org Hierarchy Tree Calculation
  const orgTree = await getOrgHierarchyTree(testTenant.id, {}, { id: adm1.id, role: 'ADMIN' });
  const hrRootInTree = orgTree.tree.find((n) => n.id === hr1.id);
  record(
    'Visual Org Tree recursive downline count & depth for HR Root',
    'totalDownlineCount = 4, depth = 0',
    `totalDownlineCount = ${hrRootInTree?.totalDownlineCount}, depth = ${hrRootInTree?.depth}`,
    hrRootInTree?.totalDownlineCount === 4 && hrRootInTree?.depth === 0
  );

  // 1.7 Employee Hierarchy Chain Upward Traversal
  const chainDev5 = await getEmployeeHierarchyChain(testTenant.id, dev5.id, { id: adm1.id, role: 'ADMIN' });
  const chainIds = (chainDev5.managementChain || []).map((m) => m.id);
  record(
    'Management chain upward traversal from L5 employee to L1 VP',
    '4 managers in chain [mgr1, mgr2a, mgr3, mgr4]',
    `${chainIds.length} managers: ${chainIds.join(' -> ')}`,
    chainIds.length === 4 &&
      chainIds[0] === mgr1.id &&
      chainIds[1] === mgr2A.id &&
      chainIds[2] === mgr3.id &&
      chainIds[3] === mgr4.id
  );

  // =========================================================================
  // TEST SUITE 2: DOWNLINE & PEER ACCESS VERIFICATION
  // =========================================================================
  console.log('\n--- TEST SUITE 2: DOWNLINE & PEER ACCESS VERIFICATION ---');

  // Ensure default profiles
  await ensureTenantDefaultProfiles(testTenant.id);

  // 2.1 Senior Manager can access downline descendants
  const scopeCheckSrMgrToDev5 = await checkUserPermission(testTenant.id, mgr2A.id, 'task.board.view', {
    targetUserId: dev5.id,
  });
  record(
    "Senior Manager (L2) accessing downline descendant (L5)",
    'Allowed: true',
    `Allowed: ${scopeCheckSrMgrToDev5.allowed}`,
    scopeCheckSrMgrToDev5.allowed === true
  );

  // 2.2 Peer isolation: Same-level managers cannot access each other's downlines
  // mgr2B (QA Director) trying to access dev5 (Engineering downline of mgr2A)
  const peerIsolationCheck = await checkUserPermission(testTenant.id, mgr2B.id, 'task.board.view', {
    targetUserId: dev5.id,
  });
  record(
    "Peer Isolation: Peer Manager (mgr2b) cannot access other manager's team (dev5)",
    'Allowed: false (outside downline & department)',
    `Allowed: ${peerIsolationCheck.allowed}`,
    peerIsolationCheck.allowed === false
  );

  // 2.3 Ancestor inaccessibility: Subordinate cannot access ancestor manager records
  const subToAncestorCheck = await checkUserPermission(testTenant.id, dev5.id, 'employee.records.view', {
    targetUserId: mgr1.id,
  });
  record(
    'Ancestor Inaccessibility: Subordinate (dev5) cannot access ancestor manager (mgr1) private records',
    'Allowed: false',
    `Allowed: ${subToAncestorCheck.allowed}`,
    subToAncestorCheck.allowed === false
  );

  // 2.4 Dynamic manager reassignment updates downline access immediately
  // Transfer dev5 from mgr4 to mgr2B
  await assignEmployeeManager(testTenant.id, dev5.id, mgr2B.id);

  const mgr2BAccessAfterTransfer = await checkUserPermission(testTenant.id, mgr2B.id, 'task.board.view', {
    targetUserId: dev5.id,
  });
  const mgr4AccessAfterTransfer = await checkUserPermission(testTenant.id, mgr4.id, 'task.board.view', {
    targetUserId: dev5.id,
  });

  record(
    'Dynamic Reassignment: New manager (mgr2B) gains downline access',
    'Allowed: true',
    `Allowed: ${mgr2BAccessAfterTransfer.allowed}`,
    mgr2BAccessAfterTransfer.allowed === true
  );
  record(
    'Dynamic Reassignment: Old manager (mgr4) loses downline access',
    'Allowed: false',
    `Allowed: ${mgr4AccessAfterTransfer.allowed}`,
    mgr4AccessAfterTransfer.allowed === false
  );

  // Revert transfer
  await assignEmployeeManager(testTenant.id, dev5.id, mgr4.id);

  // =========================================================================
  // TEST SUITE 3: USER-LEVEL PERMISSION OVERRIDES & ACCESS PROFILES
  // =========================================================================
  console.log('\n--- TEST SUITE 3: USER-LEVEL ACCESS PROFILES & PRECEDENCE ---');

  const tenantProfiles = await listAccessProfiles(testTenant.id);
  const jrHrProf = tenantProfiles.find((p) => p.name === 'Junior HR');
  const srHrProf = tenantProfiles.find((p) => p.name === 'Senior HR');

  // Assign Senior HR profile to hr1, Junior HR profile to hr5
  await setUserPermissions(testTenant.id, { id: adm1.id, role: 'ADMIN' }, hr1.id, {
    profileId: srHrProf.id,
    dataScope: { scopeType: 'ALL' },
  });
  await setUserPermissions(testTenant.id, { id: adm1.id, role: 'ADMIN' }, hr5.id, {
    profileId: jrHrProf.id,
    dataScope: { scopeType: 'DEPARTMENT' },
  });

  const effHr1 = await getEffectiveUserPermissions(testTenant.id, hr1.id);
  const effHr5 = await getEffectiveUserPermissions(testTenant.id, hr5.id);

  record(
    'Multiple HRs with same role: Senior HR (hr1) can approve leave',
    'Allowed: true',
    `Allowed: ${effHr1.effectivePermissions['leave.request.approve']?.allowed}`,
    effHr1.effectivePermissions['leave.request.approve']?.allowed === true
  );

  record(
    'Multiple HRs with same role: Junior HR (hr5) CANNOT approve leave',
    'Allowed: false',
    `Allowed: ${effHr5.effectivePermissions['leave.request.approve']?.allowed}`,
    effHr5.effectivePermissions['leave.request.approve']?.allowed === false
  );

  record(
    'Junior HR CANNOT edit employee records',
    'Allowed: false',
    `Allowed: ${effHr5.effectivePermissions['employee.records.edit']?.allowed}`,
    effHr5.effectivePermissions['employee.records.edit']?.allowed === false
  );

  record(
    'Junior HR CANNOT export reports',
    'Allowed: false',
    `Allowed: ${effHr5.effectivePermissions['reports.analytics.export']?.allowed}`,
    effHr5.effectivePermissions['reports.analytics.export']?.allowed === false
  );

  // 3.2 Precedence Test: Explicit User DENY overrides Profile ALLOW
  await setUserPermissions(testTenant.id, { id: adm1.id, role: 'ADMIN' }, hr1.id, {
    profileId: srHrProf.id,
    overrides: {
      'leave.request.approve': 'DENY', // Explicit override
    },
  });
  const effHr1Overridden = await getEffectiveUserPermissions(testTenant.id, hr1.id);
  record(
    'Precedence: User-level explicit DENY overrides profile ALLOW',
    'Allowed: false (Source: USER_OVERRIDE (DENY))',
    `Allowed: ${effHr1Overridden.effectivePermissions['leave.request.approve']?.allowed} (Source: ${effHr1Overridden.effectivePermissions['leave.request.approve']?.source})`,
    effHr1Overridden.effectivePermissions['leave.request.approve']?.allowed === false &&
      effHr1Overridden.effectivePermissions['leave.request.approve']?.source?.includes('DENY')
  );

  // 3.3 Role Ceiling Violation Test
  let ceilingBlocked = false;
  try {
    await setUserPermissions(testTenant.id, { id: adm1.id, role: 'ADMIN' }, dev5.id, {
      overrides: {
        'financial.invoices.manage': 'ALLOW', // Invalid for EMPLOYEE
      },
    });
  } catch (err) {
    if (err.message.includes('Role Ceiling Violation')) {
      ceilingBlocked = true;
    }
  }
  record(
    'Role Ceiling Violation Prevention: EMPLOYEE cannot receive financial.invoices.manage',
    'Blocked with Role Ceiling Violation error',
    ceilingBlocked ? 'Blocked correctly' : 'Violation permitted',
    ceilingBlocked
  );

  // =========================================================================
  // TEST SUITE 4: SECURITY & BOUNDARY TESTING
  // =========================================================================
  console.log('\n--- TEST SUITE 4: SECURITY & BOUNDARY ENFORCEMENT ---');

  // 4.1 Circular hierarchy detection
  let circularBlocked = false;
  try {
    // Attempt to make hr1 report to hr5 (creating loop hr1 -> hr2 -> hr3 -> hr4 -> hr5 -> hr1)
    await assignEmployeeManager(testTenant.id, hr1.id, hr5.id);
  } catch (err) {
    if (err.message.includes('Circular hierarchy detected')) {
      circularBlocked = true;
    }
  }
  record(
    'Circular Reporting Detection: Cannot assign subordinate as ancestor manager',
    'Blocked with Circular hierarchy detected error',
    circularBlocked ? 'Blocked correctly' : 'Circular loop permitted',
    circularBlocked
  );

  // 4.2 Self-manager prevention
  let selfManagerBlocked = false;
  try {
    await assignEmployeeManager(testTenant.id, hr1.id, hr1.id);
  } catch (err) {
    if (err.message.includes('cannot be their own reporting manager')) {
      selfManagerBlocked = true;
    }
  }
  record(
    'Self-Manager Prevention: Employee cannot be their own reporting manager',
    'Blocked with validation error',
    selfManagerBlocked ? 'Blocked correctly' : 'Self-assignment permitted',
    selfManagerBlocked
  );

  // 4.3 Inactive manager assignment prevention
  await prisma.tenantUser.update({
    where: { id: hr4.id },
    data: { status: 'EXITED' },
  });
  let inactiveMgrBlocked = false;
  try {
    await assignEmployeeManager(testTenant.id, dev5.id, hr4.id);
  } catch (err) {
    if (err.message.includes('does not exist or is inactive')) {
      inactiveMgrBlocked = true;
    }
  }
  record(
    'Inactive Manager Prevention: Suspended employee cannot be assigned as manager',
    'Blocked with inactive manager error',
    inactiveMgrBlocked ? 'Blocked correctly' : 'Suspended manager assigned',
    inactiveMgrBlocked
  );
  await prisma.tenantUser.update({
    where: { id: hr4.id },
    data: { status: 'ACTIVE' },
  });

  // 4.4 Cross-Tenant Data Leakage Prevention
  const foreignTenant = await prisma.tenant.create({
    data: {
      tenantCode: 'FOREIGN_' + Date.now(),
      companyName: 'Foreign Leakage Corp',
      domainName: 'foreign-leakage-test.com',
      status: 'ACTIVE',
    },
  });
  const foreignUser = await prisma.tenantUser.create({
    data: {
      tenantId: foreignTenant.id,
      email: 'foreign@leakage.com',
      name: 'Foreign Attacker',
      role: 'SUPER_ADMIN',
      passwordHash: pwdHash,
    },
  });

  const crossTenantCheck = await checkUserPermission(foreignTenant.id, foreignUser.id, 'employee.records.view', {
    targetUserId: dev5.id, // Target from testTenant
  });
  record(
    'Cross-Tenant Data Leakage Prevention: Foreign tenant cannot access test tenant employee',
    'Allowed: false (IDOR blocked by tenant boundary)',
    `Allowed: ${crossTenantCheck.allowed}`,
    crossTenantCheck.allowed === false
  );

  // Clean foreign tenant
  await prisma.tenantUser.deleteMany({ where: { tenantId: foreignTenant.id } });
  await prisma.tenant.delete({ where: { id: foreignTenant.id } });

  // 4.5 Subordinate Delegation Authority
  let delegationBlocked = false;
  try {
    await setUserPermissions(testTenant.id, { id: mgr2B.id, role: 'MANAGER' }, dev5.id, {
      overrides: { 'task.board.view': 'ALLOW' },
    });
  } catch (err) {
    if (err.message.includes('Forbidden') || err.message.includes('not authorized to manage permissions')) {
      delegationBlocked = true;
    }
  }
  record(
    'Delegation Restriction: Manager cannot modify permissions of non-downline employee',
    'Blocked with Forbidden delegation error',
    delegationBlocked ? 'Blocked correctly' : 'Unauthorized delegation allowed',
    delegationBlocked
  );

  // 4.6 Reset to Role Defaults restores original baseline
  await resetUserPermissionsToDefaults(testTenant.id, { id: adm1.id, role: 'ADMIN' }, hr1.id);
  const resetHr1 = await getEffectiveUserPermissions(testTenant.id, hr1.id);
  record(
    'Reset to Role Defaults: Clears custom overrides and detached profiles',
    'Overrides = 0, Profile = null, leave.request.approve = ALLOW (role default)',
    `Overrides = ${resetHr1.summary.totalOverrides}, Profile = ${resetHr1.user.accessProfileId}, Allowed = ${resetHr1.effectivePermissions['leave.request.approve']?.allowed}`,
    resetHr1.summary.totalOverrides === 0 &&
      resetHr1.user.accessProfileId === null &&
      resetHr1.effectivePermissions['leave.request.approve']?.allowed === true
  );

  // Clean test fixtures
  await prisma.tenantUser.deleteMany({ where: { tenantId: testTenant.id } });
  await prisma.tenant.delete({ where: { id: testTenant.id } });

  console.log('\n================================================================');
  console.log('                    FINAL AUDIT SUMMARY                         ');
  console.log('================================================================');
  const passed = auditResults.filter((r) => r.status === 'PASS').length;
  const failed = auditResults.filter((r) => r.status === 'FAIL').length;
  console.log(`Total Tests Executed: ${auditResults.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('================================================================\n');

  return auditResults;
}

audit().then(results => {
  process.exit(0);
}).catch(err => {
  console.error('Audit crashed:', err);
  process.exit(1);
});
