import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from './src/config/env.js';

const prisma = new PrismaClient();
const BASE_URL = `http://localhost:${process.env.PORT || 4000}/api`;

function createAuthToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tenantId: user.tenantId,
    },
    env.jwtSecret,
    { expiresIn: '1h' }
  );
}

async function runTests() {
  console.log('🧪 Starting End-to-End Policy & Compliance Verification Tests...\n');

  try {
    // 1. Fetch Seeded HR and Employee Users
    const hrUser = await prisma.tenantUser.findUnique({
      where: { email: 'biswajitparida1291@gmail.com' },
    });
    const empUser = await prisma.tenantUser.findUnique({
      where: { email: 'pratik@acmecorp.com' },
    });

    if (!hrUser || !empUser) {
      throw new Error('Seed users not found in database. Please run npm run seed-users first.');
    }

    const hrToken = createAuthToken(hrUser);
    const empToken = createAuthToken(empUser);

    console.log(`✅ Authenticated HR User: ${hrUser.name} (${hrUser.role})`);
    console.log(`✅ Authenticated Employee: ${empUser.name} (${empUser.role})\n`);

    // 2. Test HR List Policies
    console.log('--- Test 1: HR List Policies ---');
    const hrListRes = await fetch(`${BASE_URL}/policies`, {
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const hrListData = await hrListRes.json();
    console.log(`Status: ${hrListRes.status} | Found ${hrListData.items?.length || 0} policies`);
    if (hrListRes.status !== 200 || !Array.isArray(hrListData.items)) {
      throw new Error(`HR list policies failed: ${JSON.stringify(hrListData)}`);
    }
    console.log('Sample policy stats:', {
      title: hrListData.items[0]?.title,
      totalAssigned: hrListData.items[0]?.totalAssigned,
      signedCount: hrListData.items[0]?.signedCount,
      compliancePercentage: `${hrListData.items[0]?.compliancePercentage}%`,
    });
    console.log('✅ HR list policies passed.\n');

    // 3. Test Employee List Assigned Policies
    console.log('--- Test 2: Employee List Assigned Policies ---');
    const empListRes = await fetch(`${BASE_URL}/policies/my`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const empListData = await empListRes.json();
    console.log(`Status: ${empListRes.status} | Assigned policies: ${empListData.items?.length || 0}`);
    if (empListRes.status !== 200 || !Array.isArray(empListData.items)) {
      throw new Error(`Employee list policies failed: ${JSON.stringify(empListData)}`);
    }
    console.log('✅ Employee list assigned policies passed.\n');

    // 4. Test HR Create New Policy with Assignment
    console.log('--- Test 3: HR Create & Publish Policy with Assignment ---');
    const newPolicyTitle = `Zero Trust Access Policy ${Date.now()}`;
    const createRes = await fetch(`${BASE_URL}/policies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hrToken}`,
      },
      body: JSON.stringify({
        title: newPolicyTitle,
        category: 'Security',
        description: 'Zero Trust architectural mandates for remote device access.',
        content: 'All devices connecting to corporate infrastructure must have EDR agents installed and 2FA enabled.',
        status: 'PUBLISHED',
        assignees: [empUser.id],
      }),
    });
    const createdPolicy = await createRes.json();
    console.log(`Status: ${createRes.status} | Created Policy ID: ${createdPolicy.id}`);
    if (createRes.status !== 201 || !createdPolicy.id) {
      throw new Error(`HR create policy failed: ${JSON.stringify(createdPolicy)}`);
    }
    console.log('✅ HR policy creation & assignment passed.\n');

    // 5. Verify Employee Can See the Newly Assigned Policy
    console.log('--- Test 4: Employee Views Newly Assigned Policy ---');
    const empRefreshRes = await fetch(`${BASE_URL}/policies/my`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const empRefreshData = await empRefreshRes.json();
    const assignedTarget = empRefreshData.items?.find(p => p.id === createdPolicy.id);
    if (!assignedTarget) {
      throw new Error('Newly created policy is not visible in employee assigned list!');
    }
    console.log(`Found assigned policy "${assignedTarget.title}" with status: ${assignedTarget.status}`);
    console.log('✅ Target policy visibility confirmed.\n');

    // 6. Test Electronic Signature by Employee
    console.log('--- Test 5: Employee Electronically Signs Policy ---');
    const signRes = await fetch(`${BASE_URL}/policies/${createdPolicy.id}/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${empToken}`,
      },
      body: JSON.stringify({ acknowledged: true }),
    });
    const signData = await signRes.json();
    console.log(`Status: ${signRes.status} | Response:`, signData.message);
    if (signRes.status !== 200 || !signData.success) {
      throw new Error(`E-Signature failed: ${JSON.stringify(signData)}`);
    }
    console.log('Signature audit details:', {
      ipAddress: signData.acceptance?.ipAddress,
      complianceCheck: signData.acceptance?.complianceCheck,
      signedAt: signData.acceptance?.signedAt,
    });
    console.log('✅ Electronic signature passed.\n');

    // 7. Test Duplicate Signature Prevention
    console.log('--- Test 6: Duplicate Signature Prevention ---');
    const dupSignRes = await fetch(`${BASE_URL}/policies/${createdPolicy.id}/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${empToken}`,
      },
      body: JSON.stringify({ acknowledged: true }),
    });
    const dupSignData = await dupSignRes.json();
    console.log(`Status: ${dupSignRes.status} | Error message: "${dupSignData.error}"`);
    if (dupSignRes.status !== 400) {
      throw new Error('Duplicate signing was NOT rejected with 400!');
    }
    console.log('✅ Duplicate signature correctly blocked.\n');

    // 8. Test RBAC: Employee Cannot Access HR Compliance Registry
    console.log('--- Test 7: RBAC - Employee Blocked from HR Registry ---');
    const rbacRes = await fetch(`${BASE_URL}/policies/compliance/registry`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    console.log(`Status: ${rbacRes.status} (Expected 403)`);
    if (rbacRes.status !== 403) {
      throw new Error(`RBAC check failed! Employee got status ${rbacRes.status} on HR registry`);
    }
    console.log('✅ RBAC check passed.\n');

    // 9. Test HR Compliance Registry
    console.log('--- Test 8: HR Compliance Registry Contains New Signature ---');
    const regRes = await fetch(`${BASE_URL}/policies/compliance/registry?policyId=${createdPolicy.id}`, {
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const regData = await regRes.json();
    console.log(`Status: ${regRes.status} | Total records for policy: ${regData.items?.length || 0}`);
    const employeeRecord = regData.items?.find(r => r.userId === empUser.id);
    if (!employeeRecord) {
      throw new Error('Employee signature not found in HR Compliance Registry!');
    }
    console.log('Verified registry record:', {
      employeeName: employeeRecord.employeeName,
      signedPolicyMandate: employeeRecord.signedPolicyMandate,
      auditIpAddress: employeeRecord.auditIpAddress,
      complianceCheck: employeeRecord.complianceCheck,
    });
    console.log('✅ HR Compliance Registry verified.\n');

    // 10. Test HR Send Reminder for Pending Policy
    console.log('--- Test 9: HR Send Reminder to Pending Employee ---');
    const remindRes = await fetch(`${BASE_URL}/policies/seed-policy-wfh/reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hrToken}`,
      },
      body: JSON.stringify({ userId: empUser.id }),
    });
    const remindData = await remindRes.json();
    console.log(`Status: ${remindRes.status} | Result:`, remindData.message);
    if (remindRes.status !== 200 || !remindData.success) {
      throw new Error(`Reminder dispatch failed: ${JSON.stringify(remindData)}`);
    }
    console.log('✅ Reminder dispatch passed.\n');

    // 11. Test HR Export Compliance CSV
    console.log('--- Test 10: HR Export Compliance CSV ---');
    const csvRes = await fetch(`${BASE_URL}/policies/compliance/export`, {
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const csvText = await csvRes.text();
    console.log(`Status: ${csvRes.status} | Content-Type: ${csvRes.headers.get('content-type')}`);
    console.log('CSV Header Preview:\n' + csvText.split('\n')[0]);
    console.log('First record preview:\n' + (csvText.split('\n')[1] || 'No records'));
    if (csvRes.status !== 200 || !csvText.includes('Employee Name,User ID')) {
      throw new Error('Export CSV failed or format is invalid');
    }
    console.log('✅ Export CSV passed.\n');

    // 12. Test Unauthenticated Request
    console.log('--- Test 11: Unauthenticated Access Blocked ---');
    const unauthRes = await fetch(`${BASE_URL}/policies/my`);
    console.log(`Status: ${unauthRes.status} (Expected 401)`);
    if (unauthRes.status !== 401) {
      throw new Error('Unauthenticated request was not rejected with 401!');
    }
    console.log('✅ Unauthenticated access blocked.\n');

    // 13. Test HR Edit Policy
    console.log('--- Test 12: HR Edit Policy ---');
    const editRes = await fetch(`${BASE_URL}/policies/${createdPolicy.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hrToken}`,
      },
      body: JSON.stringify({
        title: `${newPolicyTitle} (Updated Revision)`,
        content: 'Updated zero trust requirements with additional VPN encryption mandates.',
        incrementVersion: true,
      }),
    });
    const editedPolicy = await editRes.json();
    console.log(`Status: ${editRes.status} | Updated Title: "${editedPolicy.title}" | Version: v${editedPolicy.version}`);
    if (editRes.status !== 200 || editedPolicy.version !== 2) {
      throw new Error('Edit policy failed or version did not increment!');
    }
    console.log('✅ HR edit policy passed.\n');

    // 14. Test HR Delete Policy
    console.log('--- Test 13: HR Delete Policy ---');
    const deleteRes = await fetch(`${BASE_URL}/policies/${createdPolicy.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    const deleteData = await deleteRes.json();
    console.log(`Status: ${deleteRes.status} | Response: "${deleteData.message}"`);
    if (deleteRes.status !== 200 || !deleteData.success) {
      throw new Error('Delete policy failed!');
    }

    // Verify policy is gone
    const verifyDelRes = await fetch(`${BASE_URL}/policies/${createdPolicy.id}`, {
      headers: { Authorization: `Bearer ${hrToken}` },
    });
    console.log(`Verify Deletion Status: ${verifyDelRes.status} (Expected 404)`);
    if (verifyDelRes.status !== 404) {
      throw new Error('Deleted policy is still retrievable!');
    }
    console.log('✅ HR delete policy passed.\n');

    console.log('🎉 ALL 13 POLICY & COMPLIANCE VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
