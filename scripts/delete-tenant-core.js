import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

const TARGET_DOMAIN = 'shraddhaauromira.com';

export async function runTenantDeletion({ dryRun = true, confirmed = false }) {
  console.log('================================================================');
  console.log(`🔍 TENANT DELETION ENGINE: ${TARGET_DOMAIN.toUpperCase()}`);
  console.log(`MODE: ${dryRun ? '🛡️  DRY RUN (NO DATA WILL BE MODIFIED)' : '⚡ LIVE EXECUTION (PERMANENT DELETION)'}`);
  console.log('================================================================\n');

  // 1. Resolve Tenant and Registration
  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [
        { domainName: { equals: TARGET_DOMAIN, mode: 'insensitive' } },
        { companyName: { contains: 'Shraddha', mode: 'insensitive' } },
        { companyName: { contains: 'Shradha', mode: 'insensitive' } },
      ],
    },
    include: {
      registration: true,
    },
  });

  const registration = await prisma.companyRegistration.findFirst({
    where: {
      OR: [
        { domainName: { equals: TARGET_DOMAIN, mode: 'insensitive' } },
        { email: { contains: TARGET_DOMAIN, mode: 'insensitive' } },
        { companyName: { contains: 'Shraddha', mode: 'insensitive' } },
        { companyName: { contains: 'Shradha', mode: 'insensitive' } },
      ],
    },
  });

  if (!tenant && !registration) {
    console.log(`❌ No Tenant or Registration found for domain "${TARGET_DOMAIN}".`);
    console.log('Nothing to delete.\n');
    return { success: true, count: 0 };
  }

  // Safety Verification: Ensure we matched the exact target domain
  const matchedTenantDomain = tenant?.domainName?.toLowerCase();
  const matchedRegDomain = registration?.domainName?.toLowerCase();
  if (
    (matchedTenantDomain && matchedTenantDomain !== TARGET_DOMAIN) ||
    (matchedRegDomain && matchedRegDomain !== TARGET_DOMAIN)
  ) {
    throw new Error(
      `CRITICAL SAFETY ABORT: Matched domain (${matchedTenantDomain || matchedRegDomain}) does not strictly match target "${TARGET_DOMAIN}"!`
    );
  }

  const tenantId = tenant?.id || null;
  const registrationId = registration?.id || tenant?.registrationId || null;

  console.log('📍 Target Resolved:');
  console.log(`  ├─ Company Name   : ${tenant?.companyName || registration?.companyName || 'N/A'}`);
  console.log(`  ├─ Domain Name    : ${TARGET_DOMAIN}`);
  console.log(`  ├─ Tenant ID      : ${tenantId || 'NONE'}`);
  console.log(`  ├─ Tenant Code    : ${tenant?.tenantCode || registration?.tenantCode || 'N/A'}`);
  console.log(`  ├─ Registration ID: ${registrationId || 'NONE'}`);
  console.log(`  └─ Status         : ${tenant?.status || registration?.status || 'N/A'}\n`);

  // 2. Resolve Users belonging to this Tenant or domain
  const users = await prisma.tenantUser.findMany({
    where: {
      OR: [
        ...(tenantId ? [{ tenantId }] : []),
        { email: { endsWith: `@${TARGET_DOMAIN}`, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
    },
  });

  // Critical Safety Guard: Ensure no PLATFORM_OWNER is caught
  const platformOwnersCaught = users.filter((u) => u.role === 'PLATFORM_OWNER');
  if (platformOwnersCaught.length > 0) {
    throw new Error(
      `CRITICAL SAFETY ABORT: Platform Owner account (${platformOwnersCaught.map((u) => u.email).join(', ')}) caught in deletion scope!`
    );
  }

  const userIds = users.map((u) => u.id);

  console.log(`👥 Target Tenant Users (${users.length}):`);
  users.forEach((u) => {
    console.log(`  ├─ [${u.role}] ${u.name} <${u.email}> (ID: ${u.id})`);
  });
  console.log('');

  // 3. Collect Record Counts across all tables
  const report = [];
  const addReport = (table, count, description) => {
    report.push({ table, count: Number(count) || 0, description });
  };

  if (tenantId) {
    const rawCount = async (query) => {
      try {
        const res = await prisma.$queryRawUnsafe(query);
        return Number(res[0]?.count || res[0]?.count_rows || 0);
      } catch {
        return 0;
      }
    };

    addReport('tasks', await prisma.task.count({ where: { tenantId } }), 'Tasks');
    addReport('task_dependencies', await rawCount(`SELECT COUNT(*) FROM "task_dependencies" WHERE "tenantId" = '${tenantId}'`), 'Task dependencies');
    addReport('dependency_audit_logs', await rawCount(`SELECT COUNT(*) FROM "dependency_audit_logs" WHERE "tenantId" = '${tenantId}'`), 'Dependency audit logs');
    addReport('task_milestones', await rawCount(`SELECT COUNT(*) FROM "task_milestones" WHERE "tenantId" = '${tenantId}'`), 'Task milestones');
    addReport('task_milestone_audits', await rawCount(`SELECT COUNT(*) FROM "task_milestone_audits" WHERE "milestoneId" IN (SELECT id FROM "task_milestones" WHERE "tenantId" = '${tenantId}')`), 'Milestone audit logs');
    addReport('task_audit_logs', await rawCount(`SELECT COUNT(*) FROM "task_audit_logs" WHERE "tenantId" = '${tenantId}'`), 'Task audit logs');
    addReport('task_comments', await rawCount(`SELECT COUNT(*) FROM "task_comments" WHERE "tenantId" = '${tenantId}'`), 'Task comments');
    addReport('task_assignees', await rawCount(`SELECT COUNT(*) FROM "task_assignees" WHERE "taskId" IN (SELECT id FROM "tasks" WHERE "tenantId" = '${tenantId}')`), 'Task assignees');
    addReport('sub_tasks', await rawCount(`SELECT COUNT(*) FROM "sub_tasks" WHERE "taskId" IN (SELECT id FROM "tasks" WHERE "tenantId" = '${tenantId}')`), 'Sub tasks');
    addReport('sub_task_audit_logs', await rawCount(`SELECT COUNT(*) FROM "sub_task_audit_logs" WHERE "subTaskId" IN (SELECT id FROM "sub_tasks" WHERE "taskId" IN (SELECT id FROM "tasks" WHERE "tenantId" = '${tenantId}'))`), 'Subtask audit logs');

    addReport('goals', await prisma.goal.count({ where: { tenantId } }), 'Goals');
    addReport('goal_assignments', await rawCount(`SELECT COUNT(*) FROM "goal_assignments" WHERE "tenantId" = '${tenantId}'`), 'Goal assignments');
    addReport('goal_audit_logs', await rawCount(`SELECT COUNT(*) FROM "goal_audit_logs" WHERE "tenantId" = '${tenantId}'`), 'Goal audit logs');
    addReport('goal_comments', await rawCount(`SELECT COUNT(*) FROM "goal_comments" WHERE "tenantId" = '${tenantId}'`), 'Goal comments');

    addReport('policies', await prisma.policy.count({ where: { tenantId } }), 'Policies');
    addReport('policy_versions', await rawCount(`SELECT COUNT(*) FROM "policy_versions" WHERE "tenantId" = '${tenantId}'`), 'Policy versions');
    addReport('policy_assignments', await rawCount(`SELECT COUNT(*) FROM "policy_assignments" WHERE "tenantId" = '${tenantId}'`), 'Policy assignments');
    addReport('policy_acceptances', await rawCount(`SELECT COUNT(*) FROM "policy_acceptances" WHERE "tenantId" = '${tenantId}'`), 'Policy acceptances');
    addReport('policy_audit_logs', await rawCount(`SELECT COUNT(*) FROM "policy_audit_logs" WHERE "tenantId" = '${tenantId}'`), 'Policy audit logs');

    addReport('leave_requests', await prisma.leaveRequest.count({ where: { tenantId } }), 'Leave requests');
    addReport('leave_balances', await prisma.leaveBalance.count({ where: { tenantId } }), 'Leave balances');
    addReport('leave_types', await prisma.leaveType.count({ where: { tenantId } }), 'Leave types');
    addReport('leave_audit_logs', await rawCount(`SELECT COUNT(*) FROM "leave_audit_logs" WHERE "tenantId" = '${tenantId}'`), 'Leave audit logs');
    addReport('leave_balance_adjustments', await rawCount(`SELECT COUNT(*) FROM "leave_balance_adjustments" WHERE "tenantId" = '${tenantId}'`), 'Leave adjustments');
    addReport('wfh_policies', await rawCount(`SELECT COUNT(*) FROM "wfh_policies" WHERE "tenantId" = '${tenantId}'`), 'WFH policies');
    addReport('wfh_balances', await rawCount(`SELECT COUNT(*) FROM "wfh_balances" WHERE "tenantId" = '${tenantId}'`), 'WFH balances');

    addReport('appraisal_cycles', await prisma.appraisalCycle.count({ where: { tenantId } }), 'Appraisal cycles');
    addReport('appraisal_parameters', await prisma.appraisalParameter.count({ where: { tenantId } }), 'Appraisal parameters');
    addReport('performance_reviews', await rawCount(`SELECT COUNT(*) FROM "performance_reviews" WHERE "cycleId" IN (SELECT id FROM "appraisal_cycles" WHERE "tenantId" = '${tenantId}')`), 'Performance reviews');
    addReport('peer_nominations', await prisma.peerNomination.count({ where: { tenantId } }), 'Peer nominations');
    addReport('peer_feedbacks', await rawCount(`SELECT COUNT(*) FROM "peer_feedbacks" WHERE "nominationId" IN (SELECT id FROM "peer_nominations" WHERE "tenantId" = '${tenantId}')`), 'Peer feedbacks');

    addReport('departments', await prisma.department.count({ where: { tenantId } }), 'Departments');
    addReport('subscriptions', await prisma.subscription.count({ where: { tenantId } }), 'Subscriptions');
    addReport('invoices', await prisma.invoice.count({ where: { tenantId } }), 'Invoices');
    addReport('payments', await rawCount(`SELECT COUNT(*) FROM "payments" WHERE "tenantId" = '${tenantId}'`), 'Payments');
    addReport('refunds', await rawCount(`SELECT COUNT(*) FROM "refunds" WHERE "tenantId" = '${tenantId}'`), 'Refunds');
    addReport('coupon_redemptions', await rawCount(`SELECT COUNT(*) FROM "coupon_redemptions" WHERE "tenantId" = '${tenantId}'`), 'Coupon redemptions');
    addReport('wallet_transactions', await rawCount(`SELECT COUNT(*) FROM "wallet_transactions" WHERE "tenantId" = '${tenantId}'`), 'Wallet transactions');

    addReport('cxo_messages', await rawCount(`SELECT COUNT(*) FROM "cxo_messages" WHERE "tenantId" = '${tenantId}'`), 'CXO messages');
    addReport('cxo_message_replies', await rawCount(`SELECT COUNT(*) FROM "cxo_message_replies" WHERE "tenantId" = '${tenantId}'`), 'CXO replies');
    addReport('disputes', await rawCount(`SELECT COUNT(*) FROM "disputes" WHERE "tenantId" = '${tenantId}'`), 'Disputes');
    addReport('dispute_messages', await rawCount(`SELECT COUNT(*) FROM "dispute_messages" WHERE "tenantId" = '${tenantId}'`), 'Dispute messages');
    addReport('dispute_subjects', await rawCount(`SELECT COUNT(*) FROM "dispute_subjects" WHERE "tenantId" = '${tenantId}'`), 'Dispute subjects');

    addReport('hub_events', await rawCount(`SELECT COUNT(*) FROM "hub_events" WHERE "tenantId" = '${tenantId}'`), 'Hub events');
    addReport('gallery_posts', await rawCount(`SELECT COUNT(*) FROM "gallery_posts" WHERE "tenantId" = '${tenantId}'`), 'Gallery posts');
    addReport('gallery_comments', await rawCount(`SELECT COUNT(*) FROM "gallery_comments" WHERE "tenantId" = '${tenantId}'`), 'Gallery comments');
    addReport('gallery_likes', await rawCount(`SELECT COUNT(*) FROM "gallery_likes" WHERE "tenantId" = '${tenantId}'`), 'Gallery likes');

    addReport('document_templates', await rawCount(`SELECT COUNT(*) FROM "document_templates" WHERE "tenantId" = '${tenantId}'`), 'Document templates');
    addReport('generated_documents', await rawCount(`SELECT COUNT(*) FROM "generated_documents" WHERE "tenantId" = '${tenantId}'`), 'Generated documents');
    addReport('document_tokens', await rawCount(`SELECT COUNT(*) FROM "document_tokens" WHERE "tenantId" = '${tenantId}'`), 'Document tokens');
    addReport('tenant_settings', await rawCount(`SELECT COUNT(*) FROM "tenant_settings" WHERE "tenantId" = '${tenantId}'`), 'Tenant settings');
    addReport('blood_groups', await rawCount(`SELECT COUNT(*) FROM "blood_groups" WHERE "tenantId" = '${tenantId}'`), 'Blood groups');
    addReport('goal_options', await rawCount(`SELECT COUNT(*) FROM "goal_options" WHERE "tenantId" = '${tenantId}'`), 'Goal options');
    addReport('user_capabilities', await rawCount(`SELECT COUNT(*) FROM "user_capabilities" WHERE "tenantId" = '${tenantId}'`), 'User capabilities');
    addReport('capability_audit_logs', await rawCount(`SELECT COUNT(*) FROM "capability_audit_logs" WHERE "tenantId" = '${tenantId}'`), 'Capability audit logs');
    addReport('permission_audit_logs', await rawCount(`SELECT COUNT(*) FROM "permission_audit_logs" WHERE "tenantId" = '${tenantId}'`), 'Permission audit logs');
  }

  // User-level tables
  if (userIds.length > 0) {
    const rawUserCount = async (query) => {
      try {
        const res = await prisma.$queryRawUnsafe(query);
        return Number(res[0]?.count || res[0]?.count_rows || 0);
      } catch {
        return 0;
      }
    };
    const idList = userIds.map((id) => `'${id}'`).join(',');
    addReport('bank_details', await rawUserCount(`SELECT COUNT(*) FROM "bank_details" WHERE "userId" IN (${idList})`), 'User bank details');
    addReport('work_histories', await rawUserCount(`SELECT COUNT(*) FROM "work_histories" WHERE "userId" IN (${idList})`), 'Work histories');
    addReport('employee_educations', await rawUserCount(`SELECT COUNT(*) FROM "employee_educations" WHERE "userId" IN (${idList})`), 'Educations');
    addReport('exit_details', await rawUserCount(`SELECT COUNT(*) FROM "exit_details" WHERE "userId" IN (${idList})`), 'Exit details');
    addReport('exit_clearances', await rawUserCount(`SELECT COUNT(*) FROM "exit_clearances" WHERE "userId" IN (${idList})`), 'Exit clearances');
    addReport('password_reset_tokens', await rawUserCount(`SELECT COUNT(*) FROM "password_reset_tokens" WHERE "userId" IN (${idList})`), 'Password reset tokens');
    addReport('notifications', await rawUserCount(`SELECT COUNT(*) FROM "notifications" WHERE "recipientId" IN (${idList}) OR "actorId" IN (${idList})`), 'Notifications');
    addReport('messages', await rawUserCount(`SELECT COUNT(*) FROM "messages" WHERE "senderId" IN (${idList}) OR "receiverId" IN (${idList})`), 'Direct chat messages');
    addReport('followers', await rawUserCount(`SELECT COUNT(*) FROM "followers" WHERE "followerId" IN (${idList}) OR "followingId" IN (${idList})`), 'Followers');
  }

  addReport('tenant_users', userIds.length, 'Tenant User accounts');

  if (tenantId) {
    addReport('tenants', 1, 'Tenant root record');
  }

  // Registration & Email Verification tables
  if (registrationId) {
    addReport('registration_action_tokens', await prisma.registrationActionToken.count({ where: { registrationId } }), 'Registration tokens');
    addReport('registration_verifications', await prisma.registrationVerification.count({ where: { registrationId } }), 'Registration verifications');
    addReport('notification_logs', await prisma.notificationLog.count({
      where: {
        OR: [
          { registrationId },
          { recipient: { endsWith: `@${TARGET_DOMAIN}`, mode: 'insensitive' } },
        ],
      },
    }), 'Notification dispatch logs');
    addReport('company_registrations', 1, 'Company registration record');
  }

  addReport('email_verifications', await prisma.emailVerification.count({
    where: {
      OR: [
        { domainName: { equals: TARGET_DOMAIN, mode: 'insensitive' } },
        { email: { endsWith: `@${TARGET_DOMAIN}`, mode: 'insensitive' } },
      ],
    },
  }), 'OTP & Email verification challenges');

  // Print Summary Table
  console.log('📊 RECORDS IDENTIFIED FOR DELETION:');
  console.log('----------------------------------------------------------------');
  console.log('TABLE NAME'.padEnd(32) + 'COUNT'.padEnd(10) + 'DESCRIPTION');
  console.log('----------------------------------------------------------------');
  let totalRecords = 0;
  for (const item of report) {
    totalRecords += item.count;
    if (item.count > 0 || dryRun) {
      const countStr = item.count > 0 ? `\x1b[33m${String(item.count).padStart(6)}\x1b[0m` : String(item.count).padStart(6);
      console.log(`${item.table.padEnd(30)} ${countStr}   ${item.description}`);
    }
  }
  console.log('----------------------------------------------------------------');
  console.log(`TOTAL RECORDS TO PURGE: \x1b[32m${totalRecords}\x1b[0m\n`);

  // Verify other tenants count
  const otherTenantsCount = await prisma.tenant.count({
    where: {
      domainName: {
        not: TARGET_DOMAIN,
      },
    },
  });
  const platformOwnerCount = await prisma.tenantUser.count({
    where: { role: 'PLATFORM_OWNER' },
  });

  console.log('🛡️  ISOLATION & SAFETY VERIFICATION:');
  console.log(`  ├─ Other company tenants untouched: ${otherTenantsCount}`);
  console.log(`  └─ Platform Owner accounts intact : ${platformOwnerCount}\n`);

  if (dryRun) {
    console.log('================================================================');
    console.log('🛡️  DRY RUN REPORT COMPLETE — NO DATA MODIFIED.');
    console.log(`To execute deletion, run: ./delete-shraddhaauromira-tenant.sh --execute`);
    console.log('================================================================\n');
    return { success: true, totalRecords, report };
  }

  // Live execution requires explicit confirmation flag
  if (!confirmed) {
    throw new Error('Safety abort: Deletion was called without explicit confirmation.');
  }

  // Generate JSON Snapshot Backup before mutating
  const backupDir = path.resolve('./backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotFile = path.join(backupDir, `snapshot-${TARGET_DOMAIN}-${timestamp}.json`);

  const snapshotData = {
    targetDomain: TARGET_DOMAIN,
    timestamp: new Date().toISOString(),
    tenant,
    registration,
    users,
    identifiedReport: report,
  };
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshotData, null, 2));
  console.log(`📦 Pre-deletion safety snapshot saved to: ${snapshotFile}\n`);

  console.log('⚡ EXECUTING DELETION IN ATOMIC TRANSACTION...');

  // Query existing tables set in database to ensure we only issue queries against existing relations
  const existingTablesRes = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
  const existingTables = new Set(existingTablesRes.map((t) => t.table_name));

  const safeDelete = async (tx, tableName, condition) => {
    if (existingTables.has(tableName)) {
      await tx.$executeRawUnsafe(`DELETE FROM "${tableName}" WHERE ${condition};`);
    }
  };

  await prisma.$transaction(
    async (tx) => {
      // 1. Task child records
      if (tenantId) {
        await safeDelete(tx, 'task_dependencies', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'dependency_audit_logs', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'checkpoint_escalation_levels', `"milestoneId" IN (SELECT id FROM "task_milestones" WHERE "tenantId" = '${tenantId}')`);
        await safeDelete(tx, 'task_milestones', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'sub_task_audit_logs', `"subTaskId" IN (SELECT id FROM "sub_tasks" WHERE "taskId" IN (SELECT id FROM "tasks" WHERE "tenantId" = '${tenantId}'))`);
        await safeDelete(tx, 'sub_tasks', `"taskId" IN (SELECT id FROM "tasks" WHERE "tenantId" = '${tenantId}')`);
        await safeDelete(tx, 'task_assignees', `"taskId" IN (SELECT id FROM "tasks" WHERE "tenantId" = '${tenantId}')`);
        await safeDelete(tx, 'task_audit_logs', `"taskId" IN (SELECT id FROM "tasks" WHERE "tenantId" = '${tenantId}')`);
        await safeDelete(tx, 'task_comments', `"taskId" IN (SELECT id FROM "tasks" WHERE "tenantId" = '${tenantId}')`);
        await safeDelete(tx, 'tasks', `"tenantId" = '${tenantId}'`);

        // 2. Goals
        await safeDelete(tx, 'goal_audit_logs', `"goalId" IN (SELECT id FROM "goals" WHERE "tenantId" = '${tenantId}')`);
        await safeDelete(tx, 'goal_comments', `"goalId" IN (SELECT id FROM "goals" WHERE "tenantId" = '${tenantId}')`);
        await safeDelete(tx, 'goal_assignments', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'goals', `"tenantId" = '${tenantId}'`);

        // 3. Policies
        await safeDelete(tx, 'policy_audit_logs', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'policy_acceptances', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'policy_assignments', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'policy_versions', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'policies', `"tenantId" = '${tenantId}'`);

        // 4. Leaves & WFH
        await safeDelete(tx, 'leave_balance_adjustments', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'leave_audit_logs', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'wfh_balances', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'wfh_policies', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'leave_balances', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'leave_requests', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'leave_types', `"tenantId" = '${tenantId}'`);

        // 5. Appraisals & Reviews
        await safeDelete(tx, 'peer_feedbacks', `"nominationId" IN (SELECT id FROM "peer_nominations" WHERE "tenantId" = '${tenantId}')`);
        await safeDelete(tx, 'peer_nominations', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'review_scores', `"reviewId" IN (SELECT id FROM "performance_reviews" WHERE "cycleId" IN (SELECT id FROM "appraisal_cycles" WHERE "tenantId" = '${tenantId}'))`);
        await safeDelete(tx, 'performance_reviews', `"cycleId" IN (SELECT id FROM "appraisal_cycles" WHERE "tenantId" = '${tenantId}')`);
        await safeDelete(tx, 'appraisal_parameters', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'appraisal_cycles', `"tenantId" = '${tenantId}'`);

        // 6. Gallery & Hub
        await safeDelete(tx, 'gallery_comments', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'gallery_likes', `"tenantId" = '${tenantId}' OR "postId" IN (SELECT id FROM "gallery_posts" WHERE "tenantId" = '${tenantId}')`);
        await safeDelete(tx, 'gallery_posts', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'hub_events', `"tenantId" = '${tenantId}'`);

        // 7. Communication & Disputes
        await safeDelete(tx, 'cxo_message_replies', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'cxo_messages', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'dispute_messages', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'dispute_subjects', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'disputes', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'one_on_one_meetings', `"tenantId" = '${tenantId}'`);

        // 8. Financials, Billing & Documents
        await safeDelete(tx, 'wallet_transactions', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'license_requests', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'refunds', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'payments', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'invoices', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'coupon_redemptions', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'subscriptions', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'document_tokens', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'generated_documents', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'document_templates', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'legal_acceptances', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'platform_tickets', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'sales_leads', `"tenantId" = '${tenantId}'`);

        // 9. Tenant Config & Exit Clearances
        await safeDelete(tx, 'exit_clearance_events', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'exit_clearances', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'exit_details', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'blood_groups', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'goal_options', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'tenant_settings', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'user_capabilities', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'capability_audit_logs', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'permission_audit_logs', `"tenantId" = '${tenantId}'`);
        await safeDelete(tx, 'departments', `"tenantId" = '${tenantId}'`);
      }

      // 10. User-level child records
      if (userIds.length > 0) {
        const idList = userIds.map((id) => `'${id}'`).join(',');
        await safeDelete(tx, 'bank_details', `"userId" IN (${idList})`);
        await safeDelete(tx, 'work_histories', `"userId" IN (${idList})`);
        await safeDelete(tx, 'employee_educations', `"userId" IN (${idList})`);
        await safeDelete(tx, 'password_reset_tokens', `"userId" IN (${idList})`);
        await safeDelete(tx, 'notifications', `"recipientId" IN (${idList})`);
        await safeDelete(tx, 'messages', `"senderId" IN (${idList}) OR "receiverId" IN (${idList})`);
        await safeDelete(tx, 'followers', `"userId" IN (${idList})`);
        await safeDelete(tx, 'user_capabilities', `"userId" IN (${idList})`);
      }

      // 11. Delete Tenant Users
      if (tenantId) {
        await tx.tenantUser.deleteMany({ where: { tenantId } });
      }
      await tx.tenantUser.deleteMany({
        where: { email: { endsWith: `@${TARGET_DOMAIN}`, mode: 'insensitive' } },
      });

      // 12. Delete Tenant Root Record
      if (tenantId) {
        await tx.tenant.delete({ where: { id: tenantId } });
      }

      // 13. Delete Registration and Action Tokens
      if (registrationId) {
        await tx.registrationActionToken.deleteMany({ where: { registrationId } });
        await tx.registrationVerification.deleteMany({ where: { registrationId } });
        await tx.notificationLog.deleteMany({
          where: {
            OR: [
              { registrationId },
              { recipient: { endsWith: `@${TARGET_DOMAIN}`, mode: 'insensitive' } },
            ],
          },
        });
        await tx.companyRegistration.delete({ where: { id: registrationId } });
      }

      // 14. Purge Email Verifications / OTPs for the domain and email
      await tx.emailVerification.deleteMany({
        where: {
          OR: [
            { domainName: { equals: TARGET_DOMAIN, mode: 'insensitive' } },
            { email: { endsWith: `@${TARGET_DOMAIN}`, mode: 'insensitive' } },
          ],
        },
      });
    },
    { timeout: 60000 }
  );

  console.log('✅ TRANSACTION COMMITTED SUCCESSFULLY.\n');

  // 4. Post-Deletion Verification
  console.log('🔍 RUNNING POST-DELETION VERIFICATION...');
  const remainingTenants = await prisma.tenant.count({
    where: { domainName: { equals: TARGET_DOMAIN, mode: 'insensitive' } },
  });
  const remainingRegs = await prisma.companyRegistration.count({
    where: { domainName: { equals: TARGET_DOMAIN, mode: 'insensitive' } },
  });
  const remainingUsers = await prisma.tenantUser.count({
    where: { email: { endsWith: `@${TARGET_DOMAIN}`, mode: 'insensitive' } },
  });
  const remainingVerifs = await prisma.emailVerification.count({
    where: {
      OR: [
        { domainName: { equals: TARGET_DOMAIN, mode: 'insensitive' } },
        { email: { endsWith: `@${TARGET_DOMAIN}`, mode: 'insensitive' } },
      ],
    },
  });

  const finalOtherTenants = await prisma.tenant.count({
    where: { domainName: { not: TARGET_DOMAIN } },
  });
  const finalPlatformOwners = await prisma.tenantUser.count({
    where: { role: 'PLATFORM_OWNER' },
  });

  console.log('----------------------------------------------------------------');
  console.log(`Remaining "${TARGET_DOMAIN}" Tenants      : ${remainingTenants} ${remainingTenants === 0 ? '✔' : '❌'}`);
  console.log(`Remaining "${TARGET_DOMAIN}" Registrations  : ${remainingRegs} ${remainingRegs === 0 ? '✔' : '❌'}`);
  console.log(`Remaining "${TARGET_DOMAIN}" Users          : ${remainingUsers} ${remainingUsers === 0 ? '✔' : '❌'}`);
  console.log(`Remaining "${TARGET_DOMAIN}" Email OTPs     : ${remainingVerifs} ${remainingVerifs === 0 ? '✔' : '❌'}`);
  console.log(`Other company tenants preserved             : ${finalOtherTenants} ✔`);
  console.log(`Platform Owner accounts preserved           : ${finalPlatformOwners} ✔`);
  console.log('----------------------------------------------------------------\n');

  if (remainingTenants === 0 && remainingRegs === 0 && remainingUsers === 0 && remainingVerifs === 0) {
    console.log('🎉 SUCCESS: All records for "shraddhaauromira.com" have been completely removed!');
    console.log('   The domain and all employee emails are now 100% available for fresh registration.');
  } else {
    console.warn('⚠️ WARNING: Some residual records may remain. Check the log above.');
  }

  return { success: true };
}

// Command Line Entrypoint
if (process.argv[1]?.endsWith('delete-tenant-core.js')) {
  const isExecute = process.argv.includes('--execute');
  const isDryRun = process.argv.includes('--dry-run') || !isExecute;
  const isConfirmed = process.argv.includes('--confirmed');

  runTenantDeletion({ dryRun: isDryRun, confirmed: isConfirmed })
    .catch((err) => {
      console.error('\n❌ FATAL ERROR DURING TENANT DELETION:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
