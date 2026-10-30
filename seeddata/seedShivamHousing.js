/**
 * @file seedShivamHousing.js
 * @description Creates the "Shivam Housing Corporation Ltd" tenant (shovamltd.com)
 * as a complete client-testing company, in the shape of City Expert Care.
 *
 *   Leadership  CMD, Super Admin (Director), Admin
 *   HR          HR Head + HR Manager (both role HR) + 2 executives
 *   Finance     Finance Head (role FINANCE) + 3 executives
 *   6 teams     a MANAGER + 3-4 members each (Projects, Sales, Customer
 *               Relations, Legal, Procurement, IT)
 *
 * Data, for every manager / member / HR / Finance person:
 *   FY 2025-26  4 quarterly goals, closed and rated; 1 task a month, done and
 *               rated (late deliverers lose Final Weightage). Monthly +
 *               quarterly appraisals submitted and locked by HR. The ANNUAL
 *               FY 2025-26 appraisal is at a different stage per team.
 *   FY 2026-27  Q1 + Q2 goals closed and rated (2 tasks a month); Q3 goal
 *               (Oct–Dec) active with tasks across the Kanban, including
 *               overdue (delayed), on-hold, in-review and milestone-tracked
 *               work. Monthly/quarterly appraisals submitted up to a
 *               different point per team; the rest are open to submit.
 *   Extra goals one per team in a special state (draft with weights ≠ 100,
 *               awaiting approval, all tasks awaiting approval, changes
 *               requested, cross-team owner, future quarter).
 *   Leave       leave types, WFH policy, 2026 balances and requests in every
 *               state (approved, pending manager, pending HR, rejected,
 *               cancelled, WFH).
 *   Access      CXO Connect (LEADERSHIP) and registry capabilities.
 *
 * Dry run by default. Safe to re-run (skips what already exists).
 *
 *   node seeddata/seedShivamHousing.js                       # show the plan
 *   node seeddata/seedShivamHousing.js --apply               # create it
 *   node seeddata/seedShivamHousing.js --report=out.json     # dump what is in the DB (for the Excel sheet)
 *   node seeddata/seedShivamHousing.js --cleanup --apply     # remove the whole tenant
 *
 * Every account signs in with the password in PASSWORD below.
 */
import 'dotenv/config';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import { getPeriodMetadata, isQuarterEndMonth } from '../src/lib/appraisalPeriods.js';
import { getTeamTableMetricsBulk } from '../src/services/appraisalMetrics.service.js';

const COMPANY_NAME = 'Shivam Housing Corporation Ltd';
const DOMAIN = 'shovamltd.com';
const TENANT_CODE = 'SHIVAMHOUSING';
const PASSWORD = 'Test@123';
const SEED_TAG = 'seed:shivam-housing';
const APPLY = process.argv.includes('--apply');
const CLEANUP = process.argv.includes('--cleanup');
const REPORT = process.argv.find((a) => a.startsWith('--report='))?.split('=')[1];
const PARAMETERS = ['Technical Skills', 'Conduct & Ethics', 'Punctuality & Attendance', 'Communication', 'Teamwork & Collaboration'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const addDays = (date, n) => new Date(date.getTime() + n * 86400000);
const clamp = (r) => Math.min(5, Math.max(1, r));
const halfStep = (r) => Math.round(r * 2) / 2;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const mail = (local) => `${local}@${DOMAIN}`;

// ── People ──────────────────────────────────────────────────────────────────
// profile → base task rating: star 4.5, solid 4, avg 3.5, late 3 (and delivers late).
// flags: overdue (an unfinished task past its due date), hold (task on hold on a
// dependency), milestone (critical milestone-tracked task), special (extra goal).

const LEADERS = [
  { name: 'Rajendra Prasad Agarwal', local: 'rajendra.agarwal', role: 'CMD', designation: 'Chairman & Managing Director', department: 'Executive', reportsTo: null, band: 'L1' },
  { name: 'Vikram Singh Rathore', local: 'vikram.rathore', role: 'SUPER_ADMIN', designation: 'Director', department: 'Executive', reportsTo: 'rajendra.agarwal', band: 'L1' },
  { name: 'Amit Kumar Saxena', local: 'amit.saxena', role: 'ADMIN', designation: 'Admin & Systems Head', department: 'Administration', reportsTo: 'rajendra.agarwal', band: 'L2' },
];

const TEAMS = [
  {
    key: 'HR', name: 'Human Resources', department: 'Human Resources',
    manager: { name: 'Neha Sharma', local: 'neha.sharma', role: 'HR', designation: 'HR Head', profile: 'solid' },
    members: [
      { name: 'Pooja Tiwari', local: 'pooja.tiwari', role: 'HR', designation: 'HR Manager', profile: 'star', milestone: true },
      { name: 'Ankit Verma', local: 'ankit.verma', designation: 'HR Executive', profile: 'solid', hold: true },
      { name: 'Shalini Gupta', local: 'shalini.gupta', designation: 'Talent Acquisition Executive', profile: 'avg', overdue: true },
    ],
    goals: ['Site staff hiring plan', 'Payroll & compliance accuracy', 'Employee engagement & retention', 'Annual training calendar'],
    work: ['Recruitment drive for site staff', 'Payroll inputs verification', 'Employee engagement activity', 'Onboarding of new joiners', 'Training calendar execution', 'Attendance & leave audit'],
    annual: 'SUBMITTED', managerAnnual: 'NONE', periodic: 'ALL_SUBMITTED',
  },
  {
    key: 'FIN', name: 'Finance & Accounts', department: 'Finance',
    manager: { name: 'Manish Agarwal', local: 'manish.agarwal', role: 'FINANCE', designation: 'Finance Head', profile: 'solid' },
    members: [
      { name: 'Rohit Bansal', local: 'rohit.bansal', designation: 'Accounts Executive', profile: 'solid', overdue: true },
      { name: 'Kavita Jain', local: 'kavita.jain', designation: 'Senior Accountant', profile: 'star', milestone: true },
      { name: 'Vivek Goel', local: 'vivek.goel', designation: 'Billing & Collections Executive', profile: 'avg', hold: true },
    ],
    goals: ['Books closing discipline', 'Statutory compliance (GST/TDS)', 'Collections & receivables', 'FY close & audit readiness'],
    work: ['Month-end books closing', 'GST return filing', 'Vendor payment run', 'Collections reconciliation', 'TDS compliance check', 'Budget vs actual report'],
    annual: 'NONE', managerAnnual: 'SUBMITTED', periodic: 'UP_TO_JULY',
  },
  {
    key: 'T1', name: 'Projects & Construction', department: 'Projects & Construction',
    manager: { name: 'Sanjay Kumar Yadav', local: 'sanjay.yadav', designation: 'Project Manager', profile: 'solid' },
    members: [
      { name: 'Rahul Chauhan', local: 'rahul.chauhan', designation: 'Site Engineer', profile: 'solid', milestone: true },
      { name: 'Deepak Mishra', local: 'deepak.mishra', designation: 'Civil Engineer', profile: 'star' },
      { name: 'Pankaj Tripathi', local: 'pankaj.tripathi', designation: 'Quantity Surveyor', profile: 'late', overdue: true },
      { name: 'Arvind Pandey', local: 'arvind.pandey', designation: 'Site Supervisor', profile: 'avg', hold: true, special: 'DRAFT' },
    ],
    goals: ['Tower A structure completion', 'Tower B foundation & slab cycle', 'Phase-1 finishing works', 'Phase-1 handover readiness'],
    work: ['Site progress inspection — Tower A', 'Concrete pour quality check', 'Contractor billing verification', 'Safety audit at site', 'Material reconciliation report', 'Weekly progress report to management'],
    annual: 'FINALISED', managerAnnual: 'FINALISED', periodic: 'ALL_SUBMITTED',
  },
  {
    key: 'T2', name: 'Sales & Marketing', department: 'Sales & Marketing',
    manager: { name: 'Priya Malhotra', local: 'priya.malhotra', designation: 'Sales & Marketing Manager', profile: 'solid' },
    members: [
      { name: 'Karan Khanna', local: 'karan.khanna', designation: 'Sales Executive', profile: 'star', milestone: true },
      { name: 'Sneha Kapoor', local: 'sneha.kapoor', designation: 'Digital Marketing Executive', profile: 'solid', special: 'PENDING_APPROVAL' },
      { name: 'Varun Arora', local: 'varun.arora', designation: 'Sales Executive', profile: 'late', overdue: true },
      { name: 'Nikita Bhatia', local: 'nikita.bhatia', designation: 'Channel Partner Executive', profile: 'avg', hold: true },
    ],
    goals: ['New launch bookings — Shivam Greens', 'Channel partner network growth', 'Festive season sales drive', 'Inventory liquidation — Phase 1'],
    work: ['Site visits for walk-in leads', 'Booking follow-ups', 'Channel partner meet', 'Digital campaign for new launch', 'CRM lead hygiene', 'Monthly sales MIS'],
    annual: 'SHARED', managerAnnual: 'FINALISED', periodic: 'UP_TO_AUGUST',
  },
  {
    key: 'T3', name: 'Customer Relations & Allotment', department: 'Customer Relations',
    manager: { name: 'Alok Srivastava', local: 'alok.srivastava', designation: 'CRM Manager', profile: 'solid' },
    members: [
      { name: 'Shweta Dubey', local: 'shweta.dubey', designation: 'CRM Executive', profile: 'solid', special: 'READY_FOR_APPROVAL' },
      { name: 'Gaurav Shukla', local: 'gaurav.shukla', designation: 'Allotment Officer', profile: 'avg', overdue: true, milestone: true },
      { name: 'Ritu Awasthi', local: 'ritu.awasthi', designation: 'Customer Care Executive', profile: 'star', hold: true },
    ],
    goals: ['Allottee communication & demand letters', 'Grievance turnaround time', 'Possession handover programme', 'Customer satisfaction uplift'],
    work: ['Demand letters to allottees', 'Customer grievance closure', 'Possession handover scheduling', 'Allotment letter issuance', 'Payment reminder calls', 'Customer satisfaction survey'],
    annual: 'MANAGER_REVIEWED', managerAnnual: 'SUBMITTED', periodic: 'UP_TO_JULY',
  },
  {
    key: 'T4', name: 'Legal & Land Acquisition', department: 'Legal',
    manager: { name: 'Anil Kumar Tyagi', local: 'anil.tyagi', designation: 'Legal Manager', profile: 'solid' },
    members: [
      { name: 'Rajesh Chaudhary', local: 'rajesh.chaudhary', designation: 'Legal Officer', profile: 'solid', milestone: true },
      { name: 'Meenakshi Rastogi', local: 'meenakshi.rastogi', designation: 'Documentation Executive', profile: 'star', special: 'CHANGES_REQUESTED' },
      { name: 'Sunil Bhardwaj', local: 'sunil.bhardwaj', designation: 'Land Survey Officer', profile: 'late', overdue: true, hold: true },
    ],
    goals: ['RERA compliance & approvals', 'Land title due diligence', 'Agreement & registry turnaround', 'Litigation closure'],
    work: ['RERA quarterly compliance filing', 'Title verification of land parcels', 'Agreement for sale drafting', 'Court hearing preparation', 'Land survey & demarcation', 'Registry documentation'],
    annual: 'SUBMITTED', managerAnnual: 'SUBMITTED', periodic: 'Q1_AWAITING_HR',
  },
  {
    key: 'T5', name: 'Procurement & Contracts', department: 'Procurement',
    manager: { name: 'Rakesh Goyal', local: 'rakesh.goyal', designation: 'Procurement Manager', profile: 'solid' },
    members: [
      { name: 'Manoj Singhal', local: 'manoj.singhal', designation: 'Purchase Executive', profile: 'solid', special: 'CROSS_TEAM', annual: 'SUBMITTED' },
      { name: 'Sachin Garg', local: 'sachin.garg', designation: 'Contracts Executive', profile: 'avg', overdue: true, annual: 'DRAFT' },
      { name: 'Payal Mittal', local: 'payal.mittal', designation: 'Vendor Management Executive', profile: 'star', milestone: true, annual: 'SUBMITTED' },
      { name: 'Harish Rawat', local: 'harish.rawat', designation: 'Store & Inventory Officer', profile: 'late', overdue: true, hold: true, annual: 'DRAFT' },
    ],
    goals: ['Vendor base rationalisation', 'Cement & steel cost savings', 'Contract work-order turnaround', 'Inventory accuracy'],
    work: ['Vendor quotation comparison', 'Purchase order issuance', 'Cement & steel rate negotiation', 'Contractor work order drafting', 'Inventory stock audit', 'Vendor payment reconciliation'],
    annual: 'MIXED', managerAnnual: 'NONE', periodic: 'APR_MAY_ONLY',
  },
  {
    key: 'T6', name: 'IT & Systems', department: 'IT',
    manager: { name: 'Ashish Joshi', local: 'ashish.joshi', designation: 'IT Manager', profile: 'solid' },
    members: [
      { name: 'Mohit Negi', local: 'mohit.negi', designation: 'Software Engineer', profile: 'star', milestone: true, special: 'FUTURE' },
      { name: 'Ankita Bisht', local: 'ankita.bisht', designation: 'System Administrator', profile: 'solid', hold: true },
      { name: 'Tarun Sethi', local: 'tarun.sethi', designation: 'IT Support Engineer', profile: 'avg', overdue: true, newJoiner: true },
    ],
    goals: ['ERP stabilisation', 'Infrastructure uptime & backups', 'Helpdesk SLA', 'Digital sales enablement'],
    work: ['ERP module enhancement', 'Server backup verification', 'Helpdesk ticket resolution', 'Website lead form integration', 'IT asset inventory', 'Network security patching'],
    annual: 'NONE', managerAnnual: 'NONE', periodic: 'NONE',
  },
];

const BASE = { star: 4.5, solid: 4, avg: 3.5, late: 3 };
const WOBBLE = [0, 0.5, -0.5, 0, 0.5, 0];
const NEW_JOINER_DATE = utc(2026, 7, 3);
const OLD_JOIN_DATE = utc(2024, 5, 3);

// FY 2026-27 periodic appraisals opened so far (today: 30 Oct 2026 → October opens 1 Nov).
// Per plan: which are submitted, and which of those HR has locked.
const FY27_PERIODS = ['April 2026', 'May 2026', 'Q1 FY 2026-27', 'July 2026', 'August 2026', 'Q2 FY 2026-27'];
const PERIODIC_PLANS = {
  ALL_SUBMITTED: { submitted: FY27_PERIODS, locked: ['April 2026', 'May 2026', 'Q1 FY 2026-27'] },
  UP_TO_AUGUST: { submitted: FY27_PERIODS.slice(0, 5), locked: ['April 2026', 'May 2026', 'Q1 FY 2026-27'] },
  UP_TO_JULY: { submitted: FY27_PERIODS.slice(0, 4), locked: ['April 2026', 'May 2026', 'Q1 FY 2026-27'] },
  Q1_AWAITING_HR: { submitted: FY27_PERIODS.slice(0, 3), locked: [] },
  APR_MAY_ONLY: { submitted: FY27_PERIODS.slice(0, 2), locked: FY27_PERIODS.slice(0, 2) },
  NONE: { submitted: [], locked: [] },
};
// FY 2025-26: everything submitted and locked, except Legal's Q4 left awaiting HR.
const FY26_AWAITING_HR = { T4: ['Q4 FY 2025-26'] };

const ACHIEVEMENTS = {
  high: 'Exceeded every target for the period, delivered all tasks ahead of schedule and supported teammates on critical work.',
  mid: 'Met the targets for the period and completed all planned tasks on time.',
  low: 'Completed the assigned work, though a few deliveries slipped; I am tightening my planning for the next period.',
};
const WEAKNESSES = {
  star: 'Would like to take on team-lead responsibilities and attend a leadership programme.',
  solid: 'Want to improve presentation skills for management reviews.',
  avg: 'Need to plan workload earlier and keep performance consistent month to month.',
  late: 'On-time delivery — several tasks slipped by a few days. Requesting time-management training.',
};

// ── Leave requests ──────────────────────────────────────────────────────────
// state: APPROVED | PENDING_MANAGER | PENDING_HR | REJECTED_MANAGER | REJECTED_HR | CANCELLED
const LEAVES = [
  { who: 'deepak.mishra', code: 'CASUAL', from: utc(2026, 7, 14), to: utc(2026, 7, 14), days: 1, state: 'APPROVED', reason: 'Family function in Kanpur.' },
  { who: 'karan.khanna', code: 'ANNUAL', from: utc(2026, 8, 1), to: utc(2026, 8, 5), days: 5, state: 'APPROVED', reason: 'Family trip to Rishikesh.' },
  { who: 'shweta.dubey', code: 'SICK', from: utc(2026, 8, 22), to: utc(2026, 8, 23), days: 2, state: 'APPROVED', reason: 'Viral fever.' },
  { who: 'rajesh.chaudhary', code: 'ANNUAL', from: utc(2026, 9, 5), to: utc(2026, 9, 7), days: 3, state: 'APPROVED', reason: 'Sister\'s wedding.' },
  { who: 'payal.mittal', code: 'CASUAL', from: utc(2026, 9, 16), to: utc(2026, 9, 16), days: 1, state: 'APPROVED', reason: 'Personal work at bank.' },
  { who: 'mohit.negi', code: 'SICK', from: utc(2026, 6, 10), to: utc(2026, 6, 11), days: 2, state: 'APPROVED', reason: 'Dental surgery.' },
  { who: 'ankit.verma', code: 'ANNUAL', from: utc(2026, 9, 27), to: utc(2026, 9, 29), days: 3, state: 'APPROVED', reason: 'Chhath Puja at native place.' },
  { who: 'kavita.jain', code: 'CASUAL', from: utc(2026, 7, 28), to: utc(2026, 7, 28), days: 0.5, dayType: 'FIRST_HALF', state: 'APPROVED', reason: 'Parent-teacher meeting.' },
  { who: 'rahul.chauhan', code: 'ANNUAL', from: utc(2026, 10, 9), to: utc(2026, 10, 13), days: 5, state: 'PENDING_MANAGER', reason: 'Diwali vacation with family.' },
  { who: 'nikita.bhatia', code: 'CASUAL', from: utc(2026, 10, 6), to: utc(2026, 10, 6), days: 1, state: 'PENDING_MANAGER', reason: 'House shifting.' },
  { who: 'sachin.garg', code: 'SICK', from: utc(2026, 9, 30), to: utc(2026, 9, 30), days: 1, state: 'PENDING_MANAGER', reason: 'Migraine, unable to travel to office.' },
  { who: 'gaurav.shukla', code: 'ANNUAL', from: utc(2026, 10, 16), to: utc(2026, 10, 20), days: 5, state: 'PENDING_HR', reason: 'Pilgrimage to Vaishno Devi.' },
  { who: 'ankita.bisht', code: 'CASUAL', from: utc(2026, 10, 3), to: utc(2026, 10, 4), days: 2, state: 'PENDING_HR', reason: 'Visiting family in Dehradun.' },
  { who: 'varun.arora', code: 'ANNUAL', from: utc(2026, 9, 19), to: utc(2026, 9, 23), days: 5, state: 'REJECTED_MANAGER', reason: 'Vacation.', comment: 'Rejected — festive season sales push, please re-apply for December.' },
  { who: 'harish.rawat', code: 'CASUAL', from: utc(2026, 9, 13), to: utc(2026, 9, 13), days: 1, state: 'REJECTED_HR', reason: 'Personal work.', comment: 'Rejected by HR — stock audit scheduled on this date.' },
  { who: 'meenakshi.rastogi', code: 'ANNUAL', from: utc(2026, 8, 15), to: utc(2026, 8, 16), days: 2, state: 'CANCELLED', reason: 'Short trip.' },
  { who: 'sneha.kapoor', wfh: true, from: utc(2026, 9, 22), to: utc(2026, 9, 23), days: 2, state: 'APPROVED', reason: 'Campaign launch from home, internet setup ready.' },
  { who: 'mohit.negi', wfh: true, from: utc(2026, 10, 4), to: utc(2026, 10, 5), days: 2, state: 'PENDING_MANAGER', reason: 'Server migration over night, will work from home.' },
  { who: 'rohit.bansal', wfh: true, from: utc(2026, 9, 9), to: utc(2026, 9, 9), days: 1, state: 'APPROVED', reason: 'Plumber visit at home.' },
];
const LEAVE_TYPES = [
  { code: 'ANNUAL', name: 'Annual Leave', description: 'Paid time off for rest, recreation, and personal pursuits.', defaultDays: 18, carryForwardAllowed: true, maxCarryForwardDays: 5 },
  { code: 'SICK', name: 'Sick Leave', description: 'Time off for medical recovery, illnesses, and healthcare visits.', defaultDays: 10, requiresDocument: true },
  { code: 'CASUAL', name: 'Casual Leave', description: 'Short leaves for urgent personal affairs and unforeseen contingencies.', defaultDays: 8, maxConsecutiveDays: 3 },
];

// ── Build the flat roster ───────────────────────────────────────────────────
function roster() {
  const people = LEADERS.map((p) => ({ ...p, team: null, isLeader: true }));
  let seq = 1;
  for (const p of people) p.employeeId = `SHC-${String(seq++).padStart(3, '0')}`;
  for (const team of TEAMS) {
    const mgr = { ...team.manager, role: team.manager.role || 'MANAGER', department: team.department, reportsTo: 'rajendra.agarwal', team, isManager: true, band: 'M1' };
    mgr.employeeId = `SHC-${String(seq++).padStart(3, '0')}`;
    people.push(mgr);
    for (const m of team.members) {
      people.push({ ...m, role: m.role || 'EMPLOYEE', department: team.department, reportsTo: team.manager.local, team, band: m.role === 'HR' ? 'M2' : 'E2', employeeId: `SHC-${String(seq++).padStart(3, '0')}` });
    }
  }
  people.forEach((p, i) => { p.index = i; p.email = mail(p.local); });
  return people;
}

const PEOPLE = roster();
const byLocal = Object.fromEntries(PEOPLE.map((p) => [p.local, p]));
const workers = PEOPLE.filter((p) => p.team); // everyone who gets goals and appraisals

const ratingFor = (p, monthSerial) => clamp(halfStep(BASE[p.profile] + WOBBLE[(monthSerial + p.index) % WOBBLE.length]));
const ownerOf = (p) => (p.isManager ? byLocal['rajendra.agarwal'] : byLocal[p.reportsTo]);
const annualStageOf = (p) => (p.isManager ? p.team.managerAnnual : (p.annual || p.team.annual));

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (REPORT && !APPLY && !CLEANUP) return writeReport(REPORT);
  console.log(`${COMPANY_NAME} (${DOMAIN})  mode: ${CLEANUP ? 'CLEANUP' : ''}${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  if (CLEANUP) return cleanup();

  printPlan();
  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  const tenant = await upsertTenant();
  const ids = await upsertUsers(tenant);
  const ctx = { tenant, ids, user: (local) => ({ id: ids[local], name: byLocal[local].name, email: byLocal[local].email }) };

  await seedAccess(ctx);
  const counts = { goals: 0, tasks: 0 };
  for (const p of workers) await seedGoals(ctx, p, counts);
  console.log(`Goals created: ${counts.goals}, tasks created: ${counts.tasks}`);
  await seedAppraisals(ctx);
  await seedLeaves(ctx);

  if (REPORT) await writeReport(REPORT);
  console.log(`\nDone. Sign in with any ${DOMAIN} email below, password ${PASSWORD}.`);
}

function printPlan() {
  console.log('Leadership:');
  LEADERS.forEach((p) => console.log(`  ${p.role.padEnd(12)} ${p.name} <${mail(p.local)}>`));
  for (const team of TEAMS) {
    console.log(`\n${team.name}  (annual FY 2025-26: ${team.annual}, periodic FY 2026-27: ${team.periodic})`);
    console.log(`  ${(team.manager.role || 'MANAGER').padEnd(12)} ${team.manager.name} <${mail(team.manager.local)}>  own annual: ${team.managerAnnual}`);
    team.members.forEach((m) => console.log(`  ${(m.role || 'EMPLOYEE').padEnd(12)} ${m.name} <${mail(m.local)}>  ${m.profile}${m.overdue ? ' overdue' : ''}${m.hold ? ' hold' : ''}${m.milestone ? ' milestone' : ''}${m.special ? ` special:${m.special}` : ''}${m.newJoiner ? ' new-joiner' : ''}`));
  }
  console.log(`\nUsers: ${PEOPLE.length}. Leave requests: ${LEAVES.length}.`);
}

async function upsertTenant() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const cmd = LEADERS[0];
  let registration = await prisma.companyRegistration.findFirst({ where: { OR: [{ domainName: DOMAIN }, { tenantCode: TENANT_CODE }] } });
  if (!registration) {
    registration = await prisma.companyRegistration.create({
      data: {
        companyName: COMPANY_NAME, companyType: 'Public Limited', domainName: DOMAIN, tenantCode: TENANT_CODE,
        fullName: cmd.name, designation: cmd.designation, email: mail(cmd.local),
        hrEmail: mail('neha.sharma'), financeEmail: mail('manish.agarwal'), passwordHash,
        status: 'ACTIVE', licenseQuantity: 100, acceptedTermsAt: new Date(), activatedAt: new Date(),
      },
    });
  }
  let tenant = await prisma.tenant.findFirst({ where: { OR: [{ domainName: DOMAIN }, { tenantCode: TENANT_CODE }] } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { companyName: COMPANY_NAME, domainName: DOMAIN, tenantCode: TENANT_CODE, licenseLimit: 100, status: 'ACTIVE', registrationId: registration.id },
    });
  }
  if (!(await prisma.tenantSettings.findUnique({ where: { tenantId: tenant.id } }))) {
    await prisma.tenantSettings.create({
      data: { tenantId: tenant.id, financialYearStartMonth: 4, financialYearStartDay: 1, milestoneRequireApproval: true, milestoneWatcherDomains: [DOMAIN] },
    });
  }
  const departments = ['Executive', 'Administration', ...TEAMS.map((t) => t.department)];
  for (const [i, name] of departments.entries()) {
    await prisma.department.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name } },
      update: {},
      create: { tenantId: tenant.id, name, sortOrder: i + 1, isActive: true },
    });
  }
  console.log(`Tenant ready: ${tenant.id} (${tenant.tenantCode})`);
  return tenant;
}

async function upsertUsers(tenant) {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const ids = {};
  for (const p of PEOPLE) {
    const existing = await prisma.tenantUser.findUnique({ where: { email: p.email } });
    if (existing) {
      if (existing.tenantId !== tenant.id) throw new Error(`${p.email} already exists in another tenant`);
      ids[p.local] = existing.id;
      continue;
    }
    const female = /^(neha|pooja|shalini|kavita|priya|sneha|nikita|shweta|ritu|meenakshi|payal|ankita)\./.test(p.local);
    const created = await prisma.tenantUser.create({
      data: {
        tenantId: tenant.id, email: p.email, name: p.name, passwordHash, role: p.role, status: 'ACTIVE',
        mustChangePassword: false, isVerified: true, verificationStatus: 'VERIFIED', empType: 'PERMANENT',
        employeeId: p.employeeId, department: p.department, designation: p.designation, band: p.band,
        officeLocation: p.team?.key === 'T1' ? 'Site Office — Gomti Nagar Extension, Lucknow' : 'Corporate Office — Hazratganj, Lucknow',
        gender: female ? 'Female' : 'Male', phone: `+91 98${String(10000000 + p.index * 731).slice(0, 8)}`,
        presentCity: 'Lucknow', presentState: 'Uttar Pradesh',
        joinDate: p.newJoiner ? NEW_JOINER_DATE : p.isLeader ? utc(2019, 3, 1) : OLD_JOIN_DATE,
      },
    });
    ids[p.local] = created.id;
  }
  for (const p of PEOPLE) {
    await prisma.tenantUser.update({ where: { id: ids[p.local] }, data: { managerId: p.reportsTo ? ids[p.reportsTo] : null } });
  }
  console.log(`Users ready: ${PEOPLE.length}`);
  return ids;
}

async function seedAccess({ tenant, ids }) {
  const grants = [
    { who: 'rajendra.agarwal', capability: 'LEADERSHIP', title: 'Chairman & Managing Director' },
    { who: 'vikram.rathore', capability: 'LEADERSHIP', title: 'Director' },
    { who: 'neha.sharma', capability: 'LEADERSHIP', title: 'Chief People Officer' },
    { who: 'pooja.tiwari', capability: 'REGISTRY_SEARCH' },
    { who: 'pooja.tiwari', capability: 'REGISTRY_WRITE' },
    { who: 'amit.saxena', capability: 'REGISTRY_ANALYTICS' },
    { who: 'amit.saxena', capability: 'REGISTRY_EXPORT' },
  ];
  for (const g of grants) {
    const exists = await prisma.userCapability.findUnique({ where: { userId_capability: { userId: ids[g.who], capability: g.capability } } });
    if (exists) continue;
    await prisma.userCapability.create({ data: { tenantId: tenant.id, userId: ids[g.who], capability: g.capability, title: g.title, grantedById: ids['vikram.rathore'] } });
    await prisma.capabilityAuditLog.create({
      data: { tenantId: tenant.id, action: 'GRANT', capability: g.capability, targetUserId: ids[g.who], actorId: ids['vikram.rathore'], actorRole: 'SUPER_ADMIN', title: g.title },
    });
  }
}

// ── Goals & tasks ───────────────────────────────────────────────────────────
async function createGoal(ctx, p, owner, g, counts) {
  const { tenant } = ctx;
  const existing = await prisma.goal.findFirst({ where: { tenantId: tenant.id, employeeId: ctx.ids[p.local], title: g.title } });
  if (existing) return null;
  const goal = await prisma.goal.create({
    data: {
      tenantId: tenant.id, employeeId: ctx.ids[p.local], createdById: g.createdById || owner.id, createdBy: g.createdBy || owner.name,
      ownerManagerId: owner.id, title: g.title, description: g.description, category: p.team.name, priority: g.priority || 'high',
      goalType: 'General', status: g.status, approvalMode: g.approvalMode === undefined ? 'MANAGER_APPROVAL' : g.approvalMode,
      progress: g.progress, financialYear: g.fy, quarter: g.quarter, startDate: g.start, targetDate: g.end, dueDate: g.end,
      milestones: g.tasks.length, completedMilestones: g.tasks.filter((t) => t.status === 'done').length, weightLockExempt: false,
      specialNotes: g.specialNotes,
      ...(g.rating !== undefined && { managerRating: g.rating, managerRatingNotes: g.ratingNotes, closedAt: g.closedAt, closedById: owner.id }),
    },
  });
  await prisma.goalAssignment.create({
    data: {
      tenantId: tenant.id, goalId: goal.id, employeeId: ctx.ids[p.local], assignedById: owner.id,
      status: g.assignmentStatus, progress: g.progress, milestones: g.tasks.length,
      completedMilestones: g.tasks.filter((t) => t.status === 'done').length,
      ...(g.rating !== undefined && { managerRating: g.rating }),
    },
  });
  await prisma.goalAuditLog.create({ data: { goalId: goal.id, performedById: g.createdById || owner.id, action: 'GOAL_CREATED', details: `Goal "${g.title}" created (${SEED_TAG}).` } });
  counts.goals += 1;

  for (const t of g.tasks) {
    const task = await prisma.task.create({
      data: {
        tenantId: tenant.id, employeeId: ctx.ids[p.local], goalId: goal.id, title: t.title,
        description: t.description || `${t.title}. Part of goal "${g.title}".`,
        priority: t.priority || 'medium', status: t.status, progress: t.progress, weight: t.weight,
        startDate: t.start, dueDate: t.due, actualStartDate: t.actualStart ?? null, actualCompletionDate: t.doneAt ?? null,
        financialYear: g.fy, tags: SEED_TAG, isPrivate: false, isStandalone: false,
        isMilestoneTracked: Boolean(t.milestones), dependency: t.dependency ?? undefined,
        holdStartedAt: t.holdStartedAt ?? null, onHoldReason: t.onHoldReason ?? null,
        reviewStatus: t.reviewStatus ?? null, reviewSubmittedAt: t.reviewSubmittedAt ?? null,
        ...(t.reviewStatus === 'APPROVED' && { reviewedById: owner.id, reviewedAt: t.doneAt }),
        ...(t.rating !== undefined && {
          managerRating: t.rating, managerRatedById: owner.id, managerRatedAt: addDays(t.doneAt, 1),
          managerRatingNotes: t.rating >= 4.5 ? 'Excellent work.' : t.rating >= 3.5 ? 'Good, on track.' : 'Needs improvement.',
        }),
        ...(t.finalWeight !== undefined && {
          managerFinalWeight: t.finalWeight, weightAdjustedById: owner.id, weightAdjustedAt: addDays(t.doneAt, 1),
          weightAdjustReason: `Delivered ${t.lateDays} days after the due date.`,
        }),
      },
    });
    counts.tasks += 1;
    if (t.comment) await prisma.taskComment.create({ data: { taskId: task.id, authorId: t.comment.by, comment: t.comment.text, attachments: [] } });
    for (const [i, m] of (t.milestones || []).entries()) {
      await prisma.taskMilestone.create({
        data: {
          tenantId: tenant.id, taskId: task.id, order: i + 1, title: m.title, dueDate: m.due, status: m.status,
          isDone: m.status === 'DONE', progress: m.status === 'DONE' ? 100 : m.progress || 0,
          watcherEmails: [p.email, owner.email], createdById: owner.id, assigneeId: ctx.ids[p.local],
          ...(m.status !== 'PENDING_APPROVAL' && { approvedById: owner.id, approvedAt: addDays(t.start, 1) }),
          ...(m.status === 'DONE' && { completedById: ctx.ids[p.local], completedAt: m.due }),
        },
      });
    }
  }
  if (g.goalComment) await prisma.goalComment.create({ data: { goalId: goal.id, authorId: owner.id, comment: g.goalComment, attachments: [] } });
  return goal;
}

/** A closed, rated quarter: tasks done on time (or late for late deliverers) and rated by the goal owner. */
function closedQuarter(p, q, perMonth, weights) {
  const tasks = [];
  q.months.forEach(([y, m], mi) => {
    const rating = ratingFor(p, y * 12 + m);
    for (let ti = 0; ti < perMonth; ti += 1) {
      const n = tasks.length;
      const weight = weights[n];
      const due = utc(y, m, perMonth === 1 ? 20 : ti === 0 ? 12 : 25);
      const late = p.profile === 'late' && mi > 0 && ti === perMonth - 1;
      const lateDays = late ? (perMonth === 1 ? 5 : 4) : 0;
      const doneAt = addDays(due, late ? lateDays : -1);
      tasks.push({
        title: `${p.team.work[(mi * perMonth + ti + q.offset) % 6]} — ${MONTHS[m]} ${y}`,
        status: 'done', progress: 100, weight, start: addDays(due, -9), due, actualStart: addDays(due, -9), doneAt,
        reviewStatus: 'APPROVED', rating: clamp(ti === 0 ? rating : rating - (rating >= 4.5 ? 0.5 : 0)),
        ...(late && { finalWeight: weight - (perMonth === 1 ? 10 : 5), lateDays }),
      });
    }
  });
  const goalRating = halfStep(mean(tasks.map((t) => t.rating)));
  const [ly, lm] = q.months[q.months.length - 1];
  return {
    title: `${q.label}: ${q.goal}`, description: `${q.goal} for ${q.label}. Goal owner rates each task on completion.`,
    status: 'COMPLETED', assignmentStatus: 'COMPLETED', progress: 100, fy: q.fy, quarter: q.quarter,
    start: utc(q.months[0][0], q.months[0][1], 1), end: utc(ly, lm + 1, 0), tasks,
    rating: goalRating, closedAt: utc(ly, lm + 1, 3),
    ratingNotes: goalRating >= 4.5 ? 'Outstanding delivery on this goal.' : goalRating >= 3.5 ? 'Goal achieved as planned.' : 'Goal achieved with delays; plan better.',
  };
}

const quartersOf = (fyStart, team) => [0, 1, 2, 3].map((qi) => ({
  quarter: `Q${qi + 1}`, fy: `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`, goal: team.goals[qi], offset: qi,
  months: [0, 1, 2].map((k) => { const mm = 3 + qi * 3 + k; return [fyStart + (mm >= 12 ? 1 : 0), mm % 12]; }),
  label: (() => {
    const s = 3 + qi * 3; const e = s + 2;
    return `${MONTHS[s % 12].slice(0, 3)}–${MONTHS[e % 12].slice(0, 3)} ${fyStart + (e >= 12 ? 1 : 0)}`;
  })(),
}));

async function seedGoals(ctx, p, counts) {
  const owner = { id: ctx.ids[ownerOf(p).local], name: ownerOf(p).name, email: ownerOf(p).email };
  const self = { id: ctx.ids[p.local], name: p.name };

  if (!p.newJoiner) {
    // FY 2025-26: 4 closed quarters, one task a month (30 / 30 / 40).
    for (const q of quartersOf(2025, p.team)) await createGoal(ctx, p, owner, closedQuarter(p, q, 1, [30, 30, 40]), counts);
  }
  // FY 2026-27 Q1 + Q2: closed, two tasks a month. The new joiner (Aug 2026) only has Aug–Sep.
  const [q1, q2, q3] = quartersOf(2026, p.team);
  if (!p.newJoiner) await createGoal(ctx, p, owner, closedQuarter(p, q1, 2, [15, 15, 15, 20, 15, 20]), counts);
  if (p.newJoiner) {
    const g = closedQuarter(p, { ...q2, months: q2.months.slice(1) }, 2, [25, 25, 25, 25]);
    g.start = NEW_JOINER_DATE;
    g.description = `${q2.goal} — joined on 3 Aug 2026, so this goal covers August and September only.`;
    await createGoal(ctx, p, owner, g, counts);
  } else {
    await createGoal(ctx, p, owner, closedQuarter(p, q2, 2, [15, 15, 15, 20, 15, 20]), counts);
  }

  // FY 2026-27 Q3 (Oct–Dec): the live Kanban.
  const w = p.team.work;
  const otherTeam = TEAMS[(TEAMS.indexOf(p.team) + 1) % TEAMS.length];
  const tasks = [
    { title: `${w[0]} — October 2026`, status: 'done', progress: 100, weight: 15, start: utc(2026, 9, 1), due: utc(2026, 9, 9), actualStart: utc(2026, 9, 1), doneAt: utc(2026, 9, 8), reviewStatus: 'APPROVED' },
    {
      title: `${w[1]} — October 2026`, status: 'in_review', progress: 100, weight: 15, start: utc(2026, 9, 12), due: utc(2026, 9, 31), actualStart: utc(2026, 9, 12),
      reviewStatus: 'SUBMITTED', reviewSubmittedAt: utc(2026, 9, 28), comment: { by: self.id, text: 'Completed and submitted for your review. Supporting sheet attached in the drive folder.' },
    },
    p.milestone
      ? {
        title: `${w[2]} — critical deliverable (Nov 2026)`, status: 'in_progress', progress: 45, weight: 20, priority: 'critical',
        start: utc(2026, 9, 5), due: utc(2026, 10, 20), actualStart: utc(2026, 9, 6),
        milestones: [
          { title: 'Plan & scope signed off', due: utc(2026, 9, 15), status: 'DONE' },
          { title: 'First draft / mid-way review', due: utc(2026, 10, 10), status: 'APPROVED', progress: 40 },
          { title: 'Final delivery & sign-off', due: utc(2026, 10, 20), status: 'PENDING_APPROVAL' },
        ],
      }
      : { title: `${w[2]} — November 2026`, status: 'in_progress', progress: 40, weight: 20, start: utc(2026, 9, 15), due: utc(2026, 10, 14), actualStart: utc(2026, 9, 16) },
    p.overdue
      ? {
        title: `${w[3]} — October 2026 (overdue)`, status: 'in_progress', progress: 60, weight: 15, start: utc(2026, 9, 5), due: utc(2026, 9, 20), actualStart: utc(2026, 9, 9),
        comment: { by: owner.id, text: 'This is past its due date (20 Oct). Please share a revised completion date today.' },
      }
      : { title: `${w[3]} — November 2026`, status: 'todo', progress: 0, weight: 15, start: utc(2026, 10, 2), due: utc(2026, 10, 21) },
    p.hold
      ? {
        title: `${w[4]} — November 2026`, status: 'pending_on_others', progress: 30, weight: 15, start: utc(2026, 9, 14), due: utc(2026, 10, 27), actualStart: utc(2026, 9, 14),
        holdStartedAt: utc(2026, 9, 22), onHoldReason: `Waiting on inputs from ${otherTeam.name} (${otherTeam.manager.name}).`,
        dependency: { assigneeId: ctx.ids[otherTeam.manager.local], depTitle: `Inputs required from ${otherTeam.name}`, status: 'pending_approval', escalated: false },
        comment: { by: self.id, text: `On hold — waiting for ${otherTeam.manager.name} to share the required inputs.` },
      }
      : { title: `${w[4]} — November 2026`, status: 'todo', progress: 0, weight: 15, start: utc(2026, 10, 9), due: utc(2026, 10, 27) },
    { title: `${w[5]} — December 2026`, status: 'todo', progress: 0, weight: 20, start: utc(2026, 11, 1), due: utc(2026, 11, 15) },
  ];
  // The new joiner's overdue task is the onboarding one, so it reads sensibly.
  if (p.newJoiner) tasks[3].title = 'Complete IT onboarding checklist (overdue)';
  await createGoal(ctx, p, owner, {
    title: `${q3.label}: ${q3.goal}`, description: `${q3.goal} for the current quarter (Oct–Dec 2026).`,
    status: 'ACTIVE', assignmentStatus: 'IN_PROGRESS', progress: 30, fy: q3.fy, quarter: 'Q3',
    start: utc(2026, 9, 1), end: utc(2026, 11, 31), tasks,
  }, counts);

  if (p.special) {
    const g = specialGoal(ctx, p, owner, self);
    await createGoal(ctx, p, g.owner || owner, g, counts);
  }

  // A standalone (no-goal) task for every manager: shows outside the weight rules.
  if (p.isManager) {
    const title = 'Weekly team review meeting — November 2026';
    if (!(await prisma.task.findFirst({ where: { tenantId: ctx.tenant.id, employeeId: self.id, title } }))) {
      await prisma.task.create({
        data: {
          tenantId: ctx.tenant.id, employeeId: self.id, title, description: 'Standalone task (not under any goal).', priority: 'low',
          status: 'in_progress', progress: 25, weight: 1, startDate: utc(2026, 10, 2), dueDate: utc(2026, 10, 30),
          actualStartDate: utc(2026, 10, 2), financialYear: 'FY 2026-27', tags: SEED_TAG, isStandalone: true,
        },
      });
      counts.tasks += 1;
    }
  }
}

function specialGoal(ctx, p, owner, self) {
  const base = { fy: 'FY 2026-27', quarter: 'Q3', start: utc(2026, 10, 1), end: utc(2026, 11, 31) };
  const todo = (title, weight, due) => ({ title, status: 'todo', progress: 0, weight, start: utc(2026, 10, 2), due });
  switch (p.special) {
    case 'DRAFT':
      return {
        ...base, title: 'Site safety certification (draft)', description: 'Self-created draft. Tasks total only 70% — work stays locked until they total 100%.',
        status: 'DRAFT', assignmentStatus: 'DRAFT', approvalMode: null, progress: 0, priority: 'medium', createdById: self.id, createdBy: self.name,
        tasks: [todo('Collect safety training certificates', 40, utc(2026, 10, 20)), todo('Schedule third-party safety audit', 30, utc(2026, 11, 10))],
      };
    case 'PENDING_APPROVAL':
      return {
        ...base, title: 'Instagram lead generation campaign', description: 'Proposed by the employee; waiting for the manager to approve.',
        status: 'PENDING_APPROVAL', assignmentStatus: 'ASSIGNED', progress: 0, priority: 'medium', createdById: self.id, createdBy: self.name,
        tasks: [todo('Plan reels calendar', 30, utc(2026, 10, 15)), todo('Run paid campaign', 40, utc(2026, 11, 5)), todo('Report leads & cost per lead', 30, utc(2026, 11, 20))],
      };
    case 'READY_FOR_APPROVAL':
      return {
        ...base, title: 'Diwali possession handover drive', start: utc(2026, 9, 1), end: utc(2026, 9, 31),
        description: 'All tasks are done and submitted. The goal completes once the manager approves every task; then rate the goal.',
        status: 'ACTIVE', assignmentStatus: 'IN_PROGRESS', progress: 100,
        tasks: [
          ['Prepare handover kits for 40 units', 30, 10], ['Schedule possession appointments', 30, 18], ['Collect handover feedback forms', 40, 27],
        ].map(([title, weight, day]) => ({
          title, status: 'done', progress: 100, weight, start: utc(2026, 9, 1), due: utc(2026, 9, day), actualStart: utc(2026, 9, 1),
          doneAt: utc(2026, 9, day - 1), reviewStatus: 'SUBMITTED', reviewSubmittedAt: utc(2026, 9, day - 1),
        })),
      };
    case 'CHANGES_REQUESTED':
      return {
        ...base, title: 'RERA document digitisation', description: 'Sent back by the manager for changes.',
        status: 'CHANGES_REQUESTED', assignmentStatus: 'ASSIGNED', progress: 0, priority: 'medium', createdById: self.id, createdBy: self.name,
        goalComment: 'Please split the scanning task by project and add separate due dates for each phase, then resubmit.',
        tasks: [todo('Scan all RERA documents', 50, utc(2026, 10, 25)), todo('Upload to document management system', 50, utc(2026, 11, 15))],
      };
    case 'CROSS_TEAM': {
      const it = byLocal['ashish.joshi'];
      const itOwner = { id: ctx.ids[it.local], name: it.name, email: it.email };
      // Owned by the IT manager, not the reporting manager — tests cross-team goal owners.
      return {
        ...base, owner: itOwner, title: 'ERP purchase module rollout (cross-team, owner: IT)', start: utc(2026, 9, 1), end: utc(2026, 10, 30),
        description: `Goal owned by ${it.name} (IT & Systems), not by the reporting manager ${owner.name}.`,
        status: 'ACTIVE', assignmentStatus: 'IN_PROGRESS', progress: 45, createdById: itOwner.id, createdBy: itOwner.name,
        tasks: [
          { title: 'Map purchase workflow in ERP', status: 'done', progress: 100, weight: 30, start: utc(2026, 9, 1), due: utc(2026, 9, 15), actualStart: utc(2026, 9, 1), doneAt: utc(2026, 9, 14), reviewStatus: 'APPROVED' },
          { title: 'User acceptance testing of PO module', status: 'in_progress', progress: 50, weight: 40, start: utc(2026, 9, 16), due: utc(2026, 10, 12), actualStart: utc(2026, 9, 17) },
          todo('Train purchase team on ERP', 30, utc(2026, 10, 28)),
        ],
      };
    }
    case 'FUTURE':
      return {
        ...base, quarter: 'Q4', title: 'Jan–Mar 2027: Mobile app for customer portal', start: utc(2027, 0, 1), end: utc(2027, 2, 31),
        description: 'Next quarter goal — approved, not started.', status: 'ACTIVE', assignmentStatus: 'ASSIGNED', progress: 0,
        tasks: [
          { title: 'App wireframes & API design', status: 'todo', progress: 0, weight: 50, start: utc(2027, 0, 4), due: utc(2027, 1, 5) },
          { title: 'App build & store release', status: 'todo', progress: 0, weight: 50, start: utc(2027, 1, 8), due: utc(2027, 2, 25) },
        ],
      };
    default:
      throw new Error(`Unknown special goal ${p.special}`);
  }
}

// ── Appraisals ──────────────────────────────────────────────────────────────
async function cycleFor(ctx, period, hrId) {
  let cycle = await prisma.appraisalCycle.findFirst({ where: { tenantId: ctx.tenant.id, frequency: period.frequency, name: period.name } });
  if (!cycle) {
    cycle = await prisma.appraisalCycle.create({
      data: {
        tenantId: ctx.tenant.id, name: period.name, frequency: period.frequency, year: period.year, month: period.month,
        monthNumber: period.monthNumber, createdById: hrId, startDate: period.startDate, endDate: period.endDate, status: 'ACTIVE',
      },
    });
    await prisma.appraisalParameter.createMany({ data: PARAMETERS.map((name, i) => ({ tenantId: ctx.tenant.id, cycleId: cycle.id, name, order: i + 1, isActive: true })) });
  }
  return cycle;
}

async function seedAppraisals(ctx) {
  const settings = await prisma.tenantSettings.findFirst({ where: { tenantId: ctx.tenant.id } });
  const hr = ctx.user('neha.sharma');
  const periodic = [];
  for (const fyStart of [2025, 2026]) {
    for (let i = 0; i < 12; i += 1) {
      const mi = (3 + i) % 12;
      const year = fyStart + (3 + i >= 12 ? 1 : 0);
      if (!isQuarterEndMonth(mi + 1, settings)) periodic.push(getPeriodMetadata('MONTHLY', new Date(), null, year, mi + 1, settings));
      if (isQuarterEndMonth(mi + 1, settings)) periodic.push(getPeriodMetadata('QUARTERLY', new Date(), null, fyStart, `Q${Math.floor(i / 3) + 1}`, settings));
    }
  }
  const now = new Date();
  const opened = periodic.filter((p) => new Date(p.endDate) < now);

  let written = 0;
  for (const period of opened) {
    const cycle = await cycleFor(ctx, period, hr.id);
    const fy26 = period.fiscalYearStartYear === 2025;
    const eligible = workers.filter((p) => {
      if (p.newJoiner && new Date(period.endDate) < NEW_JOINER_DATE) return false;
      if (fy26) return true;
      return PERIODIC_PLANS[p.team.periodic].submitted.includes(period.name);
    });
    if (!eligible.length) continue;
    const metrics = await getTeamTableMetricsBulk(ctx.tenant.id, eligible.map((p) => ctx.ids[p.local]), cycle);
    for (const p of eligible) {
      const employeeId = ctx.ids[p.local];
      if (await prisma.performanceReview.findFirst({ where: { cycleId: cycle.id, employeeId } })) continue;
      const m = metrics.get(employeeId);
      const base = m?.managerRating ?? BASE[p.profile];
      const selfRating = clamp(halfStep(base + (p.profile === 'late' ? 0.5 : 0)));
      const tone = base >= 4.3 ? 'high' : base >= 3.3 ? 'mid' : 'low';
      const submittedAt = addDays(new Date(period.endDate), 3);
      const locked = fy26
        ? !(FY26_AWAITING_HR[p.team.key] || []).includes(period.name)
        : PERIODIC_PLANS[p.team.periodic].locked.includes(period.name);
      const lockedAt = addDays(submittedAt, 6);
      await prisma.performanceReview.create({
        data: {
          cycleId: cycle.id, employeeId, reviewType: period.frequency, dueDate: period.endDate,
          status: locked ? 'COMPLETED' : 'SUBMITTED', selfRating, selfAccomplishments: `${period.name}: ${ACHIEVEMENTS[tone]}`, selfSubmittedAt: submittedAt,
          managerTaskRatingSnapshot: m ? { ...m, snapshotAt: submittedAt.toISOString() } : undefined,
          workScore: m?.finalWeight ?? null, averageManagerRating: m?.managerRating ?? null,
          ...(locked && {
            hrRemarks: tone === 'high' ? 'Outstanding period. Keep it up.' : tone === 'mid' ? 'Solid, consistent performance.' : 'Focus on on-time delivery next period.',
            hrSignoffStatus: 'FINALISED', hrSignedOffById: hr.id, hrSignedOffAt: lockedAt, finalisedAt: lockedAt, finalisedById: hr.id,
          }),
        },
      });
      written += 1;
    }
  }
  console.log(`Monthly/quarterly appraisals written: ${written}`);

  // ANNUAL FY 2025-26 — a different stage per team.
  const period = getPeriodMetadata('ANNUAL', new Date(), null, 2025, null, settings);
  const cycle = await cycleFor(ctx, period, hr.id);
  const params = await prisma.appraisalParameter.findMany({ where: { cycleId: cycle.id }, orderBy: { order: 'asc' } });
  const annualPeople = workers.filter((p) => !p.newJoiner && annualStageOf(p) !== 'NONE');
  const metrics = await getTeamTableMetricsBulk(ctx.tenant.id, annualPeople.map((p) => ctx.ids[p.local]), cycle);
  let annual = 0;
  for (const p of annualPeople) {
    const stage = annualStageOf(p);
    const employeeId = ctx.ids[p.local];
    if (await prisma.performanceReview.findFirst({ where: { cycleId: cycle.id, employeeId } })) continue;
    const goals = await prisma.goal.findMany({ where: { tenantId: ctx.tenant.id, employeeId, financialYear: 'FY 2025-26', managerRating: { not: null } }, select: { title: true, managerRating: true } });
    const avg = goals.length ? mean(goals.map((g) => g.managerRating)) : BASE[p.profile];
    const nudge = [0, 0.5, p.profile === 'late' ? -0.5 : 0, 0, 0.5];
    const self = params.map((_, i) => clamp(halfStep(avg + nudge[i] + (p.profile === 'late' ? 0.5 : 0))));
    const mgr = params.map((_, i) => clamp(halfStep(avg + (i === 2 && p.profile === 'late' ? -0.5 : 0))));
    const hrs = mgr.map((s, i) => (i === 3 ? clamp(s + 0.5) : s));
    const selfRating = Number(mean(self).toFixed(2));
    const managerRating = Number(mean(mgr).toFixed(2));
    const hrRating = Number(mean(hrs).toFixed(2));
    const hike = hrRating >= 4.5 ? 15 : hrRating >= 4 ? 12 : hrRating >= 3.5 ? 9 : 6;
    const submitted = stage !== 'DRAFT';
    const managerDone = ['MANAGER_REVIEWED', 'SHARED', 'FINALISED'].includes(stage);
    const hrDone = ['SHARED', 'FINALISED'].includes(stage);
    const m = metrics.get(employeeId);
    const review = await prisma.performanceReview.create({
      data: {
        cycleId: cycle.id, employeeId, reviewType: 'ANNUAL', dueDate: cycle.endDate,
        status: hrDone ? 'COMPLETED' : managerDone ? 'MANAGER_REVIEWED' : submitted ? 'SUBMITTED' : 'DRAFT',
        selfAccomplishments: [`FY 2025-26 summary — ${goals.length} quarterly goals completed:`, ...goals.map((g) => `• ${g.title} (goal owner rating ${g.managerRating})`)].join('\n'),
        selfWeaknesses: WEAKNESSES[p.profile], selfRating, ...(submitted && { selfSubmittedAt: utc(2026, 3, 10) }),
        ...(managerDone && {
          managerRating, managerSubmittedAt: utc(2026, 3, 20),
          managerRemarks: managerRating >= 4.5 ? 'Top performer of the team this year.' : managerRating >= 3.5 ? 'Reliable, met the year\'s goals.' : 'Delivered, but punctuality needs to improve.',
        }),
        ...(hrDone && {
          hrRating, hikePercentage: hike, hrRemarks: `Annual review audited. Hike ${hike}% effective 1 May 2026.`,
          hrSignoffStatus: stage, hrSignedOffById: hr.id, hrSignedOffAt: utc(2026, 3, 28),
          resultsSharedAt: utc(2026, 3, 28), resultsSharedById: hr.id,
          workScore: m?.finalWeight ?? null, averageManagerRating: m?.managerRating ?? null,
          ...(stage === 'FINALISED' && { finalisedAt: utc(2026, 4, 5), finalisedById: hr.id }),
        }),
      },
    });
    for (const [i, param] of params.entries()) {
      await prisma.reviewScore.create({
        data: { reviewId: review.id, parameterId: param.id, selfScore: self[i], ...(managerDone && { managerScore: mgr[i] }), ...(hrDone && { hrScore: hrs[i] }) },
      });
    }
    annual += 1;
  }
  console.log(`Annual FY 2025-26 appraisals written: ${annual}`);
}

// ── Leave ───────────────────────────────────────────────────────────────────
async function seedLeaves(ctx) {
  const { tenant, ids } = ctx;
  const types = {};
  for (const lt of LEAVE_TYPES) {
    types[lt.code] = await prisma.leaveType.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: lt.code } },
      update: {},
      create: { tenantId: tenant.id, ...lt, allocationType: 'ANNUAL', year: 2026, isPaid: true, requiresApproval: true, allowHalfDay: true, isActive: true, createdById: ids['neha.sharma'] },
    });
  }
  await prisma.wfhPolicy.upsert({ where: { tenantId: tenant.id }, update: {}, create: { tenantId: tenant.id, isEnabled: true, annualDays: 15, requiresApproval: true, maxConsecutiveDays: 5 } });

  const hrId = ids['neha.sharma'];
  let created = 0;
  for (const l of LEAVES) {
    const p = byLocal[l.who];
    const employeeId = ids[l.who];
    if (await prisma.leaveRequest.findFirst({ where: { employeeId, startDate: l.from, requestType: l.wfh ? 'WFH' : 'LEAVE' } })) continue;
    const managerId = ids[p.reportsTo];
    const actedAt = addDays(l.from, -5);
    const s = l.state;
    const mgrApproved = ['APPROVED', 'PENDING_HR', 'REJECTED_HR'].includes(s);
    await prisma.leaveRequest.create({
      data: {
        tenantId: tenant.id, employeeId, leaveTypeId: l.wfh ? null : types[l.code].id, type: l.wfh ? 'WFH' : types[l.code].name,
        requestType: l.wfh ? 'WFH' : 'LEAVE', startDate: l.from, endDate: l.to, totalDays: l.days, dayType: l.dayType || 'FULL', reason: l.reason,
        status: s === 'APPROVED' ? 'APPROVED' : s.startsWith('REJECTED') ? 'REJECTED' : s === 'CANCELLED' ? 'CANCELLED' : 'PENDING',
        managerId, managerStatus: mgrApproved ? 'Approved' : s === 'REJECTED_MANAGER' ? 'Rejected' : 'Pending',
        managerActedAt: mgrApproved || s === 'REJECTED_MANAGER' ? actedAt : null,
        managerComment: s === 'REJECTED_MANAGER' ? l.comment : mgrApproved ? 'Approved.' : null,
        hrId: s === 'APPROVED' || s === 'REJECTED_HR' ? hrId : null,
        hrStatus: s === 'APPROVED' ? 'Approved' : s === 'REJECTED_HR' ? 'Rejected' : s === 'REJECTED_MANAGER' ? 'Not Required' : 'Pending',
        hrActedAt: s === 'APPROVED' || s === 'REJECTED_HR' ? addDays(actedAt, 1) : null,
        hrComment: s === 'REJECTED_HR' ? l.comment : null,
        ...(s === 'APPROVED' && { approvedById: hrId }),
        ...(s.startsWith('REJECTED') && { rejectedById: s === 'REJECTED_HR' ? hrId : managerId, rejectedAt: actedAt, rejectionReason: l.comment }),
        ...(s === 'CANCELLED' && { cancelledById: employeeId, cancelledAt: addDays(l.from, -3) }),
        createdAt: addDays(l.from, -7),
      },
    });
    created += 1;
  }

  // 2026 balances for everyone, consistent with the requests above.
  for (const p of PEOPLE) {
    const mine = LEAVES.filter((l) => l.who === p.local);
    const sum = (pred) => mine.filter(pred).reduce((a, l) => a + l.days, 0);
    const isPending = (l) => ['PENDING_MANAGER', 'PENDING_HR'].includes(l.state);
    for (const lt of LEAVE_TYPES) {
      const used = sum((l) => !l.wfh && l.code === lt.code && l.state === 'APPROVED');
      const pending = sum((l) => !l.wfh && l.code === lt.code && isPending(l));
      await prisma.leaveBalance.upsert({
        where: { tenantId_employeeId_leaveTypeId_year: { tenantId: tenant.id, employeeId: ids[p.local], leaveTypeId: types[lt.code].id, year: 2026 } },
        update: {},
        create: { tenantId: tenant.id, employeeId: ids[p.local], leaveTypeId: types[lt.code].id, year: 2026, allocated: lt.defaultDays, used, pending },
      });
    }
    await prisma.wfhBalance.upsert({
      where: { tenantId_employeeId_year: { tenantId: tenant.id, employeeId: ids[p.local], year: 2026 } },
      update: {},
      create: { tenantId: tenant.id, employeeId: ids[p.local], year: 2026, allocated: 15, used: sum((l) => l.wfh && l.state === 'APPROVED'), pending: sum((l) => l.wfh && isPending(l)) },
    });
  }
  console.log(`Leave requests written: ${created}; balances for ${PEOPLE.length} people`);
}

// ── Report (feeds the Excel sheet) ──────────────────────────────────────────
async function writeReport(file) {
  const tenant = await prisma.tenant.findFirst({ where: { domainName: DOMAIN } });
  if (!tenant) throw new Error(`Tenant ${DOMAIN} not found — run with --apply first`);
  const users = await prisma.tenantUser.findMany({
    where: { tenantId: tenant.id, isDeleted: false }, orderBy: { employeeId: 'asc' },
    select: { id: true, employeeId: true, name: true, email: true, role: true, designation: true, department: true, joinDate: true, manager: { select: { name: true } }, capabilities: { select: { capability: true } } },
  });
  const goals = await prisma.goal.findMany({
    where: { tenantId: tenant.id }, orderBy: [{ employeeId: 'asc' }, { startDate: 'asc' }],
    select: { id: true, title: true, status: true, financialYear: true, quarter: true, startDate: true, dueDate: true, progress: true, managerRating: true, employeeId: true, ownerManager: { select: { name: true } }, _count: { select: { tasks: true } } },
  });
  const tasks = await prisma.task.findMany({
    where: { tenantId: tenant.id }, orderBy: [{ employeeId: 'asc' }, { dueDate: 'asc' }],
    select: { title: true, status: true, priority: true, weight: true, progress: true, startDate: true, dueDate: true, actualCompletionDate: true, managerRating: true, managerFinalWeight: true, weightAdjustReason: true, reviewStatus: true, onHoldReason: true, isMilestoneTracked: true, isStandalone: true, financialYear: true, employeeId: true, goal: { select: { title: true } }, _count: { select: { milestones: true } } },
  });
  const reviews = await prisma.performanceReview.findMany({
    where: { cycle: { tenantId: tenant.id } },
    select: { employeeId: true, reviewType: true, status: true, hrSignoffStatus: true, selfRating: true, managerRating: true, hrRating: true, hikePercentage: true, selfSubmittedAt: true, cycle: { select: { name: true, startDate: true, endDate: true } } },
  });
  const leaves = await prisma.leaveRequest.findMany({
    where: { tenantId: tenant.id }, orderBy: { startDate: 'asc' },
    select: { employeeId: true, type: true, requestType: true, startDate: true, endDate: true, totalDays: true, dayType: true, status: true, managerStatus: true, hrStatus: true, reason: true, managerComment: true, hrComment: true },
  });
  const plan = workers.map((p) => ({
    email: p.email, team: p.team.name, teamKey: p.team.key, isManager: Boolean(p.isManager), profile: p.profile,
    annualStage: p.newJoiner ? 'NOT_ELIGIBLE' : annualStageOf(p), periodicPlan: p.team.periodic, newJoiner: Boolean(p.newJoiner),
    overdue: Boolean(p.overdue), hold: Boolean(p.hold), milestone: Boolean(p.milestone), special: p.special || null,
    reviewer: ownerOf(p).name,
  }));
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date(), company: COMPANY_NAME, domain: DOMAIN, tenantCode: TENANT_CODE, password: PASSWORD, users, goals, tasks, reviews, leaves, plan, teams: TEAMS.map((t) => ({ key: t.key, name: t.name, manager: t.manager.name, annual: t.annual, managerAnnual: t.managerAnnual, periodic: t.periodic })) }, null, 2));
  console.log(`Report written to ${file}: ${users.length} users, ${goals.length} goals, ${tasks.length} tasks, ${reviews.length} appraisals, ${leaves.length} leave requests`);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
async function cleanup() {
  const tenant = await prisma.tenant.findFirst({ where: { domainName: DOMAIN } });
  if (!tenant) return console.log('Nothing to remove.');
  const users = await prisma.tenantUser.findMany({ where: { tenantId: tenant.id }, select: { id: true } });
  const ids = users.map((u) => u.id);
  console.log(`Would remove tenant ${tenant.companyName} with ${ids.length} users and all their goals, tasks, appraisals and leave.`);
  if (!APPLY) return console.log('Dry run — re-run with --cleanup --apply to delete.');
  const t = { tenantId: tenant.id };
  await prisma.taskComment.deleteMany({ where: { task: t } });
  await prisma.taskAuditLog.deleteMany({ where: { task: t } });
  await prisma.goalComment.deleteMany({ where: { goal: t } });
  await prisma.goalAuditLog.deleteMany({ where: { goal: t } });
  await prisma.taskMilestone.deleteMany({ where: t });
  await prisma.task.deleteMany({ where: t });
  await prisma.goalAssignment.deleteMany({ where: t });
  await prisma.goal.deleteMany({ where: t });
  await prisma.reviewScore.deleteMany({ where: { review: { cycle: t } } });
  await prisma.performanceReview.deleteMany({ where: { cycle: t } });
  await prisma.appraisalCycle.deleteMany({ where: t });
  await prisma.leaveRequest.deleteMany({ where: t });
  await prisma.leaveBalance.deleteMany({ where: t });
  await prisma.wfhBalance.deleteMany({ where: t });
  await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } }).catch(() => {});
  await prisma.tenantUser.updateMany({ where: t, data: { managerId: null } });
  await prisma.tenant.delete({ where: { id: tenant.id } });
  if (tenant.registrationId) await prisma.companyRegistration.delete({ where: { id: tenant.registrationId } }).catch(() => {});
  console.log('Removed.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
