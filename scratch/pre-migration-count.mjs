import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const [goals, tasks, statuses] = await Promise.all([
    p.goal.count(),
    p.task.count(),
    p.goal.groupBy({ by: ['status'], _count: { id: true } }),
  ]);
  console.log('Pre-migration counts:');
  console.log('  Goals:', goals);
  console.log('  Tasks:', tasks);
  console.log('  Status breakdown:', JSON.stringify(statuses, null, 2));
} finally {
  await p.$disconnect();
}
