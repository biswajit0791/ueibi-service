import { PrismaClient } from '@prisma/client';
import { createTask, updateTask } from '../src/controllers/task.controller.js';
import { visibleTaskWhere } from '../src/services/taskVisibility.service.js';

const prisma = new PrismaClient();

function createMockRes() {
  return {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
  };
}

export async function runSpecialTaskVerification() {
  console.log('=================================================================');
  console.log('   SPECIAL TASK & NORMAL TASK SEPARATION VERIFICATION TESTS     ');
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, desc) {
    if (cond) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`);
      failed++;
    }
  }

  try {
    const tenant = await prisma.tenant.findFirst({
      include: {
        users: {
          where: { isDeleted: false, status: 'ACTIVE' },
          take: 10,
        },
      },
    });

    if (!tenant || tenant.users.length === 0) {
      console.warn('No active tenant found to run live DB tests.');
      return;
    }

    const tenantId = tenant.id;
    const managerUser = tenant.users.find(u => ['MANAGER', 'ADMIN', 'HR', 'SUPER_ADMIN'].includes(u.role)) || tenant.users[0];
    const otherUser = tenant.users.find(u => u.id !== managerUser.id) || tenant.users[0];

    console.log(`Testing with Tenant: ${tenant.name} (${tenantId})`);
    console.log(`Manager User: ${managerUser.name} (${managerUser.role})`);
    console.log(`Target User: ${otherUser.name} (${otherUser.role})\n`);

    // --------------------------------------------------------------------------
    // Test 1: Normal Task Creation rejects isStandalone: true
    // --------------------------------------------------------------------------
    console.log('--- Test 1: Normal Workflow Rejects isStandalone ---');
    {
      const req = {
        tenantId,
        user: managerUser,
        body: {
          title: 'Normal Task Attempting Standalone Flag',
          workflowType: 'normal',
          isStandalone: true,
          priority: 'medium',
          employeeId: managerUser.id,
        },
      };
      const res = createMockRes();
      await createTask(req, res);
      assert(
        res.statusCode === 400 && res.data?.message?.includes('Special task flags'),
        `Normal workflow with isStandalone: true rejected with 400: "${res.data?.message}"`
      );
    }

    // --------------------------------------------------------------------------
    // Test 2: Normal Task Creation rejects isPrivate: true
    // --------------------------------------------------------------------------
    console.log('\n--- Test 2: Normal Workflow Rejects isPrivate ---');
    {
      const req = {
        tenantId,
        user: managerUser,
        body: {
          title: 'Normal Task Attempting Private Flag',
          workflowType: 'normal',
          isPrivate: true,
          priority: 'medium',
          employeeId: managerUser.id,
        },
      };
      const res = createMockRes();
      await createTask(req, res);
      assert(
        res.statusCode === 400 && res.data?.message?.includes('Special task flags'),
        `Normal workflow with isPrivate: true rejected with 400: "${res.data?.message}"`
      );
    }

    // --------------------------------------------------------------------------
    // Test 3: Normal Task Creation succeeds with server defaults (isStandalone: false, isPrivate: false)
    // --------------------------------------------------------------------------
    console.log('\n--- Test 3: Normal Workflow Sets Server Defaults ---');
    let createdNormalTaskId = null;
    {
      const req = {
        tenantId,
        user: managerUser,
        body: {
          title: `Normal Standard Task ${Date.now()}`,
          workflowType: 'normal',
          priority: 'medium',
          employeeId: managerUser.id,
          startDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        },
      };
      const res = createMockRes();
      await createTask(req, res);
      assert(
        res.statusCode === 200 || res.statusCode === 201,
        `Normal task created successfully (Status: ${res.statusCode})`
      );
      assert(
        res.data?.isStandalone === false && res.data?.isPrivate === false,
        `Normal task enforces isStandalone=false and isPrivate=false`
      );
      createdNormalTaskId = res.data?.id;
    }

    // --------------------------------------------------------------------------
    // Test 4: Special Task Creation rejects Private flag if assigned to another user
    // --------------------------------------------------------------------------
    console.log('\n--- Test 4: Special Workflow Rejects Private Task for Other Users ---');
    if (otherUser.id !== managerUser.id) {
      const req = {
        tenantId,
        user: managerUser,
        body: {
          title: 'Unauthorized Private Task for Colleague',
          workflowType: 'special',
          isPrivate: true,
          priority: 'medium',
          employeeId: otherUser.id,
        },
      };
      const res = createMockRes();
      await createTask(req, res);
      assert(
        res.statusCode === 403 && res.data?.message?.includes('yourself'),
        `Private task assigned to other user rejected with 403: "${res.data?.message}"`
      );
    } else {
      console.log('  [SKIP] Need two distinct users in tenant to test other-user private rejection.');
    }

    // --------------------------------------------------------------------------
    // Test 5: Special Task Creation allows Private task for self with weight = 0
    // --------------------------------------------------------------------------
    console.log('\n--- Test 5: Special Workflow Creates Private Task for Self ---');
    let createdPrivateTaskId = null;
    {
      const req = {
        tenantId,
        user: managerUser,
        body: {
          title: `Personal Confidential Task ${Date.now()}`,
          workflowType: 'special',
          isPrivate: true,
          priority: 'medium',
          employeeId: managerUser.id,
          startDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        },
      };
      const res = createMockRes();
      await createTask(req, res);
      assert(
        res.statusCode === 200 || res.statusCode === 201,
        `Special private task created successfully (Status: ${res.statusCode})`
      );
      assert(
        res.data?.isPrivate === true,
        `Special private task has isPrivate=true`
      );
      assert(
        res.data?.weight === 0,
        `Special private task automatically carries 0% impact weight`
      );
      createdPrivateTaskId = res.data?.id;
    }

    // --------------------------------------------------------------------------
    // Test 6: Special Task Creation allows Standalone unmonitored task with weight = 0 and goalId = null
    // --------------------------------------------------------------------------
    console.log('\n--- Test 6: Special Workflow Creates Standalone Unmonitored Task ---');
    let createdStandaloneTaskId = null;
    {
      const req = {
        tenantId,
        user: managerUser,
        body: {
          title: `Standalone Ad-hoc Task ${Date.now()}`,
          workflowType: 'special',
          isStandalone: true,
          priority: 'medium',
          employeeId: managerUser.id,
          startDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        },
      };
      const res = createMockRes();
      await createTask(req, res);
      assert(
        res.statusCode === 200 || res.statusCode === 201,
        `Special standalone task created successfully (Status: ${res.statusCode})`
      );
      assert(
        res.data?.isStandalone === true,
        `Special standalone task has isStandalone=true`
      );
      assert(
        res.data?.goalId === null,
        `Special standalone task is unmonitored with goalId=null`
      );
      assert(
        res.data?.weight === 0,
        `Special standalone task carries 0% impact weight`
      );
      createdStandaloneTaskId = res.data?.id;
    }

    // --------------------------------------------------------------------------
    // Test 7: Normal Task Edit rejects setting special flags
    // --------------------------------------------------------------------------
    console.log('\n--- Test 7: Normal Workflow Edit Rejects Special Flags ---');
    if (createdNormalTaskId) {
      const req = {
        tenantId,
        user: managerUser,
        params: { id: createdNormalTaskId },
        body: {
          workflowType: 'normal',
          isStandalone: true,
        },
      };
      const res = createMockRes();
      await updateTask(req, res);
      assert(
        res.statusCode === 400 && res.data?.message?.includes('Special task flags'),
        `Normal edit with isStandalone: true rejected with 400: "${res.data?.message}"`
      );
    }

    // --------------------------------------------------------------------------
    // Test 8: Manager Dashboard / Query Excludes Subordinates' Private Tasks
    // --------------------------------------------------------------------------
    console.log('\n--- Test 8: Manager Visibility Excludes Private Tasks ---');
    {
      const visResult = await visibleTaskWhere({
        user: managerUser,
        tenantId,
        employeeId: 'all',
      });
      assert(
        visResult && visResult.where,
        'visibleTaskWhere returns where clause for manager all query'
      );
      const hasPrivateFilter = visResult.where?.AND?.some(clause =>
        Array.isArray(clause?.OR) && clause.OR.some(cond => cond.isPrivate === false)
      );
      assert(
        hasPrivateFilter,
        'Manager visibleTaskWhere contains AND { OR: [{ isPrivate: false }, ...] } to exclude subordinates private tasks'
      );
    }

    // Clean up test tasks created during verification
    const cleanupIds = [createdNormalTaskId, createdPrivateTaskId, createdStandaloneTaskId].filter(Boolean);
    if (cleanupIds.length > 0) {
      await prisma.task.deleteMany({
        where: { id: { in: cleanupIds } },
      });
      console.log(`\nCleaned up ${cleanupIds.length} verification test tasks.`);
    }

  } catch (err) {
    console.error('Verification encountered an unhandled error:', err);
    failed++;
  }

  console.log('\n=================================================================');
  console.log(`   SPECIAL TASK VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=================================================================\n');

  return { passed, failed };
}

// Self-run when executed directly
if (process.argv[1]?.endsWith('special-task-verification.js')) {
  runSpecialTaskVerification()
    .then(({ failed }) => {
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
