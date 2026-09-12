/**
 * @file clear-db.js
 * @description Clears all dummy / existing tenant data across all tables in the PostgreSQL database.
 *
 * It uses TRUNCATE ... CASCADE so that all foreign key dependencies, child records,
 * and tenant associations are wiped cleanly without FK constraint violations.
 *
 * Usage:
 *   node clear-db.js
 *   npm run clear-db
 *   node clear-db.js --seed  (clears everything and then re-seeds usifdn.org)
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

const prisma = new PrismaClient();

async function main() {
  console.log('====================================================');
  console.log('🧹 CLEARING ALL DATABASE DUMMY DATA...');
  console.log('====================================================');

  const tables = [
    'gallery_comments',
    'gallery_likes',
    'gallery_posts',
    'password_reset_tokens',
    'hub_events',
    'policy_audit_logs',
    'policy_acceptances',
    'policy_assignments',
    'policies',
    'non_joiner_records',
    'ex_employee_records',
    'ex_employer_reviews',
    'peer_feedbacks',
    'peer_nominations',
    'review_scores',
    'performance_reviews',
    'appraisal_parameters',
    'appraisal_cycles',
    'leave_balance_adjustments',
    'leave_audit_logs',
    'wfh_balances',
    'wfh_policies',
    'leave_balances',
    'leave_requests',
    'leave_types',
    'notifications',
    'notification_logs',
    'goal_audit_logs',
    'goal_comments',
    'task_audit_logs',
    'task_comments',
    'tasks',
    'goal_assignments',
    'goals',
    'coupons',
    'registration_action_tokens',
    'email_verifications',
    'exit_details',
    'work_histories',
    'bank_details',
    'departments',
    'tenant_users',
    'tenants',
    'company_registrations',
  ];

  let clearedCount = 0;
  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
      clearedCount++;
    } catch (err) {
      // Table might not exist yet or have a slightly different name
      // This is expected if certain optional migrations were not run
    }
  }

  console.log(`✅ Cleared ${clearedCount} tables successfully!`);
  console.log('   All tenants, users, goals, tasks, policies, leaves, and registrations are removed.');

  const shouldSeed = process.argv.includes('--seed') || process.argv.includes('--seed-usifdn');
  if (shouldSeed) {
    console.log('\n====================================================');
    console.log('🌱 Re-seeding clean "usifdn.org" tenant...');
    console.log('====================================================');
    execSync('node seed-usifdn.js', { stdio: 'inherit' });
  } else {
    console.log('\n💡 Tip: To seed the clean usifdn.org tenant immediately, run:');
    console.log('   npm run seed-usifdn');
    console.log('   OR: node clear-db.js --seed\n');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error clearing database:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
