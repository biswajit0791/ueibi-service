import { prisma } from '../lib/prisma.js';
import { buildTeamScopeWhere } from '../services/teamScope.service.js';
import { canManagerReview, mapNominationsToFeedbackItems, getPeriodMetadata } from './appraisal.controller.js';
import { entityAttachmentService } from '../services/entityAttachment.service.js';
import { storageService } from '../services/storage/storage.service.js';
import { hasRole, HR_ROLES } from '../lib/roles.js';
import {
  teamDirectoryQuerySchema,
  teamMemberDetailQuerySchema,
  employeeIdParamSchema,
  trainingRecordCreateSchema,
  trainingRecordUpdateSchema,
  trainingRecordParamSchema,
  achievementCreateSchema,
  incidentCreateSchema,
  incidentUpdateSchema,
  incidentParamSchema,
  attachmentUploadParamSchema,
  attachmentDownloadParamSchema,
} from '../validations/team.schema.js';

const ATTACHMENT_MIME_ALLOWLIST = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const DIRECTORY_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  department: true,
  designation: true,
  band: true,
  empType: true,
  managerId: true,
  joinDate: true,
};

const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  department: true,
  designation: true,
  band: true,
  managerId: true,
  joinDate: true,
  manager: { select: { id: true, name: true, email: true } },
};

/**
 * GET /team/directory — server-side filtered/paginated team list, replacing
 * UERTeam.jsx's client-side .filter() over a hardcoded mock array.
 */
export async function getTeamDirectory(req, res, next) {
  try {
    const parsed = teamDirectoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { search, department, band, financialYear, includeSelf, page, limit } = parsed.data;

    const { where } = buildTeamScopeWhere(req.user, req.tenantId, { search, department, includeSelf });

    if (band) {
      where.band = { equals: band, mode: 'insensitive' };
    }

    // Exclude employees who joined after the selected financial year's end —
    // mirrors the previous mock behavior ("joinYear > filterYear" exclusion).
    const yearMatch = financialYear && financialYear.match(/(\d{4})/);
    if (yearMatch) {
      const fyStartYear = parseInt(yearMatch[1], 10);
      where.joinDate = { lte: new Date(Date.UTC(fyStartYear + 1, 2, 31, 23, 59, 59)) };
    }

    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      prisma.tenantUser.count({ where }),
      prisma.tenantUser.findMany({
        where,
        select: DIRECTORY_SELECT,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    res.json({
      items,
      pagination: { page, limit, total, totalPages },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Loads the target employee (tenant-scoped) and checks access. By default an
 * employee may act on their own record (allowSelf: true) — used for viewing
 * their own detail page and self-submitting training/certifications.
 * Pass { allowSelf: false } for actions only a manager/HR should take on
 * someone else's record (e.g. logging an achievement or incident).
 */
async function loadTargetEmployeeOrFail(req, res, employeeId, { allowSelf = true } = {}) {
  const targetEmployee = await prisma.tenantUser.findFirst({
    where: { id: employeeId, tenantId: req.tenantId, isDeleted: false },
    select: PROFILE_SELECT,
  });
  if (!targetEmployee) {
    res.status(404).json({ error: 'Employee not found' });
    return null;
  }
  const isSelf = allowSelf && req.user.id === employeeId;
  const allowed = isSelf || (await canManagerReview(req.user, targetEmployee, req.tenantId));
  if (!allowed) {
    res.status(403).json({ error: 'Access forbidden: this employee is outside your reporting scope' });
    return null;
  }
  return targetEmployee;
}

/**
 * Resolves the requested "FY 2026-2027"-style financial year to the tenant's
 * matching ANNUAL AppraisalCycle (if one exists yet), defaulting to the
 * current real-world fiscal year when no financialYear query param is given.
 * Returns { cycle: AppraisalCycle|null, financialYear: string } — financialYear
 * is always a usable display string even when no cycle exists yet.
 */
async function resolveFinancialYear(tenantId, financialYear) {
  const targetName = financialYear || getPeriodMetadata('ANNUAL', new Date()).name;
  const cycle = await prisma.appraisalCycle.findFirst({
    where: { tenantId, frequency: 'ANNUAL', name: targetName },
  });
  return { cycle, financialYear: targetName };
}

/**
 * Converts this page's 4-digit financial year ("FY 2026-2027", matched
 * against AppraisalCycle.name) to the Goals module's 2-digit convention
 * ("FY 2026-27", from getCurrentFinancialYear()) — mirrors the frontend's
 * identical toGoalsFinancialYear() in TeamMemberDetail.jsx, converted only
 * at this one query boundary rather than picking one format everywhere.
 */
function toGoalsFinancialYear(fy) {
  const match = (fy || '').match(/(\d{4})/);
  if (!match) return fy;
  const start = parseInt(match[1], 10);
  return `FY ${start}-${String(start + 1).slice(-2)}`;
}

/**
 * "Project Engagements & Contributions" is sourced from real Goal/
 * GoalAssignment data rather than the Project/ProjectContribution model —
 * that model has no create endpoint anywhere in the app, so it is
 * permanently empty by construction. Goals already tracks exactly this
 * (title, status, progress, who owns/is assigned it) for real.
 */
async function loadGoalsAsProjects(tenantId, employeeId, financialYear) {
  const goals = await prisma.goal.findMany({
    where: {
      tenantId,
      financialYear: toGoalsFinancialYear(financialYear),
      OR: [{ employeeId }, { assignments: { some: { employeeId } } }],
    },
    include: {
      assignments: { where: { employeeId }, select: { status: true, progress: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return goals.map((g) => {
    const assignment = g.assignments[0];
    const status = assignment?.status || g.status;
    const outcome = status === 'COMPLETED' ? 'COMPLETED' : status === 'CHANGES_REQUESTED' ? 'ON_HOLD' : 'IN_PROGRESS';
    return {
      id: g.id,
      name: g.title,
      description: g.description,
      projectStatus: status,
      roleOnProject: g.createdById === employeeId ? 'Goal Owner' : 'Assignee',
      outcome,
      startDate: g.startDate,
      endDate: g.targetDate,
    };
  });
}

/**
 * GET /team/:employeeId/detail — aggregate endpoint powering the Team Member
 * Detail drilldown. Projects (sourced from Goals — see loadGoalsAsProjects)
 * + 360 feedback + appraisal audit are real; advancement is an honest "not
 * built yet" stand-in for a follow-up slice, never fake data.
 */
export async function getTeamMemberDetail(req, res, next) {
  try {
    const parsedParams = employeeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { employeeId } = parsedParams.data;
    const parsedQuery = teamMemberDetailQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }

    const targetEmployee = await loadTargetEmployeeOrFail(req, res, employeeId);
    if (!targetEmployee) return;

    const { cycle, financialYear } = await resolveFinancialYear(req.tenantId, parsedQuery.data.financialYear);

    const [projects, nominations, review, trainingRecords, achievements, incidents] = await Promise.all([
      loadGoalsAsProjects(req.tenantId, employeeId, financialYear),
      // Not cycle-scoped, matching getReceivedPeerFeedback's fix earlier this
      // session — nominations can be tied to a different cycle than the one
      // being viewed here, and this page has no separate cycle picker.
      prisma.peerNomination.findMany({
        where: { tenantId: req.tenantId, revieweeId: employeeId, status: 'COMPLETED' },
        include: {
          feedback: true,
          reviewer: { select: { id: true, name: true, email: true, designation: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      cycle
        ? prisma.performanceReview.findFirst({
            where: { cycleId: cycle.id, employeeId },
            include: {
              scores: { include: { parameter: true } },
              hrSignedOffBy: { select: { id: true, name: true, email: true } },
            },
          })
        : null,
      prisma.trainingRecord.findMany({
        where: { tenantId: req.tenantId, employeeId, financialYear },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.achievement.findMany({
        where: { tenantId: req.tenantId, employeeId, financialYear },
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      prisma.incident.findMany({
        where: { tenantId: req.tenantId, employeeId, financialYear },
        include: { reportedBy: { select: { id: true, name: true } } },
      }),
    ]);

    // One combined attachment lookup for every record on this page (training
    // + achievements) — entity ids are globally unique cuids, so a single
    // findMany across types is safe and avoids a query per section.
    const allEntityIds = [...trainingRecords.map((t) => t.id), ...achievements.map((a) => a.id)];
    const allAttachments = allEntityIds.length > 0
      ? await prisma.entityAttachment.findMany({
          where: { tenantId: req.tenantId, entityId: { in: allEntityIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const attachmentsFor = (id) => allAttachments
      .filter((a) => a.entityId === id)
      .map((a) => ({ id: a.id, originalName: a.originalName, mimeType: a.mimeType, size: a.size }));

    const journal = [
      ...achievements.map((a) => ({
        type: 'achievement',
        id: a.id,
        title: a.title,
        description: a.description,
        category: a.category,
        date: a.occurredOn,
        loggedBy: a.createdBy?.name || null,
        attachments: attachmentsFor(a.id),
      })),
      ...incidents.map((i) => ({
        type: 'incident',
        id: i.id,
        title: i.title,
        description: i.description,
        severity: i.severity,
        status: i.status,
        resolutionNotes: i.resolutionNotes,
        date: i.occurredOn,
        loggedBy: i.reportedBy?.name || null,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    const feedback = mapNominationsToFeedbackItems(nominations);

    const avgOf = (key) => {
      const vals = review.scores.map((s) => s[key]).filter((v) => v !== null && v !== undefined);
      return vals.length > 0 ? Number((vals.reduce((a, v) => a + v, 0) / vals.length).toFixed(1)) : null;
    };

    const appraisal = review
      ? {
          reviewCycle: cycle.name,
          status: review.status,
          selfRating: review.selfRating ? Number(review.selfRating) : null,
          managerRating: review.managerRating ? Number(review.managerRating) : null,
          hikePercentage: review.hikePercentage ? Number(review.hikePercentage) : null,
          hrSignoffStatus: review.hrSignoffStatus,
          hrRemarks: review.hrRemarks,
          hrSignedOffBy: review.hrSignedOffBy,
          averageSelfScore: avgOf('selfScore'),
          averageManagerScore: avgOf('managerScore'),
          averageHrScore: avgOf('hrScore'),
          scores: review.scores.map((s) => ({
            parameter: s.parameter.name,
            selfScore: s.selfScore,
            managerScore: s.managerScore,
            hrScore: s.hrScore,
          })),
        }
      : null;

    res.json({
      employee: targetEmployee,
      financialYear,
      projects,
      feedback,
      appraisal,
      training: trainingRecords.map((t) => ({
        id: t.id,
        name: t.name,
        source: t.source,
        mandatedBy: t.mandatedBy,
        status: t.status,
        approvalStatus: t.approvalStatus,
        score: t.score,
        durationHours: t.durationHours,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        attachments: attachmentsFor(t.id),
      })),
      journal,
      advancement: { available: false },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /team/:employeeId/projects — standalone projects list, same access
 * check as the aggregate endpoint, for if the detail page ever needs to
 * split this out for performance.
 */
export async function getTeamMemberProjects(req, res, next) {
  try {
    const parsedParams = employeeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { employeeId } = parsedParams.data;
    const parsedQuery = teamMemberDetailQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }

    const targetEmployee = await loadTargetEmployeeOrFail(req, res, employeeId);
    if (!targetEmployee) return;

    const { financialYear } = await resolveFinancialYear(req.tenantId, parsedQuery.data.financialYear);

    const projects = await loadGoalsAsProjects(req.tenantId, employeeId, financialYear);

    res.json({ financialYear, projects });
  } catch (err) {
    next(err);
  }
}

// ── Training / Certifications ────────────────────────────────────────────────

/**
 * POST /team/:employeeId/training — an employee submits their own
 * certification, or a manager/HR logs a company-mandated one on someone
 * else's record.
 */
export async function createTrainingRecord(req, res, next) {
  try {
    const parsedParams = employeeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { employeeId } = parsedParams.data;
    const parsed = trainingRecordCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const targetEmployee = await loadTargetEmployeeOrFail(req, res, employeeId);
    if (!targetEmployee) return;

    const isSelf = req.user.id === employeeId;
    const { financialYear } = await resolveFinancialYear(req.tenantId, parsed.data.financialYear);

    const record = await prisma.trainingRecord.create({
      data: {
        tenantId: req.tenantId,
        employeeId,
        name: parsed.data.name,
        mandatedBy: parsed.data.mandatedBy,
        status: parsed.data.status || 'IN_PROGRESS',
        score: parsed.data.score,
        durationHours: parsed.data.durationHours,
        startedAt: parsed.data.startedAt ? new Date(parsed.data.startedAt) : null,
        completedAt: parsed.data.completedAt ? new Date(parsed.data.completedAt) : null,
        financialYear,
        source: isSelf ? 'SELF_SUBMITTED' : 'COMPANY_MANDATED',
        // A manager/HR logging it on someone else's behalf is pre-approved;
        // a self-submitted certification needs HR review.
        approvalStatus: isSelf ? 'PENDING' : 'APPROVED',
        createdById: req.user.id,
      },
    });

    res.status(201).json({ trainingRecord: record });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /team/:employeeId/training/:id — the owner may edit their own
 * not-yet-approved record; only HR/Admin/Super Admin/CMD may set
 * approvalStatus (approve/reject a self-submitted certification).
 */
export async function updateTrainingRecord(req, res, next) {
  try {
    const parsedParams = trainingRecordParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const { employeeId, id } = parsedParams.data;
    const parsed = trainingRecordUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const targetEmployee = await loadTargetEmployeeOrFail(req, res, employeeId);
    if (!targetEmployee) return;

    const record = await prisma.trainingRecord.findFirst({ where: { id, tenantId: req.tenantId, employeeId } });
    if (!record) {
      return res.status(404).json({ error: 'Training record not found' });
    }

    const isHr = hasRole(req.user.role, HR_ROLES);
    const { approvalStatus, ...rest } = parsed.data;
    if (approvalStatus && !isHr) {
      return res.status(403).json({ error: 'Only HR/Admin can approve or reject a certification' });
    }
    const isOwnerOrManager = req.user.id === employeeId || (await canManagerReview(req.user, targetEmployee, req.tenantId));
    if (!isOwnerOrManager && !isHr) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const updated = await prisma.trainingRecord.update({
      where: { id },
      data: {
        ...rest,
        ...(rest.startedAt !== undefined ? { startedAt: new Date(rest.startedAt) } : {}),
        ...(rest.completedAt !== undefined ? { completedAt: new Date(rest.completedAt) } : {}),
        ...(approvalStatus ? { approvalStatus } : {}),
      },
    });

    res.json({ trainingRecord: updated });
  } catch (err) {
    next(err);
  }
}

export async function deleteTrainingRecord(req, res, next) {
  try {
    const parsedParams = trainingRecordParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const { employeeId, id } = parsedParams.data;
    const targetEmployee = await loadTargetEmployeeOrFail(req, res, employeeId);
    if (!targetEmployee) return;

    const record = await prisma.trainingRecord.findFirst({ where: { id, tenantId: req.tenantId, employeeId } });
    if (!record) {
      return res.status(404).json({ error: 'Training record not found' });
    }

    const attachments = await entityAttachmentService.list({ tenantId: req.tenantId, entityType: 'TRAINING_RECORD', entityId: id });
    await Promise.all(attachments.map((a) => entityAttachmentService.delete({ tenantId: req.tenantId, id: a.id })));
    await prisma.trainingRecord.delete({ where: { id } });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// entityKind (route segment, e.g. "training") -> { type (Prisma enum value),
// model (Prisma delegate) } — one generic upload/download pair instead of a
// copy per journal/training entity, now that a third kind (achievements) needs
// the exact same attach-a-file-to-a-record behavior.
const ATTACHMENT_ENTITY_CONFIG = {
  training: { type: 'TRAINING_RECORD', model: () => prisma.trainingRecord },
  achievements: { type: 'ACHIEVEMENT', model: () => prisma.achievement },
  incidents: { type: 'INCIDENT', model: () => prisma.incident },
};

async function loadAttachmentOwnerRecord(entityKind, id, tenantId) {
  const config = ATTACHMENT_ENTITY_CONFIG[entityKind];
  if (!config) return null;
  return config.model().findFirst({ where: { id, tenantId } });
}

/**
 * POST /team/:entityKind/:id/attachment — attach a supporting file (a
 * certificate for a training record, proof for an achievement, etc.) to an
 * existing record. multer memoryStorage upstream provides req.file.
 */
export async function uploadEntityAttachment(req, res, next) {
  try {
    const parsedParams = attachmentUploadParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const { entityKind, id } = parsedParams.data;
    const config = ATTACHMENT_ENTITY_CONFIG[entityKind];
    if (!req.file) {
      return res.status(400).json({ error: 'A file is required' });
    }
    if (!ATTACHMENT_MIME_ALLOWLIST.has(req.file.mimetype)) {
      return res.status(400).json({ error: 'Only PDF, JPEG, or PNG files are allowed' });
    }

    const record = await loadAttachmentOwnerRecord(entityKind, id, req.tenantId);
    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const targetEmployee = await prisma.tenantUser.findFirst({ where: { id: record.employeeId, tenantId: req.tenantId }, select: PROFILE_SELECT });
    const isOwner = req.user.id === record.employeeId;
    const allowed = isOwner || (targetEmployee && (await canManagerReview(req.user, targetEmployee, req.tenantId)));
    if (!allowed) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const attachment = await entityAttachmentService.save({
      tenantId: req.tenantId,
      entityType: config.type,
      entityId: id,
      uploadedById: req.user.id,
      file: req.file,
    });

    res.status(201).json({
      attachment: { id: attachment.id, originalName: attachment.originalName, mimeType: attachment.mimeType, size: attachment.size },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

/**
 * GET /team/:entityKind/:id/attachment/:attachmentId — protected download,
 * mirrors getTaskCommentAttachment's stream-through pattern.
 */
export async function downloadEntityAttachment(req, res, next) {
  try {
    const parsedParams = attachmentDownloadParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const { entityKind, id, attachmentId } = parsedParams.data;
    const config = ATTACHMENT_ENTITY_CONFIG[entityKind];

    const record = await loadAttachmentOwnerRecord(entityKind, id, req.tenantId);
    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }
    const targetEmployee = await prisma.tenantUser.findFirst({ where: { id: record.employeeId, tenantId: req.tenantId }, select: PROFILE_SELECT });
    const isOwner = req.user.id === record.employeeId;
    const allowed = isOwner || (targetEmployee && (await canManagerReview(req.user, targetEmployee, req.tenantId)));
    if (!allowed) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    const attachment = await entityAttachmentService.getById({ tenantId: req.tenantId, id: attachmentId });
    if (!attachment || attachment.entityId !== id || attachment.entityType !== config.type) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const stream = await storageService.getDownloadStream(attachment.storageKey);
    const encodedFilename = encodeURIComponent(attachment.originalName);
    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    if (attachment.size) res.setHeader('Content-Length', attachment.size);
    stream.pipe(res);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// ── Achievements & Incidents Journal ─────────────────────────────────────────

/**
 * POST /team/:employeeId/achievements — self-service (an employee logging
 * their own achievement) or a manager/HR logging one for a report.
 */
export async function createAchievement(req, res, next) {
  try {
    const parsedParams = employeeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { employeeId } = parsedParams.data;
    const parsed = achievementCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    // Self-service is allowed here (unlike incidents) — the employee panel
    // spec explicitly lists achievements as something an employee submits
    // about themselves, same as training/certifications.
    const targetEmployee = await loadTargetEmployeeOrFail(req, res, employeeId);
    if (!targetEmployee) return;

    const { financialYear } = await resolveFinancialYear(req.tenantId, parsed.data.financialYear);

    const achievement = await prisma.achievement.create({
      data: {
        tenantId: req.tenantId,
        employeeId,
        title: parsed.data.title,
        description: parsed.data.description,
        category: parsed.data.category,
        occurredOn: new Date(parsed.data.occurredOn),
        financialYear,
        createdById: req.user.id,
      },
    });

    res.status(201).json({ achievement });
  } catch (err) {
    next(err);
  }
}

export async function createIncident(req, res, next) {
  try {
    const parsedParams = employeeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { employeeId } = parsedParams.data;
    const parsed = incidentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const targetEmployee = await loadTargetEmployeeOrFail(req, res, employeeId, { allowSelf: false });
    if (!targetEmployee) return;

    const { financialYear } = await resolveFinancialYear(req.tenantId, parsed.data.financialYear);

    const incident = await prisma.incident.create({
      data: {
        tenantId: req.tenantId,
        employeeId,
        title: parsed.data.title,
        description: parsed.data.description,
        severity: parsed.data.severity || 'LOW',
        occurredOn: new Date(parsed.data.occurredOn),
        financialYear,
        reportedById: req.user.id,
      },
    });

    res.status(201).json({ incident });
  } catch (err) {
    next(err);
  }
}

export async function updateIncident(req, res, next) {
  try {
    const parsedParams = incidentParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid parameters', details: parsedParams.error.issues });
    }
    const { employeeId, id } = parsedParams.data;
    const parsed = incidentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const targetEmployee = await loadTargetEmployeeOrFail(req, res, employeeId, { allowSelf: false });
    if (!targetEmployee) return;

    const incident = await prisma.incident.findFirst({ where: { id, tenantId: req.tenantId, employeeId } });
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const updated = await prisma.incident.update({ where: { id }, data: parsed.data });
    res.json({ incident: updated });
  } catch (err) {
    next(err);
  }
}
