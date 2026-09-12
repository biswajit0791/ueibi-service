/**
 * @file clean-usifdn.js
 * @description Completely removes the "usifdn.org" tenant, company registration,
 * and all associated users/records from the database so it can be manually entered from scratch later.
 *
 * Usage:
 *   node clean-usifdn.js
 *   npm run clean-usifdn
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DOMAIN = 'usifdn.org';
const TENANT_CODE = 'USI';

async function main() {
  console.log('====================================================');
  console.log(`🗑️  CLEANING "usifdn.org" TENANT & REGISTRATION...`);
  console.log('====================================================');

  // 1. Find Tenant
  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [
        { domainName: { equals: DOMAIN, mode: 'insensitive' } },
        { tenantCode: { equals: TENANT_CODE, mode: 'insensitive' } },
      ],
    },
  });

  // 2. Find Registration
  const registration = await prisma.companyRegistration.findFirst({
    where: {
      OR: [
        { domainName: { equals: DOMAIN, mode: 'insensitive' } },
        { tenantCode: { equals: TENANT_CODE, mode: 'insensitive' } },
        { email: { endsWith: '@usifdn.org', mode: 'insensitive' } },
      ],
    },
  });

  if (tenant) {
    console.log(`Found Tenant: ${tenant.companyName} (ID: ${tenant.id})`);

    // Clean child data
    const tenantId = tenant.id;
    console.log('  Deleting associated tenant data (goals, tasks, policies, leaves, departments)...');

    await prisma.$executeRawUnsafe(`DELETE FROM "gallery_comments" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "gallery_likes" WHERE "postId" IN (SELECT id FROM "gallery_posts" WHERE "tenantId" = '${tenantId}');`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "gallery_posts" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "hub_events" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "policy_audit_logs" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "policy_acceptances" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "policy_assignments" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "policies" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "non_joiner_records" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "ex_employer_reviews" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "ex_employee_records" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "peer_feedbacks" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "peer_nominations" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "review_scores" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "performance_reviews" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "appraisal_parameters" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "appraisal_cycles" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "leave_balance_adjustments" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "leave_audit_logs" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "wfh_balances" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "wfh_policies" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "leave_balances" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "leave_requests" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "leave_types" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "notifications" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "goal_audit_logs" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "goal_comments" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "task_audit_logs" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "task_comments" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "tasks" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "goal_assignments" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "goals" WHERE "tenantId" = '${tenantId}';`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "departments" WHERE "tenantId" = '${tenantId}';`).catch(() => {});

    // Delete users under this tenant
    const users = await prisma.tenantUser.findMany({ where: { tenantId } });
    for (const u of users) {
      await prisma.$executeRawUnsafe(`DELETE FROM "exit_details" WHERE "userId" = '${u.id}';`).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "work_histories" WHERE "userId" = '${u.id}';`).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "bank_details" WHERE "userId" = '${u.id}';`).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM "password_reset_tokens" WHERE "userId" = '${u.id}';`).catch(() => {});
    }
    await prisma.tenantUser.deleteMany({ where: { tenantId } });
    console.log(`  Deleted ${users.length} tenant users.`);

    // Delete Tenant
    await prisma.tenant.delete({ where: { id: tenantId } });
    console.log(`  ✔ Deleted Tenant "${tenant.companyName}".`);
  } else {
    console.log('ℹ️  No Tenant found for usifdn.org');
  }

  // Delete any lingering users with @usifdn.org
  const leftoverUsers = await prisma.tenantUser.deleteMany({
    where: {
      email: { endsWith: '@usifdn.org', mode: 'insensitive' },
    },
  });
  if (leftoverUsers.count > 0) {
    console.log(`  ✔ Deleted ${leftoverUsers.count} lingering usifdn.org user(s).`);
  }

  // Delete any lingering email verifications/OTPs
  await prisma.emailVerification.deleteMany({
    where: {
      OR: [
        { email: { endsWith: '@usifdn.org', mode: 'insensitive' } },
        { domainName: { equals: DOMAIN, mode: 'insensitive' } },
      ],
    },
  }).catch(() => {});

  // Delete Registration and Action Tokens
  if (registration) {
    console.log(`Found Registration: ID=${registration.id}, Company=${registration.companyName}`);
    await prisma.registrationActionToken.deleteMany({
      where: { registrationId: registration.id },
    }).catch(() => {});
    await prisma.companyRegistration.delete({
      where: { id: registration.id },
    });
    console.log('  ✔ Deleted CompanyRegistration and associated action tokens.');
  } else {
    console.log('ℹ️  No CompanyRegistration found for usifdn.org');
  }

  console.log('\n====================================================');
  console.log('🎉 "usifdn.org" has been completely removed!');
  console.log('   You can now register or enter it manually from scratch.');
  console.log('====================================================\n');
}

main()
  .catch((err) => {
    console.error('❌ Error cleaning usifdn.org:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
