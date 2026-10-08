/**
 * @file exit.controller.js
 * @description Employee Exit Workflow Controller.
 *
 * Full lifecycle: Initiate → Interview → Department Clearances → Complete → Generate Certificates
 *
 * The exit process uses the ExitDetails model as the state machine:
 *   INITIATED → INTERVIEW_DONE → PENDING_CLEARANCE → ALL_CLEARED → COMPLETED
 *
 * On COMPLETED, the TenantUser is soft-deleted (isDeleted=true, status=EXITED),
 * direct reports are re-assigned, an ExEmployeeRecord is created for the registry,
 * and one license slot is freed.
 */
import { prisma } from '../lib/prisma.js';
import { emitToTenant } from '../lib/socket.js';
import { sendMail } from '../lib/mailer.js';
import { getLicenseStats } from '../services/license.service.js';
import {
  generateRelievingLetter,
  generateServiceCertificate,
  generateReferenceCheckProfile,
  generateTerminationLetter,
} from '../services/pdf.service.js';
import { getDefaultTemplate } from '../services/documentTemplate.service.js';
import { resolveTokensForEmployee } from '../services/documentToken.service.js';
import { renderDocumentPdf } from '../services/documentRenderer.service.js';
import {
  initiateExitSchema,
  exitInterviewSchema,
  clearanceSchema,
  completeExitSchema,
  exitIdParamSchema,
  employeeIdParamSchema,
  certificateTypeSchema,
  sendExitDocumentsSchema,
} from '../validations/exit.schema.js';
import {
  LEGACY_KEYS,
  createInitialClearances,
  ensureClearanceRows,
  loadApproverContext,
  resolveApprovers,
  permissionFor,
  presentClearance,
  progressOf,
} from '../services/exitClearance.service.js';
import { publicUploadUrl, buildAttachments } from '../lib/publicFiles.js';

// Exits created from this moment on cannot be completed while a clearance is
// pending (HR/Admin may override with a reason). Exits already in flight when
// the rule shipped are exempt rather than blocked retroactively.
const CLEARANCE_ENFORCED_FROM = new Date('2026-10-09T00:00:00+05:30');

const EXIT_USER_SELECT = {
  id: true, name: true, email: true, personalEmail: true, designation: true,
  department: true, employeeId: true, profilePhoto: true, managerId: true,
};

/**
 * Present each exit's clearances for `user` (backfilling rows for exits that
 * pre-date them), including whether the user may act on each one.
 */
async function presentExits(tenantId, exits, user) {
  const withRows = await ensureClearanceRows(exits);
  const ctx = await loadApproverContext(tenantId, withRows);
  return withRows.map((exit) => {
    const clearances = [...exit.clearances]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => presentClearance(row, exit, user, ctx));
    return { exit, clearances };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/exit/:employeeId/initiate
// HR starts the exit process — creates ExitDetails row with INITIATED status.
// ─────────────────────────────────────────────────────────────────────────────
export async function initiateExit(req, res, next) {
  try {
    const parsedParams = employeeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID', details: parsedParams.error.issues });
    }
    const { employeeId } = parsedParams.data;
    const tenantId = req.tenantId;

    const parsed = initiateExitSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    // Guard: cannot exit yourself
    if (employeeId === req.user.id) {
      return res.status(400).json({ error: 'You cannot initiate your own exit' });
    }

    // Check the employee exists, is active, and belongs to this tenant
    const employee = await prisma.tenantUser.findFirst({
      where: { id: employeeId, tenantId, isDeleted: false },
      select: { id: true, name: true, email: true, status: true, department: true },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Active employee not found' });
    }

    if (employee.status === 'EXITED') {
      return res.status(409).json({ error: 'This employee has already been exited' });
    }

    // Check if exit already initiated
    const existing = await prisma.exitDetails.findUnique({
      where: { userId: employeeId },
    });

    if (existing && existing.exitStatus !== 'COMPLETED') {
      return res.status(409).json({
        error: 'An exit process is already in progress for this employee',
        exitDetails: existing,
      });
    }

    // If a previous completed exit exists, delete it to allow re-initiation (edge case)
    if (existing) {
      await prisma.exitDetails.delete({ where: { userId: employeeId } });
    }

    const exitDetails = await prisma.$transaction(async (tx) => {
      const created = await tx.exitDetails.create({
        data: {
          userId: employeeId,
          tenantId,
          resignationDate: new Date(parsed.data.resignationDate),
          lastWorkingDay: new Date(parsed.data.lastWorkingDay),
          exitReason: parsed.data.exitReason,
          feedbackRemarks: parsed.data.feedbackRemarks || null,
          noticePeriodDays: parsed.data.noticePeriodDays ?? null,
          exitStatus: 'INITIATED',
        },
      });
      await createInitialClearances(tx, created, employee);
      return created;
    });

    emitToTenant(tenantId, 'exit_initiated', {
      employeeId,
      employeeName: employee.name,
      exitDetailsId: exitDetails.id,
    });

    res.status(201).json({
      message: `Exit process initiated for ${employee.name}`,
      exitDetails,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/exit/:id/interview
// Save exit interview notes and advance status to INTERVIEW_DONE.
// ─────────────────────────────────────────────────────────────────────────────
export async function saveExitInterview(req, res, next) {
  try {
    const parsedParams = exitIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid exit ID', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

    const parsed = exitInterviewSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const exitDetails = await prisma.exitDetails.findFirst({
      where: { id, tenantId: req.tenantId },
    });

    if (!exitDetails) {
      return res.status(404).json({ error: 'Exit record not found' });
    }

    if (exitDetails.exitStatus === 'COMPLETED') {
      return res.status(409).json({ error: 'Exit process is already completed' });
    }

    const updated = await prisma.exitDetails.update({
      where: { id },
      data: {
        exitInterviewNotes: parsed.data.exitInterviewNotes,
        exitInterviewDate: new Date(parsed.data.exitInterviewDate),
        exitInterviewConductedBy: parsed.data.exitInterviewConductedBy,
        exitStatus: 'INTERVIEW_DONE',
      },
    });

    res.json({ message: 'Exit interview saved', exitDetails: updated });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/exit/:id/clearance
// The designated approver clears (or revokes) one clearance. HR/Admin acting
// in a department head's place must give a reason. Advances the exit to
// ALL_CLEARED when every clearance is done, and back when one is revoked.
// ─────────────────────────────────────────────────────────────────────────────
export async function approveClearance(req, res, next) {
  try {
    const parsedParams = exitIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid exit ID', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

    const parsed = clearanceSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const { department, cleared, remarks, fileUrl, fileName, reason } = parsed.data;

    const found = await prisma.exitDetails.findFirst({
      where: { id, tenantId: req.tenantId },
      include: { user: { select: EXIT_USER_SELECT }, clearances: true },
    });

    if (!found) {
      return res.status(404).json({ error: 'Exit record not found' });
    }

    if (found.exitStatus === 'COMPLETED') {
      return res.status(409).json({ error: 'Exit process is already completed' });
    }

    const [exitDetails] = await ensureClearanceRows([found]);
    const row = exitDetails.clearances.find((c) => c.key === department);
    if (!row) {
      return res.status(404).json({ error: `This exit has no ${department} clearance.` });
    }

    // ── Approver enforcement ──
    const ctx = await loadApproverContext(req.tenantId, [exitDetails]);
    const approvers = resolveApprovers(row, exitDetails.user, ctx);
    const perm = permissionFor(req.user, row, approvers);
    if (!perm.allowed) {
      const who = approvers.names.length ? approvers.names.join(' or ') : 'the designated approver';
      return res.status(403).json({
        error: `Only ${who} or HR/Admin may ${cleared ? 'approve' : 'revoke'} ${row.label} clearance.`,
      });
    }
    const onBehalfReason = (reason || '').trim();
    if (perm.onBehalf && onBehalfReason.length < 5) {
      return res.status(400).json({
        error: `You are acting in place of ${approvers.names.join(' / ') || 'the department head'}. Please give a reason (at least 5 characters).`,
        code: 'ON_BEHALF_REASON_REQUIRED',
      });
    }

    const now = new Date();
    const actorName = req.user.name || req.user.email;

    // Legacy mirrors: boolean columns + the clearances map in feedbackRemarks.
    const legacyUpdate = {};
    const remarksObj = parseExitRemarks(exitDetails.feedbackRemarks);
    if (LEGACY_KEYS.includes(department)) {
      legacyUpdate[`${department}Cleared`] = cleared;
      legacyUpdate[`${department}ClearedAt`] = cleared ? now : null;
      legacyUpdate[`${department}ClearedBy`] = cleared ? actorName : null;
      if (!remarksObj.clearances) remarksObj.clearances = {};
      remarksObj.clearances[department] = {
        cleared,
        remarks: remarks || '',
        fileUrl: fileUrl || null,
        fileName: fileName || null,
        clearedBy: actorName,
        clearedAt: now.toISOString(),
      };
      legacyUpdate.feedbackRemarks = JSON.stringify(remarksObj);
    }

    const otherPending = exitDetails.clearances.some((c) => c.id !== row.id && c.status !== 'CLEARED');
    const allCleared = cleared && !otherPending;
    let exitStatus;
    if (allCleared) {
      exitStatus = 'ALL_CLEARED';
    } else if (['INITIATED', 'INTERVIEW_DONE', 'ALL_CLEARED'].includes(exitDetails.exitStatus)) {
      // ALL_CLEARED is included so a revoke after full clearance reopens the exit.
      exitStatus = 'PENDING_CLEARANCE';
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.exitClearance.update({
        where: { id: row.id },
        data: cleared
          ? {
              status: 'CLEARED',
              remarks: remarks || null,
              fileUrl: fileUrl || null,
              fileName: fileName || null,
              actedById: req.user.id,
              actedByName: actorName,
              actedAt: now,
              onBehalf: perm.onBehalf,
              onBehalfReason: perm.onBehalf ? onBehalfReason : null,
            }
          : {
              status: 'PENDING',
              actedById: null,
              actedByName: null,
              actedAt: null,
              onBehalf: false,
              onBehalfReason: null,
            },
      });
      await tx.exitClearanceEvent.create({
        data: {
          tenantId: req.tenantId,
          clearanceId: row.id,
          action: cleared ? 'CLEARED' : 'REVOKED',
          actorId: req.user.id,
          actorName,
          onBehalf: perm.onBehalf,
          reason: perm.onBehalf ? onBehalfReason : null,
          remarks: remarks || null,
        },
      });
      return tx.exitDetails.update({
        where: { id },
        data: { ...legacyUpdate, ...(exitStatus ? { exitStatus } : {}) },
      });
    });

    emitToTenant(req.tenantId, 'exit_clearance_updated', {
      exitDetailsId: id,
      department,
      cleared,
      allCleared,
      remarks: remarks || '',
      fileUrl: fileUrl || null,
      fileName: fileName || null,
    });

    res.json({
      message: allCleared
        ? 'All departments cleared! Ready for final exit completion.'
        : `${row.label} clearance ${cleared ? 'approved' : 'revoked'}`,
      exitDetails: updated,
      clearanceDetails: remarksObj.clearances || {},
      allCleared,
    });
  } catch (err) {
    next(err);
  }
}

// ── Helper to parse exit feedbackRemarks safely ──
function parseExitRemarks(raw) {
  let remarksObj = {};
  try {
    remarksObj = JSON.parse(raw || '{}');
    if (typeof remarksObj !== 'object' || !remarksObj || Array.isArray(remarksObj)) {
      remarksObj = { generalRemarks: raw || '' };
    }
  } catch (e) {
    remarksObj = { generalRemarks: raw || '' };
  }
  return remarksObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/exit/:employeeId/status
// Get full exit status with clearance progress for a specific employee.
// ─────────────────────────────────────────────────────────────────────────────
export async function getExitStatus(req, res, next) {
  try {
    const parsedParams = employeeIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID', details: parsedParams.error.issues });
    }
    const { employeeId } = parsedParams.data;

    // Regular employee can only view their own exit record
    if (req.user.role === 'EMPLOYEE' && req.user.id !== employeeId) {
      return res.status(403).json({ error: 'You are only authorized to view your own exit record.' });
    }

    const found = await prisma.exitDetails.findFirst({
      where: { userId: employeeId, tenantId: req.tenantId },
      include: {
        user: {
          select: { ...EXIT_USER_SELECT, joinDate: true },
        },
        clearances: true,
      },
    });

    if (!found) {
      return res.status(404).json({ error: 'No exit process found for this employee' });
    }

    const [{ exit: withRows, clearances }] = await presentExits(req.tenantId, [found], req.user);
    const { clearances: _rows, ...exitDetails } = withRows;
    const remarksObj = parseExitRemarks(exitDetails.feedbackRemarks);

    res.json({
      exitDetails,
      clearances,
      documents: {
        relievingLetterUrl: exitDetails.relievingLetterUrl || null,
        serviceCertificateUrl: exitDetails.serviceCertificateUrl || null,
        terminationLetterUrl: remarksObj.terminationLetterUrl || null,
        documentsSentAt: remarksObj.documentsSentAt || null,
        documentsSentTo: remarksObj.documentsSentTo || null,
      },
      progress: progressOf(clearances),
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/exit/my-status
// Convenience endpoint for the authenticated employee to fetch their own exit record.
// ─────────────────────────────────────────────────────────────────────────────
export async function getMyExitStatus(req, res, next) {
  try {
    req.params.employeeId = req.user.id;
    return getExitStatus(req, res, next);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/exit/pending
// List all in-progress exit processes for the current tenant.
// ─────────────────────────────────────────────────────────────────────────────
export async function listPendingExits(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const includeCompleted = req.query.includeCompleted === 'true' || req.query.status === 'all' || req.query.status === 'COMPLETED';

    const where = { tenantId };
    if (req.query.status === 'COMPLETED') {
      where.exitStatus = 'COMPLETED';
    } else if (!includeCompleted) {
      where.exitStatus = { not: 'COMPLETED' };
    }

    const exits = await prisma.exitDetails.findMany({
      where,
      include: { user: { select: EXIT_USER_SELECT }, clearances: true },
      orderBy: { createdAt: 'desc' },
    });

    const presented = await presentExits(tenantId, exits, req.user);
    const enriched = presented.map(({ exit, clearances }) => toListItem(exit, clearances));

    res.json({ exits: enriched, total: enriched.length });
  } catch (err) {
    next(err);
  }
}

// The exit tracker card shape: clearances, progress and documents.
function toListItem(exit, clearances) {
  const { clearances: _rows, ...rest } = exit;
  const remarksObj = parseExitRemarks(exit.feedbackRemarks);
  return {
    ...rest,
    clearances,
    clearanceDetails: remarksObj.clearances || {},
    documents: {
      relievingLetterUrl: exit.relievingLetterUrl || null,
      serviceCertificateUrl: exit.serviceCertificateUrl || null,
      terminationLetterUrl: remarksObj.terminationLetterUrl || null,
      documentsSentAt: remarksObj.documentsSentAt || null,
      documentsSentTo: remarksObj.documentsSentTo || null,
    },
    clearanceProgress: progressOf(clearances),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/exit/clearances/inbox
// Open exits with at least one clearance assigned to the caller: a reporting
// manager, a department head (IT or the employee's own), Finance, HR. Open to
// every role; what is returned is decided per clearance.
// ─────────────────────────────────────────────────────────────────────────────
export async function listMyClearanceInbox(req, res, next) {
  try {
    const exits = await prisma.exitDetails.findMany({
      where: { tenantId: req.tenantId, exitStatus: { not: 'COMPLETED' } },
      include: { user: { select: EXIT_USER_SELECT }, clearances: true },
      orderBy: { lastWorkingDay: 'asc' },
    });

    const presented = await presentExits(req.tenantId, exits, req.user);
    const items = presented
      .filter(({ clearances }) => clearances.some((c) => c.assignedToMe))
      .map(({ exit, clearances }) => {
        // Deliberately narrower than the HR tracker.
        const { feedbackRemarks, clearanceDetails, documents, user, ...rest } = toListItem(exit, clearances);
        const { personalEmail, ...safeUser } = user || {};
        return { ...rest, user: safeUser };
      });

    const pendingForMe = items.reduce(
      (n, exit) => n + exit.clearances.filter((c) => c.assignedToMe && !c.cleared).length,
      0,
    );

    res.json({ exits: items, total: items.length, pendingForMe });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/exit/:id/complete
// Finalize exit: mark user EXITED, free license, create ExEmployeeRecord,
// re-assign subordinates.
// ─────────────────────────────────────────────────────────────────────────────
export async function completeExit(req, res, next) {
  try {
    const parsedParams = exitIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid exit ID', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
    const tenantId = req.tenantId;

    const parsed = completeExitSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const exitDetails = await prisma.exitDetails.findFirst({
      where: { id, tenantId },
      include: {
        clearances: true,
        user: {
          select: {
            id: true, name: true, email: true, pan: true,
            designation: true, department: true, managerId: true,
            status: true, isDeleted: true, employeeId: true,
          },
        },
      },
    });

    if (!exitDetails) {
      return res.status(404).json({ error: 'Exit record not found' });
    }

    if (exitDetails.exitStatus === 'COMPLETED') {
      return res.status(409).json({ error: 'Exit process is already completed' });
    }

    const employee = exitDetails.user;
    if (!employee || employee.isDeleted) {
      return res.status(404).json({ error: 'Employee record not found or already deleted' });
    }

    // ── Handover / Exit Tasks Guardrail Check ────────────────────────────────
    const overrideHandover = req.body?.overrideHandover === true || req.body?.skipHandover === true;
    const isLeadership = ['SUPER_ADMIN', 'ADMIN', 'HR', 'CMD'].includes(req.user?.role);

    const pendingHandoverGoals = await prisma.goal.findMany({
      where: {
        tenantId,
        status: { not: 'COMPLETED' },
        OR: [
          { employeeId: employee.id },
          { assignments: { some: { employeeId: employee.id } } },
        ],
        AND: [
          {
            OR: [
              { isHandoverGoal: true },
              { category: { contains: 'Handover', mode: 'insensitive' } },
              { category: { contains: 'Exit', mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: { id: true, title: true, progress: true, dueDate: true, category: true, status: true },
    });

    if (pendingHandoverGoals.length > 0 && !overrideHandover) {
      return res.status(409).json({
        error: `Employee has ${pendingHandoverGoals.length} pending handover goal(s) that must be completed before completing exit.`,
        code: 'PENDING_HANDOVER_GOALS',
        canOverride: isLeadership,
        pendingGoals: pendingHandoverGoals.map((g) => ({
          id: g.id,
          title: g.title,
          progress: g.progress,
          dueDate: g.dueDate ? g.dueDate.toISOString().split('T')[0] : null,
          category: g.category,
          status: g.status,
        })),
      });
    }

    if (pendingHandoverGoals.length > 0 && overrideHandover && !isLeadership) {
      return res.status(403).json({
        error: 'Only Leadership (SUPER_ADMIN, ADMIN, HR, CMD) is authorized to bypass pending handover goals.',
      });
    }

    // ── Clearance Guardrail ──────────────────────────────────────────────────
    const [{ clearances: clearanceRows }] = await ensureClearanceRows([exitDetails]);
    const pendingClearances = clearanceRows
      .filter((c) => c.status !== 'CLEARED')
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const clearanceRuleApplies = exitDetails.createdAt >= CLEARANCE_ENFORCED_FROM;
    const { overrideClearances, overrideReason } = parsed.data;
    let clearanceOverride = null;

    if (clearanceRuleApplies && pendingClearances.length > 0) {
      const pendingLabels = pendingClearances.map((c) => c.label);
      if (!overrideClearances) {
        return res.status(409).json({
          error: `${pendingLabels.join(', ')} clearance${pendingLabels.length > 1 ? 's are' : ' is'} still pending. All department clearances must be approved before the exit can be completed.`,
          code: 'PENDING_CLEARANCES',
          canOverride: isLeadership,
          pendingClearances: pendingLabels,
        });
      }
      if (!isLeadership) {
        return res.status(403).json({
          error: 'Only HR or Admin may complete an exit while clearances are pending.',
        });
      }
      if (!overrideReason || overrideReason.trim().length < 5) {
        return res.status(400).json({
          error: 'A reason (at least 5 characters) is required to complete an exit with pending clearances.',
          code: 'OVERRIDE_REASON_REQUIRED',
        });
      }
      clearanceOverride = {
        pending: pendingLabels,
        reason: overrideReason.trim(),
        by: req.user.name || req.user.email,
        byId: req.user.id,
        at: new Date().toISOString(),
      };
    }

    const nameParts = (employee.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const {
      serviceStart, serviceEnd, techRating, attitudeRating,
      conductValue, feedback, docs,
    } = parsed.data;

    // Atomic transaction: deactivate + re-assign subordinates + create exit record + update exit details
    const exitRecord = await prisma.$transaction(async (tx) => {
      // Mark handover goals as overridden if leadership chose to bypass
      if (pendingHandoverGoals.length > 0 && overrideHandover && isLeadership) {
        await tx.goal.updateMany({
          where: { id: { in: pendingHandoverGoals.map((g) => g.id) } },
          data: { handoverOverridden: true, handoverOverriddenBy: req.user.id },
        });
      }

      // 1. Soft-delete the TenantUser
      await tx.tenantUser.update({
        where: { id: employee.id },
        data: { isDeleted: true, status: 'EXITED' },
      });

      // 2. Re-route direct reports to the exiting manager's manager
      await tx.tenantUser.updateMany({
        where: { managerId: employee.id, tenantId },
        data: { managerId: employee.managerId ?? null },
      });

      // 3. Create the historical ExEmployeeRecord
      const exRecord = await tx.exEmployeeRecord.create({
        data: {
          tenantId,
          firstName,
          lastName,
          email: employee.email,
          phone: 'N/A',
          pan: employee.pan || 'N/A',
          designation: employee.designation || 'Member',
          department: employee.department || 'General',
          serviceStart: new Date(serviceStart),
          serviceEnd: new Date(serviceEnd),
          exitReason: exitDetails.exitReason || 'Resigned',
          techRating: techRating ?? 8,
          attitudeRating: attitudeRating ?? 8,
          conductValue: conductValue || 'Good',
          feedback: feedback || '',
          submittedBy: req.user.name || 'Direct',
          status: 'Published',
          docs: docs || undefined,
        },
      });

      // 4. Mark exit details as COMPLETED
      await tx.exitDetails.update({
        where: { id },
        data: {
          exitStatus: 'COMPLETED',
          settlementStatus: 'COMPLETED',
          ...(clearanceOverride ? {
            feedbackRemarks: JSON.stringify({
              ...parseExitRemarks(exitDetails.feedbackRemarks),
              clearanceOverride,
            }),
          } : {}),
        },
      });

      return exRecord;
    });

    // Notify connected clients
    emitToTenant(tenantId, 'employee_status_updated', { id: employee.id, status: 'EXITED' });
    emitToTenant(tenantId, 'exit_completed', { employeeId: employee.id, exitDetailsId: id });

    const licenseStats = await getLicenseStats(tenantId);

    res.json({
      message: `${employee.name} has been offboarded successfully`,
      exitRecord: {
        id: exitRecord.id,
        name: `${firstName} ${lastName}`,
        email: exitRecord.email,
        serviceStart: exitRecord.serviceStart.toISOString().split('T')[0],
        serviceEnd: exitRecord.serviceEnd.toISOString().split('T')[0],
        exitReason: exitRecord.exitReason,
        conductValue: exitRecord.conductValue,
        techRating: exitRecord.techRating,
        attitudeRating: exitRecord.attitudeRating,
        status: exitRecord.status,
      },
      licenseStats,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/exit/:id/certificate/:type
// Generate a relieving letter or service certificate PDF.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateCertificate(req, res, next) {
  try {
    const parsedParams = exitIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid exit ID', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

    const parsedType = certificateTypeSchema.safeParse(req.params);
    if (!parsedType.success) {
      return res.status(400).json({ error: 'Invalid certificate type', details: parsedType.error.issues });
    }
    const { type } = parsedType.data;

    const exitDetails = await prisma.exitDetails.findFirst({
      where: { id, tenantId: req.tenantId },
      include: {
        user: {
          select: {
            id: true, name: true, email: true, designation: true,
            department: true, employeeId: true, joinDate: true,
            tenant: { select: { companyName: true } },
          },
        },
      },
    });

    if (!exitDetails) {
      return res.status(404).json({ error: 'Exit record not found' });
    }

    const employee = exitDetails.user;
    const companyName = employee?.tenant?.companyName || 'UEIBI Organization';

    const pdfData = {
      companyName,
      employeeName: employee.name,
      employeeId: employee.employeeId || employee.id,
      designation: employee.designation || 'Member',
      department: employee.department || 'General',
      joinDate: employee.joinDate || exitDetails.resignationDate,
      lastWorkingDay: exitDetails.lastWorkingDay,
      resignationDate: exitDetails.resignationDate,
      exitReason: exitDetails.exitReason,
      authorizedSignatory: req.user.name || 'HR Department',
    };

    const typeToDocType = {
      relieving: 'RELIEVING_LETTER',
      termination: 'TERMINATION_LETTER',
      service: 'SERVICE_CERTIFICATE',
      refcheck: 'REFERENCE_CHECK',
    };

    const targetDocType = typeToDocType[type];
    const manualOverrides = req.body?.manualOverrides;
    let pdfUrl;
    let usedTemplate = null;

    // Check if dynamic template engine should be used
    try {
      if (targetDocType) {
        const dynamicTpl = await getDefaultTemplate({
          tenantId: req.tenantId,
          documentType: targetDocType,
        });

        if (dynamicTpl) {
          const resolvedTokens = await resolveTokensForEmployee({
            tenantId: req.tenantId,
            employeeId: employee.id,
            exitDetailsId: id,
            currentUser: req.user,
            documentType: targetDocType,
          });

          const rendered = await renderDocumentPdf({
            template: dynamicTpl,
            tokenValues: resolvedTokens,
            manualOverrides: manualOverrides || {},
            fileNamePrefix: type,
          });

          pdfUrl = rendered.fileUrl;
          usedTemplate = dynamicTpl;

          // Record generated document for audit
          await prisma.generatedDocument.create({
            data: {
              tenantId: req.tenantId,
              templateId: String(dynamicTpl.id).startsWith('blueprint-') ? null : dynamicTpl.id,
              documentType: targetDocType,
              fileName: rendered.fileName,
              fileUrl: rendered.fileUrl,
              fileSize: rendered.fileSize,
              targetUserId: employee.id,
              targetUserName: employee.name,
              exitDetailsId: id,
              resolvedData: rendered.view,
              manualEdits: manualOverrides || null,
              generatedBy: req.user.name || req.user.email || 'HR Department',
              templateVersion: dynamicTpl.version || 1,
            },
          }).catch((err) => {
            console.warn('[ExitController] Failed to record GeneratedDocument audit log:', err.message);
          });
        }
      }
    } catch (dynamicErr) {
      console.warn('[ExitController] Dynamic template generation failed, falling back to legacy PDFKit:', dynamicErr.message);
    }

    // Fallback to legacy generator if dynamic engine didn't produce a PDF
    if (!pdfUrl) {
      if (type === 'relieving') {
        pdfUrl = await generateRelievingLetter(pdfData);
      } else if (type === 'termination') {
        pdfUrl = await generateTerminationLetter(pdfData);
      } else if (type === 'service') {
        const exRecord = await prisma.exEmployeeRecord.findFirst({
          where: { email: employee.email, tenantId: req.tenantId },
          orderBy: { createdAt: 'desc' },
        });

        pdfData.conductValue = exRecord?.conductValue || 'Good';
        pdfData.techRating = exRecord?.techRating || 8;
        pdfData.attitudeRating = exRecord?.attitudeRating || 8;

        pdfUrl = await generateServiceCertificate(pdfData);
      } else if (type === 'refcheck') {
        const [exRecord, userWithWorkHistory] = await Promise.all([
          prisma.exEmployeeRecord.findFirst({
            where: { email: employee.email, tenantId: req.tenantId },
            orderBy: { createdAt: 'desc' },
          }),
          prisma.tenantUser.findUnique({
            where: { id: employee.id },
            include: { workHistory: true },
          }),
        ]);

        pdfData.pan = employee.pan || exRecord?.pan || null;
        pdfData.conductValue = exRecord?.conductValue || 'Good';
        pdfData.techRating = exRecord?.techRating || 8;
        pdfData.attitudeRating = exRecord?.attitudeRating || 8;
        pdfData.feedback = exRecord?.feedback || exitDetails.feedbackRemarks || '';
        pdfData.workHistory = userWithWorkHistory?.workHistory || [];

        pdfUrl = await generateReferenceCheckProfile(pdfData);
      }
    }

    // Persist URLs onto ExitDetails model
    if (type === 'relieving') {
      await prisma.exitDetails.update({
        where: { id },
        data: { relievingLetterUrl: pdfUrl },
      });
    } else if (type === 'termination') {
      const remarksObj = parseExitRemarks(exitDetails.feedbackRemarks);
      remarksObj.terminationLetterUrl = pdfUrl;
      await prisma.exitDetails.update({
        where: { id },
        data: { feedbackRemarks: JSON.stringify(remarksObj) },
      });
    } else if (type === 'service') {
      await prisma.exitDetails.update({
        where: { id },
        data: { serviceCertificateUrl: pdfUrl },
      });
    }

    const typeLabels = {
      relieving: 'Relieving letter',
      termination: 'Termination letter',
      service: 'Service certificate',
      refcheck: 'Reference check & verified profile dossier',
    };

    res.json({
      message: `${typeLabels[type] || 'Document'} generated successfully`,
      pdfUrl,
      type,
      isDynamic: Boolean(usedTemplate),
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/exit/:id/send-documents
// Sends all exit certificates (Relieving, Service, Ref-Check, Termination) and clearance details
// directly to the employee's email.
// ─────────────────────────────────────────────────────────────────────────────
export async function sendExitDocuments(req, res, next) {
  try {
    const parsedParams = exitIdParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid exit ID', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

    const parsed = sendExitDocumentsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      recipientEmail,
      includeRelieving,
      includeService,
      includeRefCheck,
      includeTermination,
      customMessage,
    } = parsed.data;

    const exitDetails = await prisma.exitDetails.findFirst({
      where: { id, tenantId: req.tenantId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            personalEmail: true,
            designation: true,
            department: true,
            employeeId: true,
            joinDate: true,
            pan: true,
            tenant: { select: { companyName: true } },
          },
        },
        clearances: true,
      },
    });

    if (!exitDetails) {
      return res.status(404).json({ error: 'Exit record not found' });
    }

    const employee = exitDetails.user;
    const companyName = employee?.tenant?.companyName || 'UEIBI Organization';
    const targetEmail = recipientEmail || employee.personalEmail || employee.email;

    if (!targetEmail) {
      return res.status(400).json({ error: 'No valid recipient email address found for this employee.' });
    }

    const pdfData = {
      companyName,
      employeeName: employee.name,
      employeeId: employee.employeeId || employee.id,
      designation: employee.designation || 'Member',
      department: employee.department || 'General',
      joinDate: employee.joinDate || exitDetails.resignationDate,
      lastWorkingDay: exitDetails.lastWorkingDay,
      resignationDate: exitDetails.resignationDate,
      exitReason: exitDetails.exitReason,
      authorizedSignatory: req.user.name || 'HR Department',
    };

    const remarksObj = parseExitRemarks(exitDetails.feedbackRemarks);
    const generatedDocs = [];

    // 1. Relieving Letter
    let relievingUrl = exitDetails.relievingLetterUrl;
    if (includeRelieving && !relievingUrl) {
      relievingUrl = await generateRelievingLetter(pdfData);
      await prisma.exitDetails.update({ where: { id }, data: { relievingLetterUrl: relievingUrl } });
    }
    if (includeRelieving && relievingUrl) {
      generatedDocs.push({ label: 'Relieving Letter', url: relievingUrl, type: 'relieving' });
    }

    // 2. Service Certificate
    let serviceUrl = exitDetails.serviceCertificateUrl;
    if (includeService && !serviceUrl) {
      const exRecord = await prisma.exEmployeeRecord.findFirst({
        where: { email: employee.email, tenantId: req.tenantId },
        orderBy: { createdAt: 'desc' },
      });
      pdfData.conductValue = exRecord?.conductValue || 'Good';
      pdfData.techRating = exRecord?.techRating || 8;
      pdfData.attitudeRating = exRecord?.attitudeRating || 8;
      serviceUrl = await generateServiceCertificate(pdfData);
      await prisma.exitDetails.update({ where: { id }, data: { serviceCertificateUrl: serviceUrl } });
    }
    if (includeService && serviceUrl) {
      generatedDocs.push({ label: 'Service Certificate', url: serviceUrl, type: 'service' });
    }

    // 3. Termination Letter (if terminated or explicitly requested)
    let terminationUrl = remarksObj.terminationLetterUrl;
    const shouldIncludeTermination = includeTermination || exitDetails.exitReason === 'Terminated';
    if (shouldIncludeTermination && !terminationUrl) {
      terminationUrl = await generateTerminationLetter(pdfData);
      remarksObj.terminationLetterUrl = terminationUrl;
    }
    if (shouldIncludeTermination && terminationUrl) {
      generatedDocs.push({ label: 'Termination Letter', url: terminationUrl, type: 'termination' });
    }

    // 4. Ref-Check Profile Dossier
    if (includeRefCheck) {
      const [exRecord, userWithWorkHistory] = await Promise.all([
        prisma.exEmployeeRecord.findFirst({
          where: { email: employee.email, tenantId: req.tenantId },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.tenantUser.findUnique({
          where: { id: employee.id },
          include: { workHistory: true },
        }),
      ]);
      pdfData.pan = employee.pan || exRecord?.pan || null;
      pdfData.conductValue = exRecord?.conductValue || 'Good';
      pdfData.techRating = exRecord?.techRating || 8;
      pdfData.attitudeRating = exRecord?.attitudeRating || 8;
      pdfData.feedback = exRecord?.feedback || remarksObj.generalRemarks || '';
      pdfData.workHistory = userWithWorkHistory?.workHistory || [];
      const refCheckUrl = await generateReferenceCheckProfile(pdfData);
      generatedDocs.push({ label: 'Reference Check & Verified Profile Dossier', url: refCheckUrl, type: 'refcheck' });
    }

    // Clearance settlement files (e.g. Finance F&F slip), from the clearance
    // rows so every clearance an exit has is covered.
    const [withRows] = await ensureClearanceRows([exitDetails]);
    const clearanceRows = [...withRows.clearances].sort((a, b) => a.sortOrder - b.sortOrder);
    const clearanceFiles = clearanceRows
      .filter((c) => c.fileUrl)
      .map((c) => ({ dept: c.label, fileName: c.fileName || `${c.key}_clearance_slip.pdf`, url: c.fileUrl }));
    const pendingClearances = clearanceRows.filter((c) => c.status !== 'CLEARED').map((c) => c.label);

    // Absolute links: an email has no app to resolve "/uploads/..." against.
    const linkFor = (url, filename) => publicUploadUrl(url, { download: true, filename }) || url;
    const docFileName = (d) => `${d.label.replace(/[^A-Za-z0-9]+/g, '_')}_${(employee.name || 'Employee').replace(/[^A-Za-z0-9]+/g, '_')}.pdf`;

    const formattedLastDay = new Date(exitDetails.lastWorkingDay).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const isTerminated = exitDetails.exitReason === 'Terminated';
    const emailSubject = isTerminated
      ? `Important: Formal Termination Notice & Separation Documents | ${companyName}`
      : `Official Relieving & Experience Documents | ${companyName}`;

    const docLinksHtml = generatedDocs.map(d => `
      <li style="margin-bottom: 8px;">
        <strong>${d.label}:</strong> <a href="${linkFor(d.url, docFileName(d))}" style="color: #4f46e5; font-weight: 600; text-decoration: underline;" target="_blank">Download Document</a>
      </li>
    `).join('');

    const clearanceFilesHtml = clearanceFiles.length > 0 ? `
      <h4 style="color: #374151; margin-top: 16px; margin-bottom: 8px;">Department Clearance & Settlement Attachments:</h4>
      <ul>
        ${clearanceFiles.map(f => `<li style="margin-bottom: 6px;"><strong>${f.dept}:</strong> <a href="${linkFor(f.url, f.fileName)}" style="color: #059669; font-weight: 600;" target="_blank">${f.fileName} (Download)</a></li>`).join('')}
      </ul>
    ` : '';

    const html = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; color: #1f2937; line-height: 1.6; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
        <div style="border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="color: #111827; margin: 0;">${companyName}</h2>
          <p style="color: #6b7280; font-size: 13px; margin: 4px 0 0;">Human Resources & People Operations</p>
        </div>

        <p>Dear <strong>${employee.name}</strong>,</p>

        <p>
          This is an official communication regarding the completion of your offboarding process with <strong>${companyName}</strong>. 
          Your effective separation date was <strong>${formattedLastDay}</strong>.
        </p>

        ${customMessage ? `<div style="background: #f3f4f6; border-left: 4px solid #4f46e5; padding: 12px 16px; margin: 16px 0; border-radius: 4px;"><p style="margin: 0; font-size: 13px; color: #374151;">${customMessage}</p></div>` : ''}

        <p>${pendingClearances.length === 0
          ? `All department clearances (${clearanceRows.map((c) => c.label).join(', ')}) have been completed.`
          : 'Your offboarding has been processed.'} Your official separation documents are attached to this email and can also be downloaded below:</p>

        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <h4 style="margin-top: 0; color: #111827; margin-bottom: 12px;">Official Separation Documents</h4>
          <ul style="padding-left: 20px; margin-bottom: 0;">
            ${docLinksHtml}
          </ul>
          ${clearanceFilesHtml}
        </div>

        <p style="font-size: 13px; color: #4b5563;">
          Please retain these documents safely for your career records, tax filing, and future employment reference. If you have questions regarding your Full & Final (F&F) settlement or PF/ESIC transfer, please reach out to our Finance & HR team.
        </p>

        <p style="margin-top: 24px;">
          Sincerely,<br />
          <strong>${req.user.name || 'HR Operations Team'}</strong><br />
          ${companyName}
        </p>

        <div style="margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 12px; font-size: 11px; color: #9ca3af; text-align: center;">
          This is an automated separation notification from the enterprise workforce portal.
        </div>
      </div>
    `;

    const text = `Dear ${employee.name},\n\nYour separation process with ${companyName} has been completed effective ${formattedLastDay}.\n\nYour official documents (also attached):\n${generatedDocs.map(d => `- ${d.label}: ${linkFor(d.url, docFileName(d))}`).join('\n')}\n\nSincerely,\nHR Operations Team\n${companyName}`;

    // Attach the documents themselves so they do not depend on the links.
    const attachments = buildAttachments([
      ...generatedDocs.map((d) => ({ url: d.url, filename: docFileName(d) })),
      ...clearanceFiles.map((f) => ({ url: f.url, filename: `${f.dept.replace(/[^A-Za-z0-9]+/g, '_')}_${f.fileName}` })),
    ]);

    const mail = await sendMail({
      to: targetEmail,
      subject: emailSubject,
      html,
      text,
      event: 'EMPLOYEE_EXIT_DOCUMENTS',
      attachments,
    });

    // sendMail never throws; report a failed send instead of claiming success.
    if (mail?.status === 'FAILED') {
      return res.status(502).json({ error: `The email to ${targetEmail} could not be sent: ${mail.error || 'mail server error'}. Please try again.` });
    }

    // Save timestamp of email sent
    remarksObj.documentsSentAt = new Date().toISOString();
    remarksObj.documentsSentTo = targetEmail;
    await prisma.exitDetails.update({
      where: { id },
      data: { feedbackRemarks: JSON.stringify(remarksObj) },
    });

    emitToTenant(req.tenantId, 'exit_documents_sent', {
      exitDetailsId: id,
      employeeId: employee.id,
      recipientEmail: targetEmail,
      documentsCount: generatedDocs.length,
    });

    res.json({
      message: `Exit documents successfully sent to ${targetEmail}`,
      recipientEmail: targetEmail,
      documents: generatedDocs,
      clearanceFiles,
      attachedCount: attachments.length,
    });
  } catch (err) {
    next(err);
  }
}
