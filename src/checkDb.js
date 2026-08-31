import { prisma } from './lib/prisma.js';

async function main() {
  const users = await prisma.tenantUser.findMany();
  console.log('--- USERS ---');
  users.forEach(u => console.log(`User: ${u.name} (ID: ${u.id}, Role: ${u.role})`));

  const goals = await prisma.goal.findMany();
  console.log('\n--- GOALS ---');
  goals.forEach(g => console.log(`Goal: ${g.title} (ID: ${g.id}, EmployeeId: ${g.employeeId})`));

  const tasks = await prisma.task.findMany();
  console.log('\n--- TASKS ---');
  tasks.forEach(t => console.log(`Task: ${t.title} (ID: ${t.id}, EmployeeId: ${t.employeeId}, GoalId: ${t.goalId}, FY: ${t.financialYear}, Standalone: ${t.isStandalone})`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
