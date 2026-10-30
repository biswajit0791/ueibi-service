/**
 * periodicAppraisal.controller.js
 *
 * The Appraisal Suite's view of Monthly and Quarterly appraisals. There is no
 * manager step in these: the employee submits (with the Team-table Final
 * Weightage and Manager Rating shown read-only), and then
 *
 *   HR       sees every employee's submission for a period, adds a comment
 *            and locks it (status COMPLETED — the employee can no longer edit).
 *   Manager  sees the submissions of their reporting downline, read-only.
 *
 * Annual appraisals keep their existing flow elsewhere.
 */
import { prisma } from '../lib/prisma.js';
import { emitToUser } from '../lib/socket.js';
import { ELEVATED_ROLES, hasRole } from '../lib/roles.js';
import { getCompanySettings } from '../services/companySettings.service.js';
import { getTenantFinancialYear } from '../lib/financialYear.js';
import { getFiscalYearPeriods, appraisalAvailability, isQuarterEndMonth } from '../lib/appraisalPeriods.js';
import { getTeamTableMetricsBulk } from '../services/appraisalMetrics.service.js';

const NOT_PLATFORM = { role: { notIn: ['PLATFORM_OWNER', 'PLATFORM_SALES'] } };
const SUBMITTED_STATUSES = ['SUBMITTED', 'MANAGER_REVIEWED', 'COMPLETED'];

/** Everyone below `userId` in the reporting line (direct and indirect reports). */
async function downlineIdsOf(tenantId, userId) {
  const people = await prisma.tenantUser.findMany({
    where: { tenantId, isDeleted: false },
    select: { id: true, managerId: true },
  });
  const childrenOf = {};
  people.forEach((u) => { if (u.managerId) (childrenOf[u.managerId] ||= []).push(u.id); });
  const ids = new Set();
  const queue = [userId];
  while (queue.length) {
    for (const child of childrenOf[queue.shift()] || []) {
      if (!ids.has(child) && child !== userId) { ids.add(child); queue.push(child); }
    }
  }
  return [...ids];
}

/** The year's appraisal periods in order: M, M, Q … (quarter-end months have no monthly appraisal). */
function timelineOf(fiscalYear, settings) {
  return [
    ...getFiscalYearPeriods('MONTHLY', fiscalYear, settings).filter((p) => !isQuarterEndMonth(p.monthNumber, settings)),
    ...getFiscalYearPeriods('QUARTERLY', fiscalYear, settings),
  ].sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
}

const periodKey = (p) => `${p.frequency}:${p.name}`;

/**
 * GET /api/appraisals/periodic-submissions?fiscalYear=2026&period=MONTHLY:April%202026
 * The year's periods, and for the chosen one (default: the latest that has
 * opened) every employee in the caller's scope with their submission.
 */
export async function listPeriodicSubmissions(req, res, next) {
  try {
    const isHR = hasRole(req.user.role, ELEVATED_ROLES);
    const settings = await getCompanySettings(req.tenantId);
    const current = getTenantFinancialYear(settings);
    const requestedFy = parseInt(req.query.fiscalYear, 10);
    const fiscalYear = Number.isInteger(requestedFy) && requestedFy > 2000 && requestedFy < 2100 ? requestedFy : current.startYear;

    const timeline = timelineOf(fiscalYear, settings).map((p) => ({ ...p, key: periodKey(p), availability: appraisalAvailability(p) }));
    const opened = timeline.filter((p) => p.availability.available);
    const selected = timeline.find((p) => p.key === req.query.period) || opened[opened.length - 1] || timeline[0];

    // Scope: HR sees everyone; a manager sees their downline; anyone else sees nobody.
    const scopeIds = isHR ? null : await downlineIdsOf(req.tenantId, req.user.id);
    const employees = await prisma.tenantUser.findMany({
      where: {
        tenantId: req.tenantId,
        isDeleted: false,
        status: { in: ['ACTIVE', 'INVITED'] },
        id: scopeIds ? { in: scopeIds } : { not: req.user.id },
        ...NOT_PLATFORM,
      },
      select: { id: true, name: true, email: true, designation: true, department: true, employeeId: true, managerId: true },
      orderBy: { name: 'asc' },
    });

    const cycle = await prisma.appraisalCycle.findFirst({
      where: { tenantId: req.tenantId, frequency: selected.frequency, name: selected.name },
      select: { id: true },
    });
    const reviews = cycle && employees.length
      ? await prisma.performanceReview.findMany({
          where: { cycleId: cycle.id, employeeId: { in: employees.map((e) => e.id) } },
          select: {
            id: true, employeeId: true, status: true, selfRating: true, selfAccomplishments: true,
            selfSubmittedAt: true, hrRemarks: true, hrSignoffStatus: true, finalisedAt: true,
            finalisedBy: { select: { id: true, name: true } }, managerTaskRatingSnapshot: true,
          },
        })
      : [];
    const reviewOf = new Map(reviews.map((r) => [r.employeeId, r]));

    // Live Team-table figures for anyone without a frozen submission snapshot.
    const needLive = employees.filter((e) => reviewOf.get(e.id)?.managerTaskRatingSnapshot?.source !== 'TEAM_TABLE').map((e) => e.id);
    const live = selected.availability.available
      ? await getTeamTableMetricsBulk(req.tenantId, needLive, { ...selected, id: cycle?.id || null })
      : new Map();

    const rows = employees.map((employee) => {
      const review = reviewOf.get(employee.id) || null;
      const snapshot = review?.managerTaskRatingSnapshot?.source === 'TEAM_TABLE' ? review.managerTaskRatingSnapshot : null;
      const { managerTaskRatingSnapshot, ...reviewOut } = review || {};
      // A draft is the employee's work in progress — HR and managers see only that one exists.
      const visibleReview = review && SUBMITTED_STATUSES.includes(review.status)
        ? reviewOut
        : review ? { id: review.id, status: review.status } : null;
      return { employee, review: visibleReview, metrics: snapshot || live.get(employee.id) || null };
    });

    const count = (pred) => rows.filter(pred).length;
    res.json({
      fiscalYear,
      fiscalYearLabel: `FY ${fiscalYear}-${String((fiscalYear + 1) % 100).padStart(2, '0')}`,
      currentFiscalYear: current.startYear,
      periods: timeline.map(({ key, frequency, name, startDate, endDate, availability }) => ({ key, frequency, name, startDate, endDate, availability })),
      selected: { key: selected.key, frequency: selected.frequency, name: selected.name, startDate: selected.startDate, endDate: selected.endDate, availability: selected.availability },
      rows,
      counts: {
        total: rows.length,
        locked: count((r) => r.review?.status === 'COMPLETED'),
        awaitingHr: count((r) => ['SUBMITTED', 'MANAGER_REVIEWED'].includes(r.review?.status)),
        notSubmitted: count((r) => !r.review || r.review.status === 'DRAFT'),
      },
      canLock: isHR,
      scope: isHR ? 'ALL' : 'TEAM',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/appraisals/:id/hr-review  { hrRemarks, lock }
 * HR comments on a submitted monthly / quarterly appraisal and optionally
 * locks it. Locked appraisals are final: neither HR nor the employee can
 * change them afterwards.
 */
export async function hrReviewPeriodicAppraisal(req, res, next) {
  try {
    const hrRemarks = typeof req.body?.hrRemarks === 'string' ? req.body.hrRemarks.trim() : undefined;
    const lock = req.body?.lock === true;
    if (hrRemarks !== undefined && hrRemarks.length > 5000) {
      return res.status(400).json({ error: 'Comment must be under 5000 characters.' });
    }

    const review = await prisma.performanceReview.findUnique({
      where: { id: String(req.params.id) },
      include: { cycle: true, employee: { select: { id: true, tenantId: true, name: true } } },
    });
    if (!review || review.employee.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Appraisal not found' });
    }
    if (!['MONTHLY', 'QUARTERLY'].includes(String(review.cycle?.frequency).toUpperCase())) {
      return res.status(400).json({ error: 'Only monthly and quarterly appraisals are reviewed here.' });
    }
    if (review.employeeId === req.user.id) {
      return res.status(403).json({ error: 'You cannot review or lock your own appraisal.' });
    }
    if (review.status === 'COMPLETED') {
      return res.status(409).json({ error: 'This appraisal is already locked.' });
    }
    if (!['SUBMITTED', 'MANAGER_REVIEWED'].includes(review.status)) {
      return res.status(409).json({ error: 'The employee has not submitted this appraisal yet.' });
    }
    if (lock && !(hrRemarks || review.hrRemarks)) {
      return res.status(400).json({ error: 'Add a comment before locking the appraisal.' });
    }

    const now = new Date();
    const updated = await prisma.performanceReview.update({
      where: { id: review.id },
      data: {
        ...(hrRemarks !== undefined && { hrRemarks }),
        hrSignedOffById: req.user.id,
        hrSignedOffAt: now,
        ...(lock && {
          status: 'COMPLETED',
          hrSignoffStatus: 'FINALISED',
          finalisedAt: now,
          finalisedById: req.user.id,
        }),
      },
      select: { id: true, status: true, hrRemarks: true, hrSignoffStatus: true, finalisedAt: true },
    });

    if (lock) {
      try {
        const notif = await prisma.notification.create({
          data: {
            tenantId: req.tenantId,
            recipientId: review.employeeId,
            type: 'appraisal_locked',
            title: `${review.cycle.name} appraisal completed`,
            body: `HR (${req.user.name || 'HR'}) has reviewed and locked your ${review.cycle.name} appraisal.`,
            entityType: 'review',
            entityId: review.id,
          },
        });
        emitToUser(req.tenantId, review.employeeId, 'notification', notif);
      } catch (err) {
        console.warn('[PeriodicAppraisal] Notification failed:', err.message);
      }
    }

    res.json({ review: updated });
  } catch (err) {
    next(err);
  }
}
