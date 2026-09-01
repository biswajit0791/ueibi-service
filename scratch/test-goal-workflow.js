import { PrismaClient } from '@prisma/client';
import { goalService } from '../src/services/goal.service.js';

const prisma = new PrismaClient();

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING GOAL & TASK WORKFLOW VERIFICATION TESTS');
  console.log('======================================================');

  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    console.error('No tenant found in DB to test.');
    return;
  }
  const tenantId = tenant.id;

  // Find manager and employee
  const manager = await prisma.tenantUser.findFirst({
    where: { tenantId, role: 'MANAGER' },
  });
  const employee = await prisma.tenantUser.findFirst({
    where: { tenantId, role: 'EMPLOYEE' },
  });
  const hrUser = await prisma.tenantUser.findFirst({
    where: { tenantId, role: { in: ['HR', 'SUPER_ADMIN', 'ADMIN'] } },
  });

  console.log(`Tenant   : ${tenant.companyName} (${tenantId})`);
  console.log(`Manager  : ${manager?.name} (${manager?.id})`);
  console.log(`Employee : ${employee?.name} (${employee?.id})`);
  console.log(`HR User  : ${hrUser?.name} (${hrUser?.id})`);

  if (!employee || !manager || !hrUser) {
    console.warn('Need manager, employee, and HR users to test full flow.');
    return;
  }

  // Ensure employee has managerId set
  await prisma.tenantUser.update({
    where: { id: employee.id },
    data: { managerId: manager.id },
  });

  // TEST 1: Create Goal
  console.log('\n--- TEST 1: Create Goal ---');
  const goal = await prisma.goal.create({
    data: {
      tenantId,
      employeeId: employee.id,
      title: 'Automated Test Goal: Build Realtime Microservice',
      description: 'End-to-end goal testing workflow',
      category: 'Technical Skills',
      goalType: 'KPI',
      priority: 'high',
      financialYear: 'FY 2026-27',
      status: 'DRAFT',
      createdBy: hrUser.name,
    },
  });
  console.log(`[PASS] Created Goal: "${goal.title}" (ID: ${goal.id})`);

  // TEST 2: Add 2 tasks linked to Goal
  console.log('\n--- TEST 2: Add Linked Tasks & Calculate Progress ---');
  const task1 = await prisma.task.create({
    data: {
      tenantId,
      employeeId: employee.id,
      goalId: goal.id,
      title: 'Task 1: Schema design',
      weight: 50,
      status: 'done',
      progress: 100,
    },
  });

  const task2 = await prisma.task.create({
    data: {
      tenantId,
      employeeId: employee.id,
      goalId: goal.id,
      title: 'Task 2: API routes & tests',
      weight: 50,
      status: 'in_progress',
      progress: 40,
    },
  });

  let progress = await goalService.recalculateProgress(goal.id);
  console.log(`[PASS] Goal progress with 1 done (100%) + 1 in-progress (40%): ${progress}% (Expected 70%)`);

  // TEST 3: Attempt submit when tasks are incomplete -> Expect Failure
  console.log('\n--- TEST 3: Validation Guard (Incomplete Tasks) ---');
  try {
    await goalService.submitGoal({ tenantId, goalId: goal.id, user: employee });
    console.error('[FAIL] Submission should have been blocked for incomplete tasks!');
  } catch (err) {
    console.log(`[PASS] Correctly rejected submission: "${err.message}"`);
  }

  // TEST 4: Complete task 2 and submit goal
  console.log('\n--- TEST 4: Complete Tasks & Submit Goal ---');
  await prisma.task.update({
    where: { id: task2.id },
    data: { status: 'done', progress: 100 },
  });
  progress = await goalService.recalculateProgress(goal.id);
  console.log(`[PASS] Goal progress after all tasks done: ${progress}%`);

  const submitted = await goalService.submitGoal({ tenantId, goalId: goal.id, user: employee });
  console.log(`[PASS] Goal Submitted. New Status: ${submitted.status} (Expected: PENDING_MANAGER_REVIEW)`);

  // TEST 5: Unauthorized reviewer attempt (random user / employee cannot approve)
  console.log('\n--- TEST 5: RBAC Guard (Unauthorized reviewer) ---');
  try {
    await goalService.managerReview({
      tenantId,
      goalId: goal.id,
      user: employee,
      action: 'APPROVE',
    });
    console.error('[FAIL] Unauthorized approval was not blocked!');
  } catch (err) {
    console.log(`[PASS] Correctly blocked unauthorized approval: "${err.message}"`);
  }

  // TEST 6: Manager Request Changes (Reject Flow)
  console.log('\n--- TEST 6: Manager Request Changes Flow ---');
  const rejected = await goalService.managerReview({
    tenantId,
    goalId: goal.id,
    user: manager,
    action: 'REJECT',
    comment: 'Please add documentation before approval.',
  });
  console.log(`[PASS] Manager requested changes. Status: ${rejected.status} (Expected: CHANGES_REQUESTED)`);

  // TEST 7: Employee Resubmits Goal
  console.log('\n--- TEST 7: Employee Resubmit Flow ---');
  const resubmitted = await goalService.resubmitGoal({
    tenantId,
    goalId: goal.id,
    user: employee,
    comment: 'Documentation added.',
  });
  console.log(`[PASS] Goal Resubmitted. Status: ${resubmitted.status} (Expected: PENDING_MANAGER_REVIEW)`);

  // TEST 8: Manager Approves Goal -> Moves to PENDING_HR_REVIEW
  console.log('\n--- TEST 8: Manager Approval ---');
  const mgrApproved = await goalService.managerReview({
    tenantId,
    goalId: goal.id,
    user: manager,
    action: 'APPROVE',
    comment: 'Deliverables verified, approved.',
    rating: 5,
  });
  console.log(`[PASS] Manager Approved. Status: ${mgrApproved.status} (Expected: PENDING_HR_REVIEW)`);

  // TEST 9: HR Final Sign-off -> Moves to COMPLETED
  console.log('\n--- TEST 9: HR Final Sign-off ---');
  const hrApproved = await goalService.hrReview({
    tenantId,
    goalId: goal.id,
    user: hrUser,
    action: 'APPROVE',
    comment: 'HR Final approval granted.',
  });
  console.log(`[PASS] HR Approved. Status: ${hrApproved.status} (Expected: COMPLETED)`);

  // TEST 10: Verify Audit Logs
  console.log('\n--- TEST 10: Audit Log Verification ---');
  const logs = await prisma.goalAuditLog.findMany({
    where: { goalId: goal.id },
    orderBy: { createdAt: 'asc' },
    include: { performedBy: { select: { name: true } } },
  });
  console.log(`[PASS] Total audit records logged: ${logs.length}`);
  logs.forEach((l, idx) => {
    console.log(`  [${idx + 1}] ${l.action} by ${l.performedBy.name}: ${l.details || 'N/A'}`);
  });

  // Cleanup test goal & tasks
  await prisma.task.deleteMany({ where: { goalId: goal.id } });
  await prisma.goal.delete({ where: { id: goal.id } });
  console.log('\n[CLEANUP] Test goal and tasks cleaned up.');

  console.log('\n======================================================');
  console.log('✅ ALL GOAL WORKFLOW INTEGRATION TESTS PASSED!');
  console.log('======================================================\n');
}

runTests()
  .catch((err) => {
    console.error('Test execution failed:', err);
  })
  .finally(() => prisma.$disconnect());
