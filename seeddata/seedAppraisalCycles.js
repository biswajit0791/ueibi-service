/**
 * @file seedAppraisalCycles.js
 * @description Safe, idempotent, enterprise-grade seed script for Appraisal Cycles,
 * Performance Reviews, 360 Peer Feedback, and Scoring Parameters for years 2024 and 2025.
 *
 * Populates:
 * 1. Annual Cycles: FY 2024-2025 and FY 2025-2026
 * 2. Quarterly Cycles: Q1-Q4 for 2024 and Q1-Q4 for 2025
 * 3. Monthly Cycles: All 12 months for 2024 and all 12 months for 2025
 * 4. 5 Standard Appraisal Parameters for every cycle
 * 5. Full Performance Reviews with realistic accomplishments, weaknesses, manager feedback,
 *    merit hikes, and HR sign-offs across all active tenant employees
 * 6. 360 Peer Nominations and Peer Feedback
 *
 * Usage:
 *   node seeddata/seedAppraisalCycles.js
 *   node seeddata/seedAppraisalCycles.js --tenant=usifdn
 *   node seeddata/seedAppraisalCycles.js --all
 *   node seeddata/seedAppraisalCycles.js --dry-run
 */

import { PrismaClient } from '@prisma/client';
import {
  MONTH_NAMES,
  DEFAULT_PARAMETERS,
  DEPARTMENT_APPRAISAL_CONTENT,
} from './appraisalTemplates.js';

const prisma = new PrismaClient();

// Parse CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const seedAllTenants = args.includes('--all');
const tenantArg = args.find((a) => a.startsWith('--tenant='));
const targetTenantQuery = tenantArg ? tenantArg.split('=')[1] : 'usifdn';

/**
 * Generate cycle definitions for past years (2024 and 2025)
 */
function buildPastCycles() {
  const cycles = [];

  for (const year of [2024, 2025]) {
    // 1. Annual Cycle (Fiscal year April 1 of year to March 31 of year + 1)
    const nextYear = year + 1;
    cycles.push({
      name: `FY ${year}-${nextYear}`,
      frequency: 'ANNUAL',
      year,
      month: 'Annual',
      monthNumber: null,
      startDate: new Date(Date.UTC(year, 3, 1, 0, 0, 0)),
      endDate: new Date(Date.UTC(nextYear, 2, 31, 23, 59, 59)),
      status: 'CLOSED',
      seedReviews: true,
      reviewType: 'ANNUAL',
      seedPeer360: true,
    });

    // 2. Quarterly Cycles (Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec)
    for (let q = 1; q <= 4; q++) {
      const qStartMonth = (q - 1) * 3;
      cycles.push({
        name: `Q${q} ${year}`,
        frequency: 'QUARTERLY',
        year,
        month: `Q${q}`,
        monthNumber: q,
        startDate: new Date(Date.UTC(year, qStartMonth, 1, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, qStartMonth + 3, 0, 23, 59, 59)),
        status: 'CLOSED',
        // Seed full reviews for representative quarters
        seedReviews: q === 2 || q === 4,
        reviewType: 'QUARTERLY',
        seedPeer360: false,
      });
    }

    // 3. Monthly Cycles (All 12 months)
    for (let m = 0; m < 12; m++) {
      const monthName = MONTH_NAMES[m];
      cycles.push({
        name: `${monthName} ${year}`,
        frequency: 'MONTHLY',
        year,
        month: monthName,
        monthNumber: m + 1,
        startDate: new Date(Date.UTC(year, m, 1, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, m + 1, 0, 23, 59, 59)),
        status: 'CLOSED',
        // Seed reviews for key quarterly months (March, June, September, December)
        seedReviews: m === 2 || m === 5 || m === 8 || m === 11,
        reviewType: 'MONTHLY',
        seedPeer360: false,
      });
    }
  }

  return cycles;
}

async function ensureParameters(tenantId, cycleId) {
  const existing = await prisma.appraisalParameter.findMany({
    where: { cycleId },
    orderBy: { order: 'asc' },
  });
  if (existing.length > 0) return existing;

  if (!isDryRun) {
    await prisma.appraisalParameter.createMany({
      data: DEFAULT_PARAMETERS.map((p) => ({
        tenantId,
        cycleId,
        name: p.name,
        order: p.order,
        isActive: true,
      })),
    });
    return prisma.appraisalParameter.findMany({
      where: { cycleId },
      orderBy: { order: 'asc' },
    });
  }

  return DEFAULT_PARAMETERS.map((p, idx) => ({
    id: `dry-param-${cycleId}-${idx}`,
    tenantId,
    cycleId,
    name: p.name,
    order: p.order,
    isActive: true,
  }));
}

async function main() {
  console.log('\n================================================================');
  console.log('🚀 ENTERPRISE APPRAISAL CYCLE & REVIEW SEED RUNNER (2024 & 2025)');
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
    cyclesCreated: 0,
    cyclesExisting: 0,
    parametersCreated: 0,
    reviewsCreated: 0,
    reviewsExisting: 0,
    peerNominationsCreated: 0,
    byFrequency: {
      ANNUAL: 0,
      QUARTERLY: 0,
      MONTHLY: 0,
    },
    byStatus: {
      COMPLETED: 0,
      MANAGER_REVIEWED: 0,
      SUBMITTED: 0,
      DRAFT: 0,
    },
    byYear: {
      2024: 0,
      2025: 0,
    },
  };

  const pastCycles = buildPastCycles();

  for (const tenant of tenants) {
    console.log(`\n🏢 Processing Tenant: "${tenant.companyName}" (${tenant.domainName}) [ID: ${tenant.id}]`);
    console.log('----------------------------------------------------------------');

    // Fetch active users
    const users = await prisma.tenantUser.findMany({
      where: { tenantId: tenant.id, isDeleted: false },
      include: { manager: true },
      orderBy: { createdAt: 'asc' },
    });

    if (users.length === 0) {
      console.log('  ⚠️  No active users found in this tenant. Skipping.');
      continue;
    }

    grandSummary.usersProcessed += users.length;
    console.log(`  👥 Found ${users.length} active users.`);

    // Find default HR and Manager
    const hrOrAdmin = users.find((u) => ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(u.role)) || users[0];
    const defaultManager = users.find((u) => u.role === 'MANAGER') || hrOrAdmin;

    for (const cDef of pastCycles) {
      // Safe Idempotent Check: does cycle already exist?
      let cycle = await prisma.appraisalCycle.findFirst({
        where: {
          tenantId: tenant.id,
          frequency: cDef.frequency,
          name: cDef.name,
        },
      });

      if (cycle) {
        grandSummary.cyclesExisting++;
      } else {
        if (!isDryRun) {
          cycle = await prisma.appraisalCycle.create({
            data: {
              tenantId: tenant.id,
              name: cDef.name,
              frequency: cDef.frequency,
              year: cDef.year,
              month: cDef.month,
              monthNumber: cDef.monthNumber,
              createdById: hrOrAdmin.id,
              startDate: cDef.startDate,
              endDate: cDef.endDate,
              status: cDef.status,
            },
          });
        } else {
          cycle = {
            id: `dry-cycle-${tenant.id}-${cDef.name}`,
            ...cDef,
          };
        }
        grandSummary.cyclesCreated++;
        grandSummary.byFrequency[cDef.frequency]++;
        console.log(`  📅 [${cDef.frequency}] Created Cycle: "${cDef.name}" (${cDef.year})`);
      }

      // Ensure parameters for this cycle
      const params = await ensureParameters(tenant.id, cycle.id);
      grandSummary.parametersCreated += params.length;

      // Seed reviews if enabled for this cycle
      if (cDef.seedReviews) {
        for (let uIdx = 0; uIdx < users.length; uIdx++) {
          const user = users[uIdx];
          const userDept = user.department && DEPARTMENT_APPRAISAL_CONTENT[user.department]
            ? user.department
            : (user.role === 'FINANCE' ? 'Finance' : (user.role === 'HR' ? 'HR' : 'Engineering'));

          const deptContent = DEPARTMENT_APPRAISAL_CONTENT[userDept] || DEPARTMENT_APPRAISAL_CONTENT.Engineering;
          const reviewingManager = user.manager || defaultManager;

          // Safe Idempotent Check: does review already exist?
          let existingReview = await prisma.performanceReview.findFirst({
            where: {
              cycleId: cycle.id,
              employeeId: user.id,
              reviewType: cDef.reviewType,
            },
          });

          if (existingReview) {
            grandSummary.reviewsExisting++;
            continue;
          }

          // Varied realistic ratings and status
          // Annual reviews are always COMPLETED (historical record).
          // Monthly reviews have varied statuses for realistic dashboards.
          let reviewStatus = 'COMPLETED';
          if (cDef.frequency === 'MONTHLY') {
            const statusOptions = ['COMPLETED', 'COMPLETED', 'MANAGER_REVIEWED', 'SUBMITTED'];
            reviewStatus = statusOptions[uIdx % statusOptions.length];
          }

          const hasSelf = reviewStatus !== 'DRAFT';
          const hasManager = ['MANAGER_REVIEWED', 'COMPLETED'].includes(reviewStatus);
          const isCompleted = reviewStatus === 'COMPLETED';

          const ratingOffsets = [0.15, 0.35, 0.45, 0.65, 0.25];
          const baseRating = 4.0 + (ratingOffsets[uIdx % ratingOffsets.length] || 0.2);
          const selfRating = Math.min(5.0, baseRating + 0.1);
          const managerRating = Math.min(5.0, baseRating);
          const hikeOptions = [7.5, 9.0, 11.5, 13.0, 15.0];
          const hikePercentage = isCompleted ? hikeOptions[uIdx % hikeOptions.length] : null;

          const selfAccomplishment = deptContent.accomplishments[uIdx % deptContent.accomplishments.length];
          const selfWeakness = deptContent.weaknesses[uIdx % deptContent.weaknesses.length];
          const managerRemark = deptContent.managerRemarks[uIdx % deptContent.managerRemarks.length];

          const reviewSubmittedDate = new Date(cDef.endDate.getTime() - (15 * 86400000));
          const managerSubmittedDate = new Date(cDef.endDate.getTime() - (7 * 86400000));
          const hrSignoffDate = new Date(cDef.endDate.getTime() - (2 * 86400000));

          if (!isDryRun) {
            const createdReview = await prisma.performanceReview.create({
              data: {
                cycleId: cycle.id,
                employeeId: user.id,
                reviewType: cDef.reviewType,
                dueDate: cDef.endDate,
                status: reviewStatus,
                selfAccomplishments: hasSelf ? selfAccomplishment : null,
                selfWeaknesses: hasSelf ? selfWeakness : null,
                selfRating: hasSelf ? selfRating : null,
                selfSubmittedAt: hasSelf ? reviewSubmittedDate : null,
                managerRemarks: hasManager ? managerRemark : null,
                managerRating: hasManager ? managerRating : null,
                managerSubmittedAt: hasManager ? managerSubmittedDate : null,
                hikePercentage: isCompleted ? hikePercentage : null,
                hrSignoffStatus: isCompleted ? 'RELEASED' : 'PENDING_RELEASE',
                hrRemarks: isCompleted
                  ? `Annual appraisal performance review for ${cDef.name} verified and released by HR.`
                  : null,
                hrSignedOffById: isCompleted ? hrOrAdmin.id : null,
                hrSignedOffAt: isCompleted ? hrSignoffDate : null,
              },
            });

            // Create ReviewScores for each parameter
            const scoreData = params.map((p, pIdx) => {
              const paramBase = 3.5 + ((uIdx + pIdx) % 3) * 0.5;
              return {
                reviewId: createdReview.id,
                parameterId: p.id,
                selfScore: hasSelf ? Math.min(5.0, paramBase + 0.5) : null,
                managerScore: hasManager ? Math.min(5.0, paramBase) : null,
                hrScore: isCompleted ? Math.min(5.0, paramBase + 0.25) : null,
              };
            });

            await prisma.reviewScore.createMany({
              data: scoreData,
            });
          }

          grandSummary.reviewsCreated++;
          grandSummary.byStatus[reviewStatus]++;
          grandSummary.byYear[cDef.year]++;
        }

        // Seed 360 Peer Nominations for Annual Cycles
        if (cDef.seedPeer360 && users.length >= 2) {
          for (let i = 0; i < users.length; i++) {
            const reviewee = users[i];
            const peerReviewer = users[(i + 1) % users.length];

            const existingNom = await prisma.peerNomination.findFirst({
              where: {
                cycleId: cycle.id,
                revieweeId: reviewee.id,
                reviewerId: peerReviewer.id,
              },
            });

            if (!existingNom) {
              const revieweeDept = reviewee.department && DEPARTMENT_APPRAISAL_CONTENT[reviewee.department]
                ? reviewee.department
                : 'Engineering';
              const content = DEPARTMENT_APPRAISAL_CONTENT[revieweeDept] || DEPARTMENT_APPRAISAL_CONTENT.Engineering;

              if (!isDryRun) {
                const nomination = await prisma.peerNomination.create({
                  data: {
                    tenantId: tenant.id,
                    cycleId: cycle.id,
                    revieweeId: reviewee.id,
                    reviewerId: peerReviewer.id,
                    status: 'COMPLETED',
                  },
                });

                await prisma.peerFeedback.create({
                  data: {
                    nominationId: nomination.id,
                    rating: 4.5,
                    strengths: content.peerStrengths[i % content.peerStrengths.length],
                    growthAreas: content.peerGrowthAreas[i % content.peerGrowthAreas.length],
                  },
                });
              }

              grandSummary.peerNominationsCreated++;
            }
          }
        }
      }
    }
  }

  console.log('\n================================================================');
  console.log('📊 APPRAISAL SEED EXECUTION SUMMARY');
  console.log('================================================================');
  console.log(`Tenants Processed:        ${grandSummary.tenants}`);
  console.log(`Users Processed:          ${grandSummary.usersProcessed}`);
  console.log(`Cycles Created:           ${grandSummary.cyclesCreated} (Existing: ${grandSummary.cyclesExisting})`);
  console.log(`Parameters Seeded:        ${grandSummary.parametersCreated}`);
  console.log(`Reviews Created:          ${grandSummary.reviewsCreated} (Existing: ${grandSummary.reviewsExisting})`);
  console.log(`360 Peer Nominations:     ${grandSummary.peerNominationsCreated}`);
  console.log('\nCycles Breakdown by Frequency:');
  console.log(`  • Annual:               ${grandSummary.byFrequency.ANNUAL}`);
  console.log(`  • Quarterly:            ${grandSummary.byFrequency.QUARTERLY}`);
  console.log(`  • Monthly:              ${grandSummary.byFrequency.MONTHLY}`);
  console.log('\nReviews Breakdown by Year:');
  console.log(`  • 2024:                 ${grandSummary.byYear[2024]}`);
  console.log(`  • 2025:                 ${grandSummary.byYear[2025]}`);
  console.log('\nReviews Breakdown by Status:');
  console.log(`  • Completed & Released: ${grandSummary.byStatus.COMPLETED}`);
  console.log(`  • Manager Reviewed:     ${grandSummary.byStatus.MANAGER_REVIEWED}`);
  console.log(`  • Self Submitted:       ${grandSummary.byStatus.SUBMITTED}`);
  console.log(`  • Draft:                ${grandSummary.byStatus.DRAFT}`);
  console.log('================================================================\n');

  if (isDryRun) {
    console.log('💡 This was a dry run. No records were committed to the database.');
  } else {
    console.log('✅ Successfully seeded Appraisal Cycles & Reviews into PostgreSQL database!');
  }
}

main()
  .catch((err) => {
    console.error('❌ Error during appraisal seed execution:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
