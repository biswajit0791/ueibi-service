import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from './src/app.js';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production-min-32-chars-long';

// ── Color helpers for console ────────────────────────────────────────────────
const c = {
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  bold: (t) => `\x1b[1m${t}\x1b[0m`,
  gray: (t) => `\x1b[90m${t}\x1b[0m`,
};

function signTestToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tenantId: user.tenantId,
    },
    JWT_SECRET,
    { expiresIn: '2h', algorithm: 'HS256' }
  );
}

let passedCount = 0;
let failedCount = 0;

function assert(condition, testName, detail = '') {
  if (condition) {
    passedCount++;
    console.log(`  ${c.green('✔')} ${testName}`);
  } else {
    failedCount++;
    console.error(`  ${c.red('✖')} ${testName}`);
    if (detail) console.error(`    ${c.gray(detail)}`);
  }
}

let API_BASE = 'http://127.0.0.1:4000/api';
let internalServer = null;

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const status = res.status;
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status, data };
}

async function run() {
  console.log(`\n${c.bold(c.cyan('══════════════════════════════════════════════════════════════'))}`);
  console.log(`${c.bold(c.cyan('   UEIBI Appraisal Module — End-to-End Test Suite'))}`);
  console.log(`${c.bold(c.cyan('══════════════════════════════════════════════════════════════'))}\n`);

  // Detect running server or spin up automatic test server
  try {
    const ping = await fetch('http://127.0.0.1:4000/api/health');
    if (ping.ok) {
      API_BASE = 'http://127.0.0.1:4000/api';
      console.log(`  ${c.green('ℹ')} Connecting to live dev server on ${c.bold('http://127.0.0.1:4000')}`);
    } else {
      throw new Error('Server not responding');
    }
  } catch (err) {
    // No dev server running on port 4000, start in-memory test instance
    internalServer = app.listen(0);
    await new Promise((resolve) => internalServer.on('listening', resolve));
    const port = internalServer.address().port;
    API_BASE = `http://127.0.0.1:${port}/api`;
    console.log(`  ${c.yellow('ℹ')} No external server found on port 4000. Started standalone test server on ${c.bold(`http://127.0.0.1:${port}`)}`);
  }

  // ── Step 0: Ensure Test Users & Roles in DB ────────────────────────────────
  console.log(`\n${c.bold('Step 0: Preparing Test Users & Database State...')}`);

  let tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        companyName: 'Acme Test Corp',
        domainName: 'acmetest.com',
        tenantCode: 'ACT',
        licenseLimit: 100,
      },
    });
  }

  const dummyHash = await bcrypt.hash('password123', 10);

  // 1. HR User
  let hrUser = await prisma.tenantUser.findFirst({
    where: { tenantId: tenant.id, role: { in: ['HR', 'SUPER_ADMIN'] } },
  });
  if (!hrUser) {
    hrUser = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        email: `test-hr-${Date.now()}@acmetest.com`,
        name: 'Test HR Manager',
        role: 'HR',
        status: 'ACTIVE',
        passwordHash: dummyHash,
      },
    });
  }

  // 2. CMD / Super Admin User
  let cmdUser = await prisma.tenantUser.findFirst({
    where: { tenantId: tenant.id, role: { in: ['SUPER_ADMIN', 'CMD'] } },
  });
  if (!cmdUser) {
    cmdUser = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        email: `test-cmd-${Date.now()}@acmetest.com`,
        name: 'Test CMD Director',
        role: 'CMD',
        status: 'ACTIVE',
        passwordHash: dummyHash,
      },
    });
  }

  // 3. Manager User
  let managerUser = await prisma.tenantUser.findFirst({
    where: { tenantId: tenant.id, role: 'MANAGER' },
  });
  if (!managerUser) {
    managerUser = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        email: `test-mgr-${Date.now()}@acmetest.com`,
        name: 'Test Team Manager',
        role: 'MANAGER',
        status: 'ACTIVE',
        department: 'Engineering',
        designation: 'Engineering Manager',
        passwordHash: dummyHash,
      },
    });
  }

  // 4. Employee (Reporting to Manager)
  let employeeUser = await prisma.tenantUser.findFirst({
    where: { tenantId: tenant.id, role: 'EMPLOYEE', managerId: managerUser.id },
  });
  if (!employeeUser) {
    employeeUser = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        email: `test-emp-${Date.now()}@acmetest.com`,
        name: 'Test Software Engineer',
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        department: 'Engineering',
        designation: 'Senior Backend Developer',
        managerId: managerUser.id,
        passwordHash: dummyHash,
      },
    });
  }

  // 5. Peer Employee (Same tenant, to test 360 feedback)
  let peerUser = await prisma.tenantUser.findFirst({
    where: { tenantId: tenant.id, role: 'EMPLOYEE', id: { not: employeeUser.id } },
  });
  if (!peerUser) {
    peerUser = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        email: `test-peer-${Date.now()}@acmetest.com`,
        name: 'Test Peer Colleague',
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        department: 'Product',
        designation: 'Frontend Engineer',
        passwordHash: dummyHash,
      },
    });
  }

  // Sign tokens
  const hrToken = signTestToken(hrUser);
  const cmdToken = signTestToken(cmdUser);
  const managerToken = signTestToken(managerUser);
  const employeeToken = signTestToken(employeeUser);
  const peerToken = signTestToken(peerUser);

  console.log(`  Tenant:     ${tenant.companyName} (${tenant.id})`);
  console.log(`  HR:         ${hrUser.name} [${hrUser.role}]`);
  console.log(`  CMD:        ${cmdUser.name} [${cmdUser.role}]`);
  console.log(`  Manager:    ${managerUser.name} [${managerUser.role}]`);
  console.log(`  Employee:   ${employeeUser.name} [reports to: ${managerUser.name}]`);
  console.log(`  Peer:       ${peerUser.name} [${peerUser.role}]\n`);

  // ── Phase 1: Cycle Initialization ──────────────────────────────────────────
  console.log(c.bold('Phase 1: Active Cycle & Appraisal Parameters'));

  const cycleRes = await req('/appraisal-cycles/active', { token: employeeToken });
  assert(cycleRes.status === 200, 'GET /api/appraisal-cycles/active returns 200 OK');
  assert(!!cycleRes.data?.cycle?.id, 'Active cycle exists with unique ID');
  assert(Array.isArray(cycleRes.data?.parameters) && cycleRes.data.parameters.length >= 5, 'Default parameters initialized (>= 5 rating parameters)');

  const cycleId = cycleRes.data?.cycle?.id;
  const parameters = cycleRes.data?.parameters || [];
  const param1 = parameters[0];
  const param2 = parameters[1] || param1;

  // HR updates cycle settings
  const updateCycleRes = await req(`/appraisal-cycles/${cycleId}`, {
    method: 'PATCH',
    token: hrToken,
    body: { name: 'FY 2024-2025 (Annual Review)', frequency: 'ANNUAL' },
  });
  assert(updateCycleRes.status === 200, 'PATCH /api/appraisal-cycles/:id allows HR to update cycle settings');

  // Non-HR cannot update cycle settings (RBAC)
  const forbiddenCycleRes = await req(`/appraisal-cycles/${cycleId}`, {
    method: 'PATCH',
    token: employeeToken,
    body: { name: 'Hacked Cycle' },
  });
  assert(forbiddenCycleRes.status === 403, 'RBAC check: Non-HR employee receives 403 Forbidden updating cycle settings');

  // ── Phase 2: Employee Self-Assessment ──────────────────────────────────────
  console.log(`\n${c.bold('Phase 2: Employee Self-Assessment & Rating')}`);

  // Fetch or create draft review
  const myReviewRes = await req('/performance-reviews/mine', { token: employeeToken });
  assert(myReviewRes.status === 200, 'GET /api/performance-reviews/mine returns or auto-creates DRAFT review');
  const reviewId = myReviewRes.data?.review?.id;
  assert(!!reviewId, 'Performance review has valid ID');

  // Submit self-assessment using POST /appraisals/submit
  const submitSelfRes = await req('/appraisals/submit', {
    method: 'POST',
    token: employeeToken,
    body: {
      selfRating: 4.5,
      selfAccomplishments: 'Designed and deployed multi-tenant architecture with 99.99% uptime.',
      selfWeaknesses: 'Need to write more comprehensive integration documentation.',
      submit: true,
      scores: [
        { parameterId: param1.id, selfScore: 5 },
        { parameterId: param2.id, selfScore: 4 },
      ],
    },
  });

  assert(submitSelfRes.status === 200, 'POST /api/appraisals/submit successfully records self-assessment');
  assert(submitSelfRes.data?.status === 'SUBMITTED', 'Review status transitions to SUBMITTED');
  assert(submitSelfRes.data?.selfRating >= 4.0, 'Self rating properly aggregated and stored');

  // ── Phase 3: 360° Peer Feedback ────────────────────────────────────────────
  console.log(`\n${c.bold('Phase 3: 360° Peer Nominations & Feedback')}`);

  // Clean up any prior nomination between these two for a clean test run
  await prisma.peerNomination.deleteMany({
    where: { cycleId, revieweeId: employeeUser.id, reviewerId: peerUser.id },
  });

  // Employee nominates peer
  const nominateRes = await req('/peer-nominations', {
    method: 'POST',
    token: employeeToken,
    body: { reviewerId: peerUser.id },
  });
  assert(nominateRes.status === 201, 'POST /api/peer-nominations creates nomination with 201 Created');
  const nominationId = nominateRes.data?.id;

  // Negative test: duplicate nomination in same cycle returns 409
  const dupNominateRes = await req('/peer-nominations', {
    method: 'POST',
    token: employeeToken,
    body: { reviewerId: peerUser.id },
  });
  assert(dupNominateRes.status === 409, 'Negative test: Duplicate peer nomination returns 409 Conflict');

  // Peer sees pending nomination
  const pendingRes = await req('/peer-nominations/pending-for-me', { token: peerToken });
  assert(pendingRes.status === 200, 'GET /api/peer-nominations/pending-for-me returns pending requests for peer');
  const hasNomination = pendingRes.data?.nominations?.some((n) => n.id === nominationId);
  assert(hasNomination, 'Peer sees the assigned nomination in their pending inbox');

  // Peer submits feedback
  const feedbackRes = await req(`/peer-nominations/${nominationId}/feedback`, {
    method: 'POST',
    token: peerToken,
    body: {
      rating: 4.8,
      strengths: 'Exceptional problem-solving skills, always available to unblock teammates quickly.',
      growthAreas: 'Could delegate more during sprint crunches to avoid bottlenecks.',
    },
  });
  assert(feedbackRes.status === 201, 'POST /api/peer-nominations/:id/feedback submits 360 feedback');

  // Anonymity Check: Employee views feedback received
  const receivedRes = await req('/peer-feedback/received-by-me', { token: employeeToken });
  assert(receivedRes.status === 200, 'GET /api/peer-feedback/received-by-me returns feedback');
  const receivedItem = receivedRes.data?.items?.[0];
  assert(receivedItem && receivedItem.reviewerId === null, 'PRIVACY CHECK: Reviewer ID is masked (null) for employee');
  assert(receivedItem && receivedItem.reviewer === null, 'PRIVACY CHECK: Reviewer details are masked (null) for employee');

  // Transparency Check: CMD views feedback with full identity
  const cmdFeedbackRes = await req(`/cmd/peer-feedback/${employeeUser.id}`, { token: cmdToken });
  assert(cmdFeedbackRes.status === 200, 'GET /api/cmd/peer-feedback/:employeeId allows CMD access');
  const cmdItem = cmdFeedbackRes.data?.items?.[0];
  assert(cmdItem && cmdItem.reviewerId !== null, 'CMD PRIVILEGE CHECK: Reviewer identity is visible to CMD / Director');

  // ── Phase 4: Manager Evaluation ────────────────────────────────────────────
  console.log(`\n${c.bold('Phase 4: Manager Evaluation & Subordinates')}`);

  // Manager views direct reports
  const teamRes = await req('/team/direct-reports', { token: managerToken });
  assert(teamRes.status === 200, 'GET /api/team/direct-reports returns direct reports for manager');
  const hasEmployee = teamRes.data?.directReports?.some((e) => e.id === employeeUser.id);
  assert(hasEmployee, 'Manager can see their assigned direct report in team list');

  // Manager inspects employee review
  const empReviewRes = await req(`/performance-reviews/employee/${employeeUser.id}`, { token: managerToken });
  assert(empReviewRes.status === 200, 'GET /api/performance-reviews/employee/:id returns review for manager');

  // Manager submits evaluation
  const managerSubmitRes = await req(`/appraisals/${reviewId}/manager-review`, {
    method: 'PATCH',
    token: managerToken,
    body: {
      managerRating: 4.7,
      managerRemarks: 'Outstanding contribution throughout the quarter. Delivered all high-priority epics.',
      scores: [
        { parameterId: param1.id, managerScore: 5 },
        { parameterId: param2.id, managerScore: 4 },
      ],
    },
  });
  assert(managerSubmitRes.status === 200, 'PATCH /api/appraisals/:id/manager-review saves manager evaluation');
  assert(managerSubmitRes.data?.status === 'MANAGER_REVIEWED', 'Review status transitions to MANAGER_REVIEWED');

  // ── Phase 5: HR Audit & Hike Sign-Off ──────────────────────────────────────
  console.log(`\n${c.bold('Phase 5: HR Audit, Merit Increment & Sign-Off')}`);

  // HR views audit comparison
  const hrAuditGetRes = await req(`/performance-reviews/${employeeUser.id}/hr-audit`, { token: hrToken });
  assert(hrAuditGetRes.status === 200, 'GET /api/performance-reviews/:employeeId/hr-audit returns comparison view');

  // HR enters draft hike percentage
  const hrDraftRes = await req(`/performance-reviews/${reviewId}/hr-audit`, {
    method: 'PATCH',
    token: hrToken,
    body: {
      hikePercentage: 14.5,
      hrRemarks: 'Approved for senior band promotion and 14.5% annual merit increase.',
      hrSignoffStatus: 'PENDING_RELEASE',
      scores: [{ parameterId: param1.id, hrScore: 5 }],
    },
  });
  assert(hrDraftRes.status === 200, 'PATCH /api/performance-reviews/:id/hr-audit saves draft hike percentage');

  // HR finalizes and releases sign-off
  const hrReleaseRes = await req(`/performance-reviews/${reviewId}/hr-audit`, {
    method: 'PATCH',
    token: hrToken,
    body: { hrSignoffStatus: 'RELEASED' },
  });
  assert(hrReleaseRes.status === 200, 'HR releases audit sign-off (hrSignoffStatus: RELEASED)');
  assert(hrReleaseRes.data?.status === 'COMPLETED', 'Final appraisal review status transitions to COMPLETED');

  // Immutability Check: Released appraisal cannot be modified
  const tamperRes = await req(`/performance-reviews/${reviewId}/hr-audit`, {
    method: 'PATCH',
    token: hrToken,
    body: { hikePercentage: 20 },
  });
  assert(tamperRes.status === 409, 'IMMUTABILITY CHECK: Modifying a RELEASED audit returns 409 Conflict');

  // ── Phase 6: Summary Reviews Dashboard ─────────────────────────────────────
  console.log(`\n${c.bold('Phase 6: Reviews Dashboard')}`);

  const dashboardRes = await req('/appraisals', { token: employeeToken });
  assert(dashboardRes.status === 200, 'GET /api/appraisals returns full review history');
  const finishedReview = dashboardRes.data?.reviews?.find((r) => r.id === reviewId);
  assert(finishedReview && finishedReview.status === 'COMPLETED', 'Completed review appears in employee dashboard');
  assert(finishedReview && finishedReview.hikePercentage === 14.5, 'Final released hike percentage verified on dashboard');

  // ── Phase 7: Zod Server-Side Validation Tests ──────────────────────────────
  console.log(`\n${c.bold('Phase 7: Server-Side Zod Validation Negative Tests')}`);

  // 1. Rating out of bounds (> 5)
  const invalidRatingRes = await req('/appraisals/submit', {
    method: 'POST',
    token: employeeToken,
    body: { selfRating: 6.5 },
  });
  assert(invalidRatingRes.status === 400, 'Zod validation rejects rating > 5 with 400 Bad Request');

  // 2. Feedback with string too short (< 10 chars)
  const shortFeedbackRes = await req(`/peer-nominations/${nominationId}/feedback`, {
    method: 'POST',
    token: peerToken,
    body: { rating: 4, strengths: 'too short', growthAreas: 'too short' },
  });
  assert(shortFeedbackRes.status === 400, 'Zod validation rejects strengths < 10 characters with 400 Bad Request');

  // 3. Negative hike percentage
  const negHikeRes = await req(`/performance-reviews/${reviewId}/hr-audit`, {
    method: 'PATCH',
    token: hrToken,
    body: { hikePercentage: -5 },
  });
  assert(negHikeRes.status === 400 || negHikeRes.status === 409, 'Zod validation rejects negative hike percentage');

  // ── Final Test Summary ─────────────────────────────────────────────────────
  console.log(`\n${c.bold(c.cyan('══════════════════════════════════════════════════════════════'))}`);
  console.log(c.bold(`   TEST RESULTS: ${c.green(`${passedCount} PASSED`)} | ${failedCount > 0 ? c.red(`${failedCount} FAILED`) : c.green('0 FAILED')}`));
  console.log(`${c.bold(c.cyan('══════════════════════════════════════════════════════════════'))}\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

run()
  .catch((err) => {
    console.error(c.red('Fatal test error:'), err);
    process.exit(1);
  })
  .finally(() => {
    if (internalServer) {
      internalServer.close();
    }
    prisma.$disconnect();
  });
