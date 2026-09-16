import http from 'node:http';
import jwt from 'jsonwebtoken';
import app from './src/app.js';
import { prisma } from './src/lib/prisma.js';
import { canViewDashboard, DASHBOARD_VISIBILITY } from './src/lib/dashboardPermissions.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production-min-32-chars-long';

const c = {
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  bold: (t) => `\x1b[1m${t}\x1b[0m`,
  gray: (t) => `\x1b[90m${t}\x1b[0m`,
};

let passedCount = 0;
let failedCount = 0;

function assert(condition, testName, detail = '') {
  if (condition) {
    passedCount++;
    console.log(`  ${c.green('✔')} ${testName}`);
  } else {
    failedCount++;
    console.error(`  ${c.red('✖')} ${testName}`);
    if (detail) console.error(`    ${c.gray(detail)}`);
  }
}

// ── Mock Users for Each Role ────────────────────────────────────────────────
const ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE', 'MANAGER', 'EMPLOYEE'];

const MOCK_USERS = {
  SUPER_ADMIN: { id: 'test-sa', email: 'sa@test.com', role: 'SUPER_ADMIN', name: 'Super Admin', tenantId: 'tenant-1', status: 'ACTIVE', isDeleted: false },
  ADMIN: { id: 'test-admin', email: 'admin@test.com', role: 'ADMIN', name: 'Company Admin', tenantId: 'tenant-1', status: 'ACTIVE', isDeleted: false },
  HR: { id: 'test-hr', email: 'hr@test.com', role: 'HR', name: 'HR Manager', tenantId: 'tenant-1', status: 'ACTIVE', isDeleted: false },
  FINANCE: { id: 'test-fin', email: 'fin@test.com', role: 'FINANCE', name: 'Finance Lead', tenantId: 'tenant-1', status: 'ACTIVE', isDeleted: false },
  MANAGER: { id: 'test-mgr', email: 'mgr@test.com', role: 'MANAGER', name: 'Team Manager', tenantId: 'tenant-1', status: 'ACTIVE', isDeleted: false },
  EMPLOYEE: { id: 'test-emp', email: 'emp@test.com', role: 'EMPLOYEE', name: 'Staff Employee', tenantId: 'tenant-1', status: 'ACTIVE', isDeleted: false },
};

const MOCK_USERS_BY_ID = Object.values(MOCK_USERS).reduce((acc, u) => {
  acc[u.id] = u;
  return acc;
}, {});

function signTestToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tenantId: user.tenantId,
    },
    JWT_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
}

const DASHBOARD_ENDPOINTS = {
  SUPER_ADMIN: '/api/dashboard/super-admin',
  ADMIN: '/api/dashboard/admin',
  HR: '/api/dashboard/hr',
  FINANCE: '/api/dashboard/finance',
  MANAGER: '/api/dashboard/manager',
  EMPLOYEE: '/api/dashboard/employee',
};

async function runTests() {
  console.log(c.bold(c.cyan('\n═══════════════════════════════════════════════════════════════')));
  console.log(c.bold(c.cyan('   DASHBOARD ROLE HIERARCHY & RBAC VERIFICATION SUITE')));
  console.log(c.bold(c.cyan('═══════════════════════════════════════════════════════════════\n')));

  // Intercept prisma.tenantUser.findUnique for mock test tokens so DB connection is not required
  const originalFindUnique = prisma.tenantUser.findUnique.bind(prisma);
  prisma.tenantUser.findUnique = async (args) => {
    if (args?.where?.id && MOCK_USERS_BY_ID[args.where.id]) {
      return MOCK_USERS_BY_ID[args.where.id];
    }
    return originalFindUnique(args);
  };
  prisma.tenantUser.findFirst = async (args) => {
    if (args?.where?.id && MOCK_USERS_BY_ID[args.where.id]) {
      return MOCK_USERS_BY_ID[args.where.id];
    }
    return null;
  };
  prisma.tenantUser.findMany = async () => {
    return Object.values(MOCK_USERS);
  };
  prisma.goal.count = async () => 0;
  prisma.goal.findMany = async () => [];

  // Start internal test server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. UNIT TEST: Centralized Permission Matrix Logic (36 Cases)
    console.log(c.bold('\n[TEST GROUP 1] Centralized Permission Matrix Logic (36 Combinations):'));
    for (const callerRole of ROLES) {
      const allowedDashboards = DASHBOARD_VISIBILITY[callerRole];
      for (const targetDashboard of ROLES) {
        const expected = allowedDashboards.includes(targetDashboard);
        const actual = canViewDashboard(callerRole, targetDashboard);
        assert(
          actual === expected,
          `canViewDashboard('${callerRole}', '${targetDashboard}') === ${expected}`
        );
      }
    }

    // 2. INTEGRATION TEST: Full 6x6 Dashboard HTTP API Endpoints (36 Cases)
    console.log(c.bold('\n[TEST GROUP 2] HTTP Dashboard API Endpoints (Full 6x6 Matrix):'));

    for (const callerRole of ROLES) {
      console.log(c.yellow(`\n  ▸ Testing Caller Role: ${callerRole}`));
      const user = MOCK_USERS[callerRole];
      const token = signTestToken(user);

      for (const targetRole of ROLES) {
        const path = DASHBOARD_ENDPOINTS[targetRole];
        const shouldPass = DASHBOARD_VISIBILITY[callerRole].includes(targetRole);

        const res = await fetch(`${baseUrl}${path}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (shouldPass) {
          // Authorized callers must NOT get 403 Forbidden!
          assert(
            res.status !== 403,
            `${callerRole} -> ${targetRole} Dashboard API: ALLOWED (Got HTTP ${res.status}, not 403)`
          );
        } else {
          // Unauthorized callers must be rejected with 403 Forbidden!
          assert(
            res.status === 403,
            `${callerRole} -> ${targetRole} Dashboard API: DENIED 403 Forbidden (Got HTTP ${res.status})`
          );
        }
      }
    }

    // 3. INTEGRATION TEST: Sensitive Backend APIs Protection
    console.log(c.bold('\n[TEST GROUP 3] Sensitive Backend APIs Scoping & Protection:'));

    // Employee calling Manager's direct reports -> must be 403
    {
      const empToken = signTestToken(MOCK_USERS.EMPLOYEE);
      const res = await fetch(`${baseUrl}/api/team/direct-reports`, {
        headers: { Authorization: `Bearer ${empToken}` },
      });
      assert(
        res.status === 403,
        `Employee calling /api/team/direct-reports is rejected with 403 Forbidden (Got HTTP ${res.status})`
      );
    }

    // Manager calling direct reports -> authorized (not 403)
    {
      const mgrToken = signTestToken(MOCK_USERS.MANAGER);
      const res = await fetch(`${baseUrl}/api/team/direct-reports`, {
        headers: { Authorization: `Bearer ${mgrToken}` },
      });
      assert(
        res.status !== 403,
        `Manager calling /api/team/direct-reports passes RBAC authorization (Got HTTP ${res.status})`
      );
    }

    // Employee calling /api/reports/analytics -> must be 403
    {
      const empToken = signTestToken(MOCK_USERS.EMPLOYEE);
      const res = await fetch(`${baseUrl}/api/reports/analytics`, {
        headers: { Authorization: `Bearer ${empToken}` },
      });
      assert(
        res.status === 403,
        `Employee calling /api/reports/analytics is rejected with 403 Forbidden (Got HTTP ${res.status})`
      );
    }

    // Manager calling /api/reports/analytics -> authorized (not 403)
    {
      const mgrToken = signTestToken(MOCK_USERS.MANAGER);
      const res = await fetch(`${baseUrl}/api/reports/analytics`, {
        headers: { Authorization: `Bearer ${mgrToken}` },
      });
      assert(
        res.status !== 403,
        `Manager calling /api/reports/analytics passes RBAC authorization (Got HTTP ${res.status})`
      );
    }

    // HR calling /api/reports/analytics -> authorized (not 403)
    {
      const hrToken = signTestToken(MOCK_USERS.HR);
      const res = await fetch(`${baseUrl}/api/reports/analytics`, {
        headers: { Authorization: `Bearer ${hrToken}` },
      });
      assert(
        res.status !== 403,
        `HR calling /api/reports/analytics passes RBAC authorization (Got HTTP ${res.status})`
      );
    }

    // 4. INTEGRATION TEST: Goal Board & Assignable Users Role Hierarchy
    console.log(c.bold('\n[TEST GROUP 4] Goal Board & Assignable Users RBAC Verification:'));

    // Test A: HR fetching /api/goals/assignable-users must not include SUPER_ADMIN or ADMIN
    {
      const hrToken = signTestToken(MOCK_USERS.HR);
      const res = await fetch(`${baseUrl}/api/goals/assignable-users`, {
        headers: { Authorization: `Bearer ${hrToken}` },
      });
      const data = await res.json();
      const userRoles = (data.users || []).map((u) => u.role);
      assert(
        !userRoles.includes('SUPER_ADMIN') && !userRoles.includes('ADMIN'),
        `HR getAssignableUsers excludes SUPER_ADMIN and ADMIN (Roles present: ${userRoles.join(', ')})`
      );
      assert(
        userRoles.includes('HR') && userRoles.includes('MANAGER') && userRoles.includes('EMPLOYEE'),
        `HR getAssignableUsers includes HR, MANAGER, and EMPLOYEE`
      );
    }

    // Test B: ADMIN fetching /api/goals/assignable-users must not include SUPER_ADMIN
    {
      const adminToken = signTestToken(MOCK_USERS.ADMIN);
      const res = await fetch(`${baseUrl}/api/goals/assignable-users`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = await res.json();
      const userRoles = (data.users || []).map((u) => u.role);
      assert(
        !userRoles.includes('SUPER_ADMIN'),
        `ADMIN getAssignableUsers excludes SUPER_ADMIN (Roles present: ${userRoles.join(', ')})`
      );
      assert(
        userRoles.includes('ADMIN') && userRoles.includes('HR') && userRoles.includes('EMPLOYEE'),
        `ADMIN getAssignableUsers includes ADMIN, HR, EMPLOYEE`
      );
    }

    // Test C: HR accessing Super Admin's goals -> 403 Forbidden
    {
      const hrToken = signTestToken(MOCK_USERS.HR);
      const res = await fetch(`${baseUrl}/api/goals?employeeId=test-sa`, {
        headers: { Authorization: `Bearer ${hrToken}` },
      });
      assert(
        res.status === 403,
        `HR fetching goals of SUPER_ADMIN is rejected with 403 Forbidden (Got HTTP ${res.status})`
      );
    }

    // Test D: HR accessing Admin's goals -> 403 Forbidden
    {
      const hrToken = signTestToken(MOCK_USERS.HR);
      const res = await fetch(`${baseUrl}/api/goals?employeeId=test-admin`, {
        headers: { Authorization: `Bearer ${hrToken}` },
      });
      assert(
        res.status === 403,
        `HR fetching goals of ADMIN is rejected with 403 Forbidden (Got HTTP ${res.status})`
      );
    }

    // Test E: Admin accessing Super Admin's goals -> 403 Forbidden
    {
      const adminToken = signTestToken(MOCK_USERS.ADMIN);
      const res = await fetch(`${baseUrl}/api/goals?employeeId=test-sa`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert(
        res.status === 403,
        `ADMIN fetching goals of SUPER_ADMIN is rejected with 403 Forbidden (Got HTTP ${res.status})`
      );
    }

    // Test F: Finance accessing HR's goals -> 403 Forbidden
    {
      const finToken = signTestToken(MOCK_USERS.FINANCE);
      const res = await fetch(`${baseUrl}/api/goals?employeeId=test-hr`, {
        headers: { Authorization: `Bearer ${finToken}` },
      });
      assert(
        res.status === 403,
        `FINANCE fetching goals of HR is rejected with 403 Forbidden (Got HTTP ${res.status})`
      );
    }
  } finally {
    server.close();
  }

  console.log(c.bold(c.cyan('\n───────────────────────────────────────────────────────────────')));
  console.log(c.bold(`Total Passed: ${c.green(passedCount)} | Total Failed: ${failedCount ? c.red(failedCount) : c.green(0)}`));
  console.log(c.bold(c.cyan('───────────────────────────────────────────────────────────────\n')));

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
