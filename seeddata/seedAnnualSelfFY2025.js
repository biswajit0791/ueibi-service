/**
 * @file seedAnnualSelfFY2025.js
 * @description Submits the FY 2025-26 ANNUAL self-assessment on behalf of the
 * appraisal test team (seedAppraisalTestTeam.js + seedAnnualTestFY2025.js),
 * so the annual flow can be tested from the manager's end and then HR's:
 *
 *   employees → submitted here (status SUBMITTED)
 *   Ritesh Panda reviews his 5 team members; Arindam (CMD) reviews Ritesh
 *   HR audits, sets the hike, shares and finalises
 *
 * Creates the "FY 2025-26" annual cycle (with the company's parameters) if it
 * does not exist. Each person gets a half-step self score per parameter based
 * on their goal ratings for the year, plus accomplishments and training needs.
 * Reviews already past DRAFT are left untouched.
 *
 *   node seeddata/seedAnnualSelfFY2025.js           # show the plan
 *   node seeddata/seedAnnualSelfFY2025.js --apply   # write it
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { getPeriodMetadata } from '../src/lib/appraisalPeriods.js';

const DOMAIN = 'cityexpertcare.com';
const APPLY = process.argv.includes('--apply');
const FY_START_YEAR = 2025;
const SUBMITTED_AT = new Date(Date.UTC(2026, 3, 10, 6, 0, 0)); // 10 Apr 2026
const DEFAULT_PARAMETERS = ['Technical Skills', 'Conduct & Ethics', 'Punctuality & Attendance', 'Communication', 'Teamwork & Collaboration'];

// Per-parameter nudge from the person's yearly average (same order as the parameters).
const PEOPLE = [
  { email: 'ritesh.panda', nudge: [0, 0.5, 0, 0, 0.5], weak: 'Delegate more of the escalation handling so the team grows; complete the people-management course.' },
  { email: 'ipsita.rath', nudge: [0.5, 0, 0, 0, 0], weak: 'Would like formal training in data analysis to build better CSAT reports.' },
  { email: 'bikash.swain', nudge: [0, 0, 0.5, -0.5, 0], weak: 'Improve written communication with enterprise customers.' },
  { email: 'lipika.nanda', nudge: [-0.5, 0, 0, 0.5, 0], weak: 'Keep performance consistent month to month; plan workload earlier.' },
  { email: 'subham.behera', nudge: [0, 0, -0.5, 0, 0.5], weak: 'On-time delivery — several tasks slipped by a few days. Time-management training requested.' },
  { email: 'tanmay.mishra', nudge: [0, 0.5, -0.5, 0, 0], weak: 'Was out for most of August; need to catch up on the new ticketing tool.' },
];

const clamp = (r) => Math.min(5, Math.max(1, r));
const halfStep = (r) => Math.round(r * 2) / 2;

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { domainName: DOMAIN }, select: { id: true, companyName: true } });
  if (!tenant) throw new Error(`Tenant ${DOMAIN} not found`);
  const settings = await prisma.tenantSettings.findFirst({ where: { tenantId: tenant.id } });
  const period = getPeriodMetadata('ANNUAL', new Date(), null, FY_START_YEAR, null, settings);

  const people = [];
  for (const p of PEOPLE) {
    const user = await prisma.tenantUser.findFirst({
      where: { tenantId: tenant.id, email: `${p.email}@${DOMAIN}`, isDeleted: false },
      select: { id: true, name: true, manager: { select: { name: true } } },
    });
    if (!user) throw new Error(`${p.email}@${DOMAIN} not found — run the earlier seed scripts first`);
    const goals = await prisma.goal.findMany({
      where: { tenantId: tenant.id, employeeId: user.id, financialYear: 'FY 2025-26', managerRating: { not: null } },
      select: { title: true, managerRating: true },
    });
    const avg = goals.length ? goals.reduce((s, g) => s + g.managerRating, 0) / goals.length : 3.5;
    people.push({ ...p, user, goals, avg });
  }

  console.log(`Tenant: ${tenant.companyName}  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}  cycle: ${period.name} (${period.startDate.toISOString().slice(0, 10)} – ${period.endDate.toISOString().slice(0, 10)})`);
  people.forEach((p) => console.log(`  ${p.user.name.padEnd(15)} goals rated ${p.goals.length}, year avg ${p.avg.toFixed(2)} → reviewed by ${p.user.manager?.name || '—'}`));
  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  let cycle = await prisma.appraisalCycle.findFirst({ where: { tenantId: tenant.id, frequency: 'ANNUAL', name: period.name } });
  if (!cycle) {
    cycle = await prisma.appraisalCycle.create({
      data: {
        tenantId: tenant.id, name: period.name, frequency: 'ANNUAL', year: period.year, month: period.month,
        monthNumber: null, startDate: period.startDate, endDate: period.endDate, status: 'ACTIVE',
      },
    });
    const existing = await prisma.appraisalParameter.findMany({ where: { tenantId: tenant.id }, distinct: ['name'], orderBy: { order: 'asc' } });
    const seed = existing.length ? existing.map((p) => ({ name: p.name, order: p.order, isActive: p.isActive })) : DEFAULT_PARAMETERS.map((name, i) => ({ name, order: i + 1, isActive: true }));
    await prisma.appraisalParameter.createMany({ data: seed.map((p) => ({ tenantId: tenant.id, cycleId: cycle.id, ...p })) });
    console.log(`Created cycle ${cycle.name}`);
  }
  const params = await prisma.appraisalParameter.findMany({ where: { cycleId: cycle.id, isActive: true }, orderBy: { order: 'asc' } });

  for (const p of people) {
    const existing = await prisma.performanceReview.findFirst({ where: { cycleId: cycle.id, employeeId: p.user.id } });
    if (existing && existing.status !== 'DRAFT') {
      console.log(`  ${p.user.name}: already ${existing.status} — left untouched`);
      continue;
    }
    const scores = params.map((param, i) => ({ parameterId: param.id, selfScore: clamp(halfStep(p.avg + (p.nudge[i] || 0))) }));
    const selfRating = Number((scores.reduce((s, x) => s + x.selfScore, 0) / scores.length).toFixed(2));
    const accomplishments = [
      `FY 2025-26 summary — ${p.goals.length} quarterly goals completed:`,
      ...p.goals.map((g) => `• ${g.title} (goal owner rating ${g.managerRating})`),
      'Kept customer SLAs throughout the year and contributed to the cross-team automation and product feedback programmes.',
    ].join('\n');

    const data = {
      reviewType: 'ANNUAL', dueDate: cycle.endDate, status: 'SUBMITTED',
      selfAccomplishments: accomplishments, selfWeaknesses: p.weak, selfRating, selfSubmittedAt: SUBMITTED_AT,
    };
    const review = existing
      ? await prisma.performanceReview.update({ where: { id: existing.id }, data })
      : await prisma.performanceReview.create({ data: { cycleId: cycle.id, employeeId: p.user.id, ...data } });
    for (const s of scores) {
      await prisma.reviewScore.upsert({
        where: { reviewId_parameterId: { reviewId: review.id, parameterId: s.parameterId } },
        create: { reviewId: review.id, parameterId: s.parameterId, selfScore: s.selfScore },
        update: { selfScore: s.selfScore },
      });
    }
    console.log(`  ${p.user.name}: submitted (self rating ${selfRating}; scores ${scores.map((s) => s.selfScore).join(', ')})`);
  }
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
