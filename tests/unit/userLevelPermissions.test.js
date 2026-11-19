import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSIONS_CATALOG,
  ROLE_PERMISSION_CEILINGS,
  DEFAULT_ACCESS_PROFILES,
} from '../../src/lib/permissionsCatalog.js';
import { requirePermission } from '../../src/middleware/permission.middleware.js';

test('1. Permissions Catalog & 8 Modules Integrity', () => {
  assert.ok(Array.isArray(PERMISSIONS_CATALOG), 'Catalog must be an array');
  assert.ok(PERMISSIONS_CATALOG.length >= 30, 'Catalog must contain at least 30 granular permissions');

  const requiredModules = [
    'WORKSPACE',
    'WORKFORCE',
    'OPERATIONS',
    'PERFORMANCE',
    'COMPANY',
    'ACADEMIC',
    'REPORTS',
    'ADMIN',
  ];

  const presentModules = new Set(PERMISSIONS_CATALOG.map((p) => p.module));
  for (const m of requiredModules) {
    assert.ok(presentModules.has(m), `Module '${m}' must be present in catalog`);
  }

  // Verify each item has key, name, module, action, category
  for (const item of PERMISSIONS_CATALOG) {
    assert.ok(item.key, 'Permission must have key');
    assert.ok(item.name, 'Permission must have name');
    assert.ok(item.module, 'Permission must have module');
    assert.ok(item.action, 'Permission must have action');
    assert.ok(item.category, 'Permission must have category');
  }
});

test('2. Role Permission Ceilings & Boundary Enforcements', () => {
  // SUPER_ADMIN has full ceiling
  assert.equal(
    ROLE_PERMISSION_CEILINGS.SUPER_ADMIN.ceiling.length,
    PERMISSIONS_CATALOG.length,
    'SUPER_ADMIN must have all permissions in ceiling'
  );

  // EMPLOYEE role ceiling must NOT allow critical admin or finance tasks
  const employeeCeiling = new Set(ROLE_PERMISSION_CEILINGS.EMPLOYEE.ceiling);
  assert.equal(employeeCeiling.has('financial.invoices.manage'), false, 'EMPLOYEE cannot manage invoices');
  assert.equal(employeeCeiling.has('role.hierarchy.manage'), false, 'EMPLOYEE cannot manage role hierarchy');
  assert.equal(employeeCeiling.has('employee.records.delete'), false, 'EMPLOYEE cannot delete employees');
  assert.equal(employeeCeiling.has('leave.request.create'), true, 'EMPLOYEE can apply for leave');
  assert.equal(employeeCeiling.has('workspace.dashboard.view'), true, 'EMPLOYEE can view dashboard');

  // HR role ceiling must NOT allow license payment or server administration
  const hrCeiling = new Set(ROLE_PERMISSION_CEILINGS.HR.ceiling);
  assert.equal(hrCeiling.has('financial.invoices.manage'), false, 'HR ceiling forbids financial invoice payments');
  assert.equal(hrCeiling.has('employee.records.view'), true, 'HR ceiling includes employee view');
  assert.equal(hrCeiling.has('employee.records.edit'), true, 'HR ceiling includes employee edit');
  assert.equal(hrCeiling.has('leave.request.approve'), true, 'HR ceiling includes leave approve');
});

test('3. Same Role, Different Access Levels: Senior HR vs Junior HR', () => {
  const seniorHrProfile = DEFAULT_ACCESS_PROFILES.find((p) => p.name === 'Senior HR');
  const juniorHrProfile = DEFAULT_ACCESS_PROFILES.find((p) => p.name === 'Junior HR');

  assert.ok(seniorHrProfile, 'Senior HR profile must exist');
  assert.ok(juniorHrProfile, 'Junior HR profile must exist');
  assert.equal(seniorHrProfile.role, 'HR');
  assert.equal(juniorHrProfile.role, 'HR');

  // Senior HR can approve leave, edit employee records, export reports
  assert.equal(seniorHrProfile.permissions['leave.request.approve'], 'ALLOW');
  assert.equal(seniorHrProfile.permissions['employee.records.edit'], 'ALLOW');
  assert.equal(seniorHrProfile.permissions['reports.analytics.export'], 'ALLOW');

  // Junior HR CANNOT approve leave, edit employee records, or export reports
  assert.equal(juniorHrProfile.permissions['leave.request.approve'], 'DENY');
  assert.equal(juniorHrProfile.permissions['employee.records.edit'], 'DENY');
  assert.equal(juniorHrProfile.permissions['reports.analytics.export'], 'DENY');

  // Both have employee.records.view
  assert.equal(seniorHrProfile.permissions['employee.records.view'], 'ALLOW');
  assert.equal(juniorHrProfile.permissions['employee.records.view'], 'ALLOW');
});

test('4. Finance Profiles: Senior Finance vs Junior Finance', () => {
  const srFin = DEFAULT_ACCESS_PROFILES.find((p) => p.name === 'Senior Finance');
  const jrFin = DEFAULT_ACCESS_PROFILES.find((p) => p.name === 'Junior Finance');

  assert.ok(srFin && jrFin, 'Both finance profiles must exist');
  assert.equal(srFin.role, 'FINANCE');
  assert.equal(jrFin.role, 'FINANCE');

  // Senior can manage invoices & pay quotas, Junior cannot
  assert.equal(srFin.permissions['financial.invoices.manage'], 'ALLOW');
  assert.equal(jrFin.permissions['financial.invoices.manage'], 'DENY');
  assert.equal(srFin.permissions['reports.analytics.export'], 'ALLOW');
  assert.equal(jrFin.permissions['reports.analytics.export'], 'DENY');

  // Both can view invoices
  assert.equal(srFin.permissions['financial.invoices.view'], 'ALLOW');
  assert.equal(jrFin.permissions['financial.invoices.view'], 'ALLOW');
});

test('5. Precedence Rules: Explicit User DENY Overrides Role/Profile ALLOW', () => {
  // Simulate resolution logic
  function resolveEffective(role, ceilingKeys, profilePerms, userOverrides, permKey) {
    const isWithinCeiling = ceilingKeys.has(permKey);
    if (!isWithinCeiling) return { allowed: false, source: 'CEILING_RESTRICTED' };

    if (userOverrides && userOverrides[permKey]) {
      const type = userOverrides[permKey];
      return {
        allowed: type === 'ALLOW',
        source: type === 'DENY' ? 'USER_OVERRIDE_DENY' : 'USER_OVERRIDE_ALLOW',
      };
    }

    if (profilePerms && profilePerms[permKey]) {
      const type = profilePerms[permKey];
      return {
        allowed: type === 'ALLOW',
        source: type === 'DENY' ? 'PROFILE_DENY' : 'PROFILE_ALLOW',
      };
    }

    return { allowed: false, source: 'ROLE_DEFAULT' };
  }

  const hrCeiling = new Set(ROLE_PERMISSION_CEILINGS.HR.ceiling);
  const srHrProfile = DEFAULT_ACCESS_PROFILES.find((p) => p.name === 'Senior HR').permissions;

  // Case A: Profile ALLOW, but User has individual DENY override
  const result1 = resolveEffective(
    'HR',
    hrCeiling,
    srHrProfile,
    { 'employee.records.edit': 'DENY' },
    'employee.records.edit'
  );
  assert.equal(result1.allowed, false, 'User override DENY must override profile ALLOW');
  assert.equal(result1.source, 'USER_OVERRIDE_DENY');

  // Case B: Permission outside role ceiling, even if user has ALLOW override
  const result2 = resolveEffective(
    'HR',
    hrCeiling,
    srHrProfile,
    { 'financial.invoices.manage': 'ALLOW' },
    'financial.invoices.manage'
  );
  assert.equal(result2.allowed, false, 'Cannot exceed role ceiling even with user ALLOW');
  assert.equal(result2.source, 'CEILING_RESTRICTED');
});

test('6. Data Scope Access Rules & Hierarchy Resolution', () => {
  function checkDataScope(scope, user, target, reportingDownline = []) {
    if (scope.scopeType === 'ALL') return true;
    if (target.id === user.id) return true;

    if (scope.scopeType === 'OWN') return false;

    if (scope.scopeType === 'DIRECT_REPORTS') {
      return target.managerId === user.id;
    }

    if (scope.scopeType === 'REPORTING_TREE') {
      return reportingDownline.includes(target.id);
    }

    if (scope.scopeType === 'DEPARTMENT') {
      const allowed = new Set([user.department, ...(scope.allowedDepartmentIds || [])]);
      return allowed.has(target.department);
    }

    return false;
  }

  const managerUser = { id: 'mgr-1', department: 'Engineering' };
  const directReport = { id: 'emp-1', managerId: 'mgr-1', department: 'Engineering' };
  const indirectReport = { id: 'emp-2', managerId: 'emp-1', department: 'Engineering' };
  const otherDeptEmployee = { id: 'emp-3', managerId: 'mgr-2', department: 'Marketing' };

  // DIRECT_REPORTS scope
  assert.equal(
    checkDataScope({ scopeType: 'DIRECT_REPORTS' }, managerUser, directReport),
    true,
    'Manager can access direct report'
  );
  assert.equal(
    checkDataScope({ scopeType: 'DIRECT_REPORTS' }, managerUser, indirectReport),
    false,
    'Manager with DIRECT_REPORTS cannot access indirect report'
  );

  // REPORTING_TREE scope
  assert.equal(
    checkDataScope({ scopeType: 'REPORTING_TREE' }, managerUser, indirectReport, ['emp-1', 'emp-2']),
    true,
    'Senior Manager with REPORTING_TREE can access downline indirect report'
  );

  // DEPARTMENT scope
  assert.equal(
    checkDataScope({ scopeType: 'DEPARTMENT' }, managerUser, indirectReport),
    true,
    'Can access employee in same department'
  );
  assert.equal(
    checkDataScope({ scopeType: 'DEPARTMENT' }, managerUser, otherDeptEmployee),
    false,
    'Cannot access employee in different department'
  );
});

test('7. requirePermission Middleware Enforcement (HTTP 403 on denial)', async () => {
  const middleware = requirePermission('financial.invoices.manage');

  // Case A: Unauthenticated user -> 401
  let statusCode = null;
  let jsonResponse = null;
  const mockRes = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
  };

  await middleware({ user: null }, mockRes, () => {});
  assert.equal(statusCode, 401, 'Unauthenticated user must be returned HTTP 401');

  // Case B: Denied user -> 403
  let calledNext = false;
  const mockReqDenied = {
    user: {
      id: 'emp-non-admin',
      userId: 'emp-non-admin',
      role: 'EMPLOYEE',
      tenantId: 'mock-tenant-id',
      status: 'ACTIVE',
    },
    params: {},
    body: {},
  };

  statusCode = null;
  await middleware(mockReqDenied, mockRes, () => {
    calledNext = true;
  });

  assert.equal(statusCode, 403, 'Unauthorized user must receive HTTP 403');
  assert.equal(calledNext, false, 'Next middleware must not be called when denied');
  assert.ok(jsonResponse.error.includes('insufficient permissions'));
});
