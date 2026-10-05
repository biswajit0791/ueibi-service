/**
 * @file seedTasksAndGoals.js
 * @description Safe, idempotent, enterprise-grade seed script for Goals and Tasks.
 *
 * Populates realistic Goals and Tasks across all statuses and fields for FY 2024-25,
 * FY 2025-26 and FY 2026-27 for all active tenant users (defaulting to the usifdn tenant).
 *
 * Usage:
 *   node seeddata/seedTasksAndGoals.js
 *   node seeddata/seedTasksAndGoals.js --tenant=usifdn
 *   node seeddata/seedTasksAndGoals.js --all
 *   node seeddata/seedTasksAndGoals.js --dry-run
 */

import { PrismaClient } from '@prisma/client';
import { DEPARTMENT_TEMPLATES } from './taskGoalTemplates.js';

const prisma = new PrismaClient();

// Parse CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const seedAllTenants = args.includes('--all');
const tenantArg = args.find(a => a.startsWith('--tenant='));
const targetTenantQuery = tenantArg ? tenantArg.split('=')[1] : 'usifdn';

const FINANCIAL_YEARS = ['FY 2024-25', 'FY 2025-26', 'FY 2026-27'];

async function main() {
  console.log('\n================================================================');
  console.log('🚀 ENTERPRISE GOAL & TASK SEED RUNNER');
  console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (Simulation only)' : '💾 SAFE COMMIT (Live DB)'}`);
  console.log(`Target: ${seedAllTenants ? '🌐 ALL TENANTS' : `🏢 Tenant matching "${targetTenantQuery}"`}`);
  console.log('================================================================\n');

  // 1. Locate Target Tenant(s)
  let tenants = [];
  if (seedAllTenants) {
    tenants = await prisma.tenant.findMany({
      where: { isPlatform: false },
      orderBy: { createdAt: 'asc' },
    });
  } else {
    const single = await prisma.tenant.findFirst({
      where: {
        OR: [
          { domainName: { contains: targetTenantQuery, mode: 'insensitive' } },
          { companyName: { contains: targetTenantQuery, mode: 'insensitive' } },
          { tenantCode: { contains: targetTenantQuery, mode: 'insensitive' } },
          { id: targetTenantQuery },
        ],
      },
    });
    if (single) tenants = [single];
  }

  if (tenants.length === 0) {
    console.error(`❌ No tenant found matching "${targetTenantQuery}". Aborting.`);
    process.exit(1);
  }

  const grandSummary = {
    tenants: tenants.length,
    usersProcessed: 0,
    goalsCreated: 0,
    goalsExisting: 0,
    tasksCreated: 0,
    tasksExisting: 0,
    milestonesCreated: 0,
    byStatus: {
      todo: 0,
      in_progress: 0,
      pending_on_others: 0,
      in_review: 0,
      done: 0,
    },
    byFY: {
      'FY 2024-25': 0,
      'FY 2025-26': 0,
      'FY 2026-27': 0,
    },
  };

  for (const tenant of tenants) {
    console.log(`\n🏢 Processing Tenant: "${tenant.companyName}" (${tenant.domainName}) [ID: ${tenant.id}]`);
    console.log('----------------------------------------------------------------');

    // Fetch all active users in this tenant
    const users = await prisma.tenantUser.findMany({
      where: { tenantId: tenant.id, isDeleted: false },
      include: { manager: true },
      orderBy: { createdAt: 'asc' },
    });

    if (users.length === 0) {
      console.log('  ⚠️  No active users found in this tenant. Skipping.');
      continue;
    }

    console.log(`  👥 Found ${users.length} active users to populate with Goals & Tasks.\n`);

    // Find default creator / manager for goals in this tenant
    const hrOrAdmin = users.find(u => ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(u.role)) || users[0];
    const defaultManager = users.find(u => u.role === 'MANAGER') || hrOrAdmin;

    for (const user of users) {
      grandSummary.usersProcessed++;
      const userDept = user.department && DEPARTMENT_TEMPLATES[user.department]
        ? user.department
        : (user.role === 'FINANCE' ? 'Finance' : (user.role === 'HR' ? 'HR' : 'Engineering'));

      const deptTemplates = DEPARTMENT_TEMPLATES[userDept] || DEPARTMENT_TEMPLATES.Engineering;
      console.log(`  👤 User: ${user.name} (${user.email}) | Role: ${user.role} | Dept: ${userDept}`);

      for (const fy of FINANCIAL_YEARS) {
        const goalTemplates = deptTemplates[fy] || [];

        for (const tmpl of goalTemplates) {
          const goalData = tmpl.goal;
          const taskTemplates = tmpl.tasks || [];

          // Safe Idempotent Check: does this goal already exist for this user & FY?
          let goal = await prisma.goal.findFirst({
            where: {
              tenantId: tenant.id,
              employeeId: user.id,
              title: goalData.title,
              financialYear: fy,
            },
          });

          if (!goal) {
            if (!isDryRun) {
              goal = await prisma.goal.create({
                data: {
                  tenantId: tenant.id,
                  employeeId: user.id,
                  createdById: hrOrAdmin.id,
                  createdBy: hrOrAdmin.name,
                  title: goalData.title,
                  description: goalData.description,
                  category: goalData.category || 'Technical Skills',
                  priority: goalData.priority || 'medium',
                  goalType: goalData.goalType || 'General',
                  status: goalData.status || 'ACTIVE',
                  approvalMode: 'MANAGER_APPROVAL',
                  progress: goalData.progress || 0,
                  financialYear: fy,
                  quarter: goalData.quarter || 'Q1',
                  startDate: new Date(goalData.startDate),
                  targetDate: new Date(goalData.targetDate),
                  dueDate: new Date(goalData.dueDate),
                  milestones: goalData.milestones || taskTemplates.length,
                  completedMilestones: goalData.completedMilestones || 0,
                  weightLockExempt: false,
                },
              });

              // Create GoalAssignment
              await prisma.goalAssignment.upsert({
                where: {
                  goalId_employeeId: {
                    goalId: goal.id,
                    employeeId: user.id,
                  },
                },
                update: {},
                create: {
                  tenantId: tenant.id,
                  goalId: goal.id,
                  employeeId: user.id,
                  assignedById: hrOrAdmin.id,
                  status: goalData.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
                  progress: goalData.progress || 0,
                },
              }).catch(() => {});

              // Log Goal Audit
              await prisma.goalAuditLog.create({
                data: {
                  goalId: goal.id,
                  performedById: hrOrAdmin.id,
                  action: 'created',
                  details: `Goal "${goal.title}" seeded for ${fy}.`,
                },
              }).catch(() => {});
            }
            grandSummary.goalsCreated++;
            console.log(`    🎯 [${fy}] Created Goal: "${goalData.title}" (${goalData.status})`);
          } else {
            grandSummary.goalsExisting++;
            console.log(`    ℹ️  [${fy}] Existing Goal: "${goal.title}"`);
          }

          // Populate Tasks under this Goal
          for (const t of taskTemplates) {
            // Check if task already exists
            const existingTask = await prisma.task.findFirst({
              where: {
                tenantId: tenant.id,
                employeeId: user.id,
                title: t.title,
                financialYear: fy,
              },
            });

            if (existingTask) {
              grandSummary.tasksExisting++;
              continue;
            }

            // Build dependency metadata if task requires dependency
            let dependencyObj = null;
            if (t.status === 'pending_on_others' || t.dependencyRequiresManager) {
              const depAssignee = user.managerId
                ? users.find(u => u.id === user.managerId) || defaultManager
                : defaultManager;

              dependencyObj = {
                assigneeId: depAssignee.id,
                depTitle: t.dependencyTitle || 'Awaiting Architectural Review & Sign-off',
                status: 'pending_approval',
                escalated: false,
              };
            }

            if (!isDryRun) {
              const createdTask = await prisma.task.create({
                data: {
                  tenantId: tenant.id,
                  employeeId: user.id,
                  goalId: goal ? goal.id : null,
                  title: t.title,
                  description: t.description,
                  priority: t.priority || 'medium',
                  status: t.status || 'todo',
                  progress: t.progress || 0,
                  weight: t.weight || 20,
                  startDate: t.startDate ? new Date(t.startDate) : null,
                  dueDate: t.dueDate ? new Date(t.dueDate) : null,
                  actualStartDate: t.actualStartDate ? new Date(t.actualStartDate) : null,
                  actualCompletionDate: t.actualCompletionDate ? new Date(t.actualCompletionDate) : null,
                  financialYear: fy,
                  tags: t.tags || null,
                  dependency: dependencyObj,
                  isPrivate: false,
                  isStandalone: false,
                  isMilestoneTracked: Boolean(t.isMilestoneTracked),
                },
              });

              // Create TaskMilestones if milestone-tracked
              if (t.isMilestoneTracked && Array.isArray(t.milestones)) {
                for (const m of t.milestones) {
                  await prisma.taskMilestone.create({
                    data: {
                      tenantId: tenant.id,
                      taskId: createdTask.id,
                      order: m.order,
                      title: m.title,
                      dueDate: new Date(m.dueDate),
                      status: m.status || 'PENDING_APPROVAL',
                      isDone: Boolean(m.isDone),
                      watcherEmails: [user.email, (user.manager?.email || defaultManager.email)],
                    },
                  }).catch(() => {});
                  grandSummary.milestonesCreated++;
                }
              }

              // Create TaskAuditLog
              await prisma.taskAuditLog.create({
                data: {
                  taskId: createdTask.id,
                  performedById: user.id,
                  action: 'created',
                  details: `Task created for ${fy} under goal "${goal?.title}".`,
                },
              }).catch(() => {});

              // Create sample comment if in review or done
              if (['in_review', 'done'].includes(t.status)) {
                await prisma.taskComment.create({
                  data: {
                    taskId: createdTask.id,
                    authorId: defaultManager.id,
                    comment: t.status === 'done'
                      ? 'Verified and tested against acceptance criteria. Excellent delivery.'
                      : 'Initial implementation submitted for peer review. Pull request attached.',
                    attachments: [],
                  },
                }).catch(() => {});
              }
            }

            grandSummary.tasksCreated++;
            grandSummary.byStatus[t.status] = (grandSummary.byStatus[t.status] || 0) + 1;
            grandSummary.byFY[fy] = (grandSummary.byFY[fy] || 0) + 1;
            console.log(`      ⚡ [${t.status.toUpperCase()}] "${t.title}" (${t.weight}%)`);
          }
        }
      }
      console.log('');
    }
  }

  console.log('\n================================================================');
  console.log('📊 SEED EXECUTION SUMMARY');
  console.log('================================================================');
  console.log(`Tenants Processed:    ${grandSummary.tenants}`);
  console.log(`Users Processed:      ${grandSummary.usersProcessed}`);
  console.log(`Goals Created:        ${grandSummary.goalsCreated} (Existing: ${grandSummary.goalsExisting})`);
  console.log(`Tasks Created:        ${grandSummary.tasksCreated} (Existing: ${grandSummary.tasksExisting})`);
  console.log(`Milestones Created:   ${grandSummary.milestonesCreated}`);
  console.log('\nTasks Breakdown by Financial Year:');
  console.log(`  • FY 2024-25:       ${grandSummary.byFY['FY 2024-25']} tasks`);
  console.log(`  • FY 2025-26:       ${grandSummary.byFY['FY 2025-26']} tasks`);
  console.log(`  • FY 2026-27:       ${grandSummary.byFY['FY 2026-27']} tasks`);
  console.log('\nTasks Breakdown by Kanban Column:');
  console.log(`  • To Do:            ${grandSummary.byStatus.todo}`);
  console.log(`  • In Progress:      ${grandSummary.byStatus.in_progress}`);
  console.log(`  • Dependencies/Hold:${grandSummary.byStatus.pending_on_others}`);
  console.log(`  • In Review:        ${grandSummary.byStatus.in_review}`);
  console.log(`  • Completed (Done): ${grandSummary.byStatus.done}`);
  console.log('================================================================\n');

  if (isDryRun) {
    console.log('💡 This was a dry run. No records were committed to the database.');
  } else {
    console.log('✅ Successfully seeded Goals and Tasks into PostgreSQL database!');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error during seed execution:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
