import { PrismaClient } from '@prisma/client';
import { validateGoalDates, getTenantFinancialYear } from '../src/lib/financialYear.js';
import { getEligibleGoalOwners, createGoal } from '../src/controllers/goal.controller.js';
import { createTask } from '../src/controllers/task.controller.js';
import { getTopLevelEmployees } from '../src/controllers/companySettings.controller.js';

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

async function runVerification() {
  console.log('=================================================================');
  console.log('   GOAL & TASK MANAGEMENT REQUIREMENTS COMPREHENSIVE VERIFICATION');
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
    // --------------------------------------------------------------------------
    // 1. FINANCIAL YEAR & DATE VALIDATION (Req B.1 & B.2)
    // --------------------------------------------------------------------------
    console.log('--- 1. Financial Year & Goal Dates Validation ---');
    const settings = { financialYearStartMonth: 4, financialYearStartDay: 1 };
    const fy = getTenantFinancialYear(settings, new Date('2026-10-15'));
    assert(fy.label.includes('2026-2027') || fy.label.includes('2026-27'), `FY label is correctly computed: ${fy.label}`);
    assert(fy.endDate.startsWith('2027-03-31'), `FY end date is March 31 of following year: ${fy.endDate}`);

    // Backdated start date
    const pastVal = validateGoalDates({
      startDate: '2026-10-01',
      targetDate: '2026-12-31',
      settings,
      now: new Date('2026-10-15T00:00:00Z'),
    });
    assert(!pastVal.isValid && pastVal.error.includes('past'), 'Start date in the past is rejected');

    // Date beyond FY end date
    const beyondFyVal = validateGoalDates({
      startDate: '2026-10-15',
      targetDate: '2027-04-15',
      settings,
      now: new Date('2026-10-15T00:00:00Z'),
    });
    assert(!beyondFyVal.isValid && beyondFyVal.error.includes('financial year'), 'Target date beyond FY end is rejected');

    // Valid dates within current FY
    const validVal = validateGoalDates({
      startDate: '2026-10-15',
      targetDate: '2027-03-15',
      settings,
      now: new Date('2026-10-15T00:00:00Z'),
    });
    assert(validVal.isValid, 'Valid dates within current FY are accepted');

    // --------------------------------------------------------------------------
    // 2. FETCH DB FIXTURES
    // --------------------------------------------------------------------------
    console.log('\n--- 2. Fetching Tenant & Users for Integration Verification ---');
    const tenant = await prisma.tenant.findFirst({
      where: { status: 'ACTIVE' },
      include: {
        users: { where: { isDeleted: false, status: 'ACTIVE' } },
      },
    });

    if (!tenant || tenant.users.length === 0) {
      console.log('  [WARN] No active tenant found. Skipping DB controller tests.');
      return;
    }

    const employeeUser = tenant.users.find((u) => u.role === 'EMPLOYEE') || tenant.users[0];
    const managerUser = tenant.users.find((u) => u.role === 'MANAGER') || tenant.users.find((u) => u.id !== employeeUser.id);
    const elevatedUser = tenant.users.find((u) => ['ADMIN', 'SUPER_ADMIN', 'HR', 'CMD'].includes(u.role)) || managerUser;

    console.log(`  Tenant: ${tenant.name} (${tenant.id})`);
    console.log(`  Employee: ${employeeUser?.name} (${employeeUser?.id}) [${employeeUser?.role}]`);
    console.log(`  Manager: ${managerUser?.name} (${managerUser?.id}) [${managerUser?.role}]`);
    console.log(`  Elevated: ${elevatedUser?.name} (${elevatedUser?.id}) [${elevatedUser?.role}]`);

    const createdGoalIds = [];
    const createdTaskIds = [];

    // --------------------------------------------------------------------------
    // 3. GOAL OWNER SELECTION & ELIGIBILITY (Req A.1)
    // --------------------------------------------------------------------------
    console.log('\n--- 3. Goal Owner Selection & Eligibility Rules ---');
    // Eligible owners query for employee
    const reqEligible = { tenantId: tenant.id, user: employeeUser };
    const resEligible = createMockRes();
    await getEligibleGoalOwners(reqEligible, resEligible);
    assert(resEligible.statusCode === 200, 'getEligibleGoalOwners returns HTTP 200');
    const eligibleOwners = resEligible.data?.owners || [];
    assert(!eligibleOwners.some((o) => o.role === 'EMPLOYEE'), 'Eligible goal owners excludes plain employees');
    assert(!eligibleOwners.some((o) => o.id === employeeUser.id), 'Employee cannot see self in eligible owners');

    // Rule: Plain employee cannot be selected as Goal Owner
    const reqEmpOwner = {
      tenantId: tenant.id,
      user: employeeUser,
      body: {
        title: 'Test: Goal with Employee as Owner',
        startDate: '2026-10-15',
        targetDate: '2027-02-15',
        ownerId: employeeUser.id,
      },
    };
    const resEmpOwner = createMockRes();
    await createGoal(reqEmpOwner, resEmpOwner);
    assert(resEmpOwner.statusCode === 400, 'Selecting employee as Goal Owner is rejected with 400');
    assert(resEmpOwner.data?.error?.includes('employee cannot be selected as Goal Owner') || resEmpOwner.data?.error?.includes('Employees cannot select themselves'), 'Rejection message clearly explains employee owner rule');

    // --------------------------------------------------------------------------
    // 4. DYNAMIC GOAL APPROVAL ROUTING (Req A.3)
    // --------------------------------------------------------------------------
    console.log('\n--- 4. Dynamic Goal Approval Routing ---');
    // Case 1: Creator !== Owner -> Requires Approval (PENDING_APPROVAL, MANAGER_APPROVAL)
    const reqDiffOwner = {
      tenantId: tenant.id,
      user: employeeUser,
      body: {
        title: 'Test: Employee Goal Owned by Manager',
        startDate: '2026-10-15',
        targetDate: '2027-02-15',
        ownerId: managerUser.id,
        employeeIds: [employeeUser.id],
      },
    };
    const resDiffOwner = createMockRes();
    await createGoal(reqDiffOwner, resDiffOwner);
    assert(resDiffOwner.statusCode === 201, 'Goal creation with Manager owner succeeds');
    const goalDiff = resDiffOwner.data?.goal;
    if (goalDiff?.id) createdGoalIds.push(goalDiff.id);
    assert(goalDiff?.status === 'PENDING_APPROVAL', 'Creator !== Owner sets status to PENDING_APPROVAL');
    assert(goalDiff?.approvalMode === 'MANAGER_APPROVAL', 'Creator !== Owner sets approvalMode to MANAGER_APPROVAL');

    // Case 2: Creator === Owner -> No Approval Required (ACTIVE, AUTO_APPROVE)
    const reqSameOwner = {
      tenantId: tenant.id,
      user: managerUser,
      body: {
        title: 'Test: Manager Goal Owned by Self',
        startDate: '2026-10-15',
        targetDate: '2027-02-15',
        ownerId: managerUser.id,
        employeeIds: [managerUser.id],
      },
    };
    const resSameOwner = createMockRes();
    await createGoal(reqSameOwner, resSameOwner);
    assert(resSameOwner.statusCode === 201, 'Manager creating goal owned by self succeeds');
    const goalSame = resSameOwner.data?.goal;
    if (goalSame?.id) createdGoalIds.push(goalSame.id);
    assert(goalSame?.status === 'ACTIVE', 'Creator === Owner sets status immediately to ACTIVE');
    assert(goalSame?.approvalMode === 'AUTO_APPROVE', 'Creator === Owner sets approvalMode to AUTO_APPROVE');

    // --------------------------------------------------------------------------
    // 5. TASK SINGLE EMPLOYEE ASSIGNMENT (Req C.2)
    // --------------------------------------------------------------------------
    console.log('\n--- 5. Task Single Employee Assignment Rule ---');
    const reqMultiTask = {
      tenantId: tenant.id,
      user: managerUser,
      body: {
        title: 'Test: Multi-Assignee Task Attempt',
        employeeIds: [employeeUser.id, managerUser.id],
        startDate: '2026-10-15',
        dueDate: '2026-11-15',
      },
    };
    const resMultiTask = createMockRes();
    await createTask(reqMultiTask, resMultiTask);
    assert(resMultiTask.statusCode === 400, 'Multi-assignee task creation is rejected with HTTP 400');
    assert(resMultiTask.data?.message?.includes('only one employee'), 'Rejection message cites single employee assignment rule');

    // --------------------------------------------------------------------------
    // 6. TASK WEIGHTAGE & UNMONITORED/PRIVATE TASKS (Req C.1)
    // --------------------------------------------------------------------------
    console.log('\n--- 6. Task Weightage Calculation for Unmonitored / Private Tasks ---');
    // Standalone / private task
    const reqStandalone = {
      tenantId: tenant.id,
      user: employeeUser,
      body: {
        title: 'Test: Standalone Task',
        isStandalone: true,
        weight: 50,
        employeeId: employeeUser.id,
        startDate: '2026-10-15',
        dueDate: '2026-11-15',
      },
    };
    const resStandalone = createMockRes();
    await createTask(reqStandalone, resStandalone);
    assert(resStandalone.statusCode === 201, 'Standalone task created successfully');
    const taskStandalone = resStandalone.data;
    if (taskStandalone?.id) createdTaskIds.push(taskStandalone.id);
    assert(Number(taskStandalone?.weight) === 0, 'Standalone unmonitored task has weight automatically forced to 0');

    // Private task
    const reqPrivate = {
      tenantId: tenant.id,
      user: employeeUser,
      body: {
        title: 'Test: Private Task',
        isPrivate: true,
        weight: 30,
        employeeId: employeeUser.id,
        startDate: '2026-10-15',
        dueDate: '2026-11-15',
      },
    };
    const resPrivate = createMockRes();
    await createTask(reqPrivate, resPrivate);
    assert(resPrivate.statusCode === 201, 'Private task created successfully');
    const taskPrivate = resPrivate.data;
    if (taskPrivate?.id) createdTaskIds.push(taskPrivate.id);
    assert(Number(taskPrivate?.weight) === 0, 'Private task has weight automatically forced to 0');

    // Monitored task linked with Goal
    if (goalSame?.id) {
      const reqMonitored = {
        tenantId: tenant.id,
        user: managerUser,
        body: {
          title: 'Test: Monitored Goal Task',
          goalId: goalSame.id,
          weight: 25,
          employeeId: managerUser.id,
          startDate: '2026-10-15',
          dueDate: '2026-11-15',
        },
      };
      const resMonitored = createMockRes();
      await createTask(reqMonitored, resMonitored);
      assert(resMonitored.statusCode === 201, 'Monitored goal task created successfully');
      const taskMonitored = resMonitored.data;
      if (taskMonitored?.id) createdTaskIds.push(taskMonitored.id);
      assert(Number(taskMonitored?.weight) === 25, 'Monitored goal task carries designated weight');

      // --------------------------------------------------------------------------
      // 6b. TASK ASSIGNMENT RESTRICTION (GOAL ASSIGNEE ONLY)
      // --------------------------------------------------------------------------
      console.log('\n--- 6b. Task Assignment Restriction: Goal Assignee Only ---');
      // Attempt to assign task under goalSame to employeeUser who is NOT assigned to goalSame
      const reqInvalidAssignee = {
        tenantId: tenant.id,
        user: managerUser,
        body: {
          title: 'Test: Task Assigned to Non-Goal Assignee',
          goalId: goalSame.id,
          weight: 10,
          employeeId: employeeUser.id,
          startDate: '2026-10-15',
          dueDate: '2026-11-15',
        },
      };
      const resInvalidAssignee = createMockRes();
      await createTask(reqInvalidAssignee, resInvalidAssignee);
      assert(resInvalidAssignee.statusCode === 400, 'Task assignment to employee not assigned to parent Goal is rejected with HTTP 400');
      assert(resInvalidAssignee.data?.message?.includes('parent Goal'), 'Rejection message cites parent Goal assignee restriction');

      // Attempt by elevated role (HR/Admin) to assign task to non-goal assignee
      const reqElevatedInvalid = {
        tenantId: tenant.id,
        user: elevatedUser,
        body: {
          title: 'Test: Elevated Role Assigning to Non-Goal Assignee',
          goalId: goalSame.id,
          weight: 10,
          employeeId: employeeUser.id,
          startDate: '2026-10-15',
          dueDate: '2026-11-15',
        },
      };
      const resElevatedInvalid = createMockRes();
      await createTask(reqElevatedInvalid, resElevatedInvalid);
      assert(resElevatedInvalid.statusCode === 400, 'Elevated role cannot bypass Goal Assignee restriction (rejected with 400)');
    }

    // --------------------------------------------------------------------------
    // 7. DEPENDENCY MANAGER-LEVEL ASSIGNMENT ONLY (Req D.1)
    // --------------------------------------------------------------------------
    console.log('\n--- 7. Dependency Manager Role Enforcement ---');
    // Attempt dependency assigned to regular employee
    const reqEmpDep = {
      tenantId: tenant.id,
      user: managerUser,
      body: {
        title: 'Test: Task with Employee Dependency',
        employeeId: managerUser.id,
        startDate: '2026-10-15',
        dueDate: '2026-11-15',
        dependency: {
          title: 'Spec Review',
          type: 'pre',
          concernedPersonId: employeeUser.id,
          dueDate: '2026-11-01',
        },
      },
    };
    const resEmpDep = createMockRes();
    await createTask(reqEmpDep, resEmpDep);
    assert(resEmpDep.statusCode === 400, 'Dependency assigned to regular employee is rejected with 400');
    assert(resEmpDep.data?.message?.includes('manager-level employee'), 'Rejection message cites manager-level role requirement for dependencies');

    // Dependency assigned to manager
    const reqMgrDep = {
      tenantId: tenant.id,
      user: employeeUser,
      body: {
        title: 'Test: Task with Manager Dependency',
        employeeId: employeeUser.id,
        startDate: '2026-10-15',
        dueDate: '2026-11-15',
        dependency: {
          title: 'Architecture Signoff',
          type: 'pre',
          concernedPersonId: managerUser.id,
          dueDate: '2026-11-01',
        },
      },
    };
    const resMgrDep = createMockRes();
    await createTask(reqMgrDep, resMgrDep);
    assert(resMgrDep.statusCode === 201, 'Dependency assigned to manager-level employee is accepted');
    if (resMgrDep.data?.id) createdTaskIds.push(resMgrDep.data.id);

    // --------------------------------------------------------------------------
    // 8. WATCHERS: TOP-LEVEL EMPLOYEES ENDPOINT (Req E.1)
    // --------------------------------------------------------------------------
    console.log('\n--- 8. Top-Level Employees Endpoint for Milestone Watchers ---');
    const reqTopLevel = { tenantId: tenant.id, user: employeeUser };
    const resTopLevel = createMockRes();
    await getTopLevelEmployees(reqTopLevel, resTopLevel);
    assert(resTopLevel.statusCode === 200, 'getTopLevelEmployees returns HTTP 200');
    const topEmployees = resTopLevel.data?.employees || [];
    assert(Array.isArray(topEmployees), 'Returns array of top-level employees');
    const allTopRoles = topEmployees.every((e) => ['SUPER_ADMIN', 'ADMIN', 'CMD', 'DIRECTOR', 'HR', 'LEADERSHIP'].includes(e.role));
    assert(allTopRoles, 'All returned employees have designated top-level roles');
    const allHaveEmails = topEmployees.every((e) => Boolean(e.email));
    assert(allHaveEmails, 'All returned top-level employees have email addresses for watcher selection');

    // --------------------------------------------------------------------------
    // CLEANUP
    // --------------------------------------------------------------------------
    console.log('\n--- Cleaning up temporary test fixtures ---');
    for (const tid of createdTaskIds) {
      await prisma.task.delete({ where: { id: tid } }).catch(() => {});
    }
    for (const gid of createdGoalIds) {
      await prisma.goal.delete({ where: { id: gid } }).catch(() => {});
    }
    console.log('  Cleaned up all created test records.');

  } catch (err) {
    console.error('Unhandled verification error:', err);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n=================================================================');
  console.log(`TOTAL VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification();
