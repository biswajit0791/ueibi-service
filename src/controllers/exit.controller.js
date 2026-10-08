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

const CLEARANCE_LEADERSHIP_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];
const CLEARANCE_KEYS = ['it', 'hr', 'finance', 'manager'];
const CLEARANCE_LABELS = { it: 'IT', hr: 'HR', finance: 'Finance', manager: 'Manager' };

// Exits created from this moment on cannot be completed while a clearance is
// pending (HR/Admin may override with a reason). Exits already in flight when
// the rule shipped are exempt rather than blocked retroactively.
const CLEARANCE_ENFORCED_FROM = new Date('2026-10-09T00:00:00+05:30');

/**
 * Whether `user` may approve or revoke `department` clearance for an exit.
 * The single source of truth for both the PATCH guard and the `canAct` flag
 * the UI uses to decide which clearance cards are actionable.
 *
 * @param {{ id: string, role: string, department?: string }} user
 * @param {'it'|'hr'|'finance'|'manager'} department
 * @param {string|null|undefined} exitingManagerId - managerId of the exiting employee
 */
function canActOnClearance(user, department, exitingManagerId) {
  const role = String(user?.role || '').toUpperCase();
  if (CLEARANCE_LEADERSHIP_ROLES.includes(role)) return true;
  switch (department) {
    case 'finance': return role === 'FINANCE';
    case 'manager': return !!exitingManagerId && exitingManagerId === user.id;
    case 'it': return String(user?.department || '').toLowerCase() === 'it';
    default: return false;
  }
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
      select: { id: true, name: true, email: true, status: true },
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

    const exitDetails = await prisma.exitDetails.create({
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
// Department head approves their clearance. Advances to PENDING_CLEARANCE
// or ALL_CLEARED when every department is done.
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

    const { department, cleared, remarks, fileUrl, fileName } = parsed.data;

    const exitDetails = await prisma.exitDetails.findFirst({
      where: { id, tenantId: req.tenantId },
    });

    if (!exitDetails) {
      return res.status(404).json({ error: 'Exit record not found' });
    }

    if (exitDetails.exitStatus === 'COMPLETED') {
      return res.status(409).json({ error: 'Exit process is already completed' });
    }

    // ── Department Role Enforcement ──
    const exitingUser = await prisma.tenantUser.findUnique({
      where: { id: exitDetails.userId },
      select: { managerId: true },
    });
    if (!canActOnClearance(req.user, department, exitingUser?.managerId)) {
      const denied = {
        finance: 'Only Finance department personnel or HR/Admin may approve Finance clearance.',
        manager: "Only the employee's direct manager or HR/Admin may approve Manager clearance.",
        it: 'Only IT department personnel or HR/Admin may approve IT clearance.',
        hr: 'Only HR or Admin personnel may approve HR clearance.',
      };
      return res.status(403).json({ error: denied[department] });
    }

    // Build update data for the specific department
    const now = new Date();
    const actorName = req.user.name || req.user.email;
    const updateData = {};

    switch (department) {
      case 'it':
        updateData.itCleared = cleared;
        updateData.itClearedAt = cleared ? now : null;
        updateData.itClearedBy = cleared ? actorName : null;
        break;
      case 'hr':
        updateData.hrCleared = cleared;
        updateData.hrClearedAt = cleared ? now : null;
        updateData.hrClearedBy = cleared ? actorName : null;
        break;
      case 'finance':
        updateData.financeCleared = cleared;
        updateData.financeClearedAt = cleared ? now : null;
        updateData.financeClearedBy = cleared ? actorName : null;
        break;
      case 'manager':
        updateData.managerCleared = cleared;
        updateData.managerClearedAt = cleared ? now : null;
        updateData.managerClearedBy = cleared ? actorName : null;
        break;
    }

    // Store clearance details (remarks, uploaded files such as Finance F&F statement)
    let remarksObj = {};
    try {
      remarksObj = JSON.parse(exitDetails.feedbackRemarks || '{}');
      if (typeof remarksObj !== 'object' || !remarksObj || Array.isArray(remarksObj)) {
        remarksObj = { generalRemarks: exitDetails.feedbackRemarks || '' };
      }
    } catch (e) {
      remarksObj = { generalRemarks: exitDetails.feedbackRemarks || '' };
    }

    if (!remarksObj.clearances) remarksObj.clearances = {};
    remarksObj.clearances[department] = {
      cleared,
      remarks: remarks || '',
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      clearedBy: actorName,
      clearedAt: now.toISOString(),
    };
    updateData.feedbackRemarks = JSON.stringify(remarksObj);

    // Check if all departments are now cleared (merge current state with this update)
    const mergedState = {
      itCleared: updateData.itCleared !== undefined ? updateData.itCleared : exitDetails.itCleared,
      hrCleared: updateData.hrCleared !== undefined ? updateData.hrCleared : exitDetails.hrCleared,
      financeCleared: updateData.financeCleared !== undefined ? updateData.financeCleared : exitDetails.financeCleared,
      managerCleared: updateData.managerCleared !== undefined ? updateData.managerCleared : exitDetails.managerCleared,
    };

    const allCleared = mergedState.itCleared && mergedState.hrCleared &&
                       mergedState.financeCleared && mergedState.managerCleared;

    if (allCleared) {
      updateData.exitStatus = 'ALL_CLEARED';
    } else if (exitDetails.exitStatus === 'INITIATED' || exitDetails.exitStatus === 'INTERVIEW_DONE' || exitDetails.exitStatus === 'ALL_CLEARED') {
      // ALL_CLEARED is included so a revoke after full clearance reopens the exit.
      updateData.exitStatus = 'PENDING_CLEARANCE';
    }

    const updated = await prisma.exitDetails.update({
      where: { id },
      data: updateData,
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
        : `${department.toUpperCase()} clearance ${cleared ? 'approved' : 'revoked'}`,
      exitDetails: updated,
      clearanceDetails: remarksObj.clearances,
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

    const exitDetails = await prisma.exitDetails.findFirst({
      where: { userId: employeeId, tenantId: req.tenantId },
      include: {
        user: {
          select: { id: true, name: true, email: true, personalEmail: true, designation: true, department: true, employeeId: true, joinDate: true, profilePhoto: true, managerId: true },
        },
      },
    });

    if (!exitDetails) {
      return res.status(404).json({ error: 'No exit process found for this employee' });
    }

    const remarksObj = parseExitRemarks(exitDetails.feedbackRemarks);
    const cd = remarksObj.clearances || {};
    const exitingManagerId = exitDetails.user?.managerId;

    // Build clearance summary with attachments and remarks
    const clearances = CLEARANCE_KEYS.map((key) => ({
      dept: CLEARANCE_LABELS[key],
      key,
      cleared: exitDetails[`${key}Cleared`],
      clearedAt: exitDetails[`${key}ClearedAt`],
      clearedBy: exitDetails[`${key}ClearedBy`],
      remarks: cd[key]?.remarks || '',
      fileUrl: cd[key]?.fileUrl || null,
      fileName: cd[key]?.fileName || null,
      canAct: exitDetails.exitStatus !== 'COMPLETED' && canActOnClearance(req.user, key, exitingManagerId),
    }));

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
      progress: {
        total: 4,
        completed: clearances.filter(c => c.cleared).length,
        percentage: Math.round((clearances.filter(c => c.cleared).length / 4) * 100),
      },
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
      include: {
        user: {
          select: { id: true, name: true, email: true, personalEmail: true, designation: true, department: true, employeeId: true, profilePhoto: true, managerId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = exits.map((exit) => enrichExitForList(exit, req.user));

    res.json({ exits: enriched, total: enriched.length });
  } catch (err) {
    next(err);
  }
}

// Clearance progress, per-department details/attachments and the caller's
// `canAct` flag, in the shape the exit tracker cards consume.
function enrichExitForList(exit, user) {
  const remarksObj = parseExitRemarks(exit.feedbackRemarks);
  const cd = remarksObj.clearances || {};
  const exitingManagerId = exit.user?.managerId;
  const clearances = CLEARANCE_KEYS.map((key) => ({
    dept: CLEARANCE_LABELS[key],
    key,
    cleared: exit[`${key}Cleared`],
    by: exit[`${key}ClearedBy`],
    at: exit[`${key}ClearedAt`],
    remarks: cd[key]?.remarks || '',
    fileUrl: cd[key]?.fileUrl || null,
    fileName: cd[key]?.fileName || null,
    canAct: exit.exitStatus !== 'COMPLETED' && canActOnClearance(user, key, exitingManagerId),
  }));
  const clearedCount = clearances.filter(c => c.cleared).length;

  return {
    ...exit,
    clearances,
    clearanceDetails: cd,
    documents: {
      relievingLetterUrl: exit.relievingLetterUrl || null,
      serviceCertificateUrl: exit.serviceCertificateUrl || null,
      terminationLetterUrl: remarksObj.terminationLetterUrl || null,
      documentsSentAt: remarksObj.documentsSentAt || null,
      documentsSentTo: remarksObj.documentsSentTo || null,
    },
    clearanceProgress: { total: 4, completed: clearedCount, percentage: Math.round((clearedCount / 4) * 100) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/exit/clearances/inbox
// Open exits on which the caller holds at least one clearance — e.g. a
// reporting manager sees their direct reports' exits. Open to every role:
// what is returned is decided per record, and only to people who must act.
// ─────────────────────────────────────────────────────────────────────────────
export async function listMyClearanceInbox(req, res, next) {
  try {
    const role = String(req.user.role || '').toUpperCase();
    const isLeadership = CLEARANCE_LEADERSHIP_ROLES.includes(role);

    // Narrow at the query where the rule allows; canActOnClearance below is
    // still the authority on what the caller may do.
    const where = { tenantId: req.tenantId, exitStatus: { not: 'COMPLETED' } };
    if (!isLeadership && role !== 'FINANCE') {
      where.user = { managerId: req.user.id };
    }

    const exits = await prisma.exitDetails.findMany({
      where,
      include: {
        user: {
          // Deliberately narrower than the HR tracker: no personal email.
          select: { id: true, name: true, email: true, designation: true, department: true, employeeId: true, profilePhoto: true, managerId: true },
        },
      },
      orderBy: { lastWorkingDay: 'asc' },
    });

    const items = exits
      .map((exit) => {
        const { feedbackRemarks, ...rest } = enrichExitForList(exit, req.user);
        return rest;
      })
      .filter((exit) => exit.clearances.some((c) => c.canAct));

    const pendingForMe = items.reduce(
      (n, exit) => n + exit.clearances.filter((c) => c.canAct && !c.cleared).length,
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
    const pendingClearances = CLEARANCE_KEYS.filter((key) => !exitDetails[`${key}Cleared`]);
    const clearanceRuleApplies = exitDetails.createdAt >= CLEARANCE_ENFORCED_FROM;
    const { overrideClearances, overrideReason } = parsed.data;
    let clearanceOverride = null;

    if (clearanceRuleApplies && pendingClearances.length > 0) {
      const pendingLabels = pendingClearances.map((key) => CLEARANCE_LABELS[key]);
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

    let pdfUrl;
    if (type === 'relieving') {
      pdfUrl = await generateRelievingLetter(pdfData);
      await prisma.exitDetails.update({
        where: { id },
        data: { relievingLetterUrl: pdfUrl },
      });
    } else if (type === 'termination') {
      pdfUrl = await generateTerminationLetter(pdfData);
      const remarksObj = parseExitRemarks(exitDetails.feedbackRemarks);
      remarksObj.terminationLetterUrl = pdfUrl;
      await prisma.exitDetails.update({
        where: { id },
        data: { feedbackRemarks: JSON.stringify(remarksObj) },
      });
    } else if (type === 'service') {
      // Fetch ex-employee record for ratings if available
      const exRecord = await prisma.exEmployeeRecord.findFirst({
        where: { email: employee.email, tenantId: req.tenantId },
        orderBy: { createdAt: 'desc' },
      });

      pdfData.conductValue = exRecord?.conductValue || 'Good';
      pdfData.techRating = exRecord?.techRating || 8;
      pdfData.attitudeRating = exRecord?.attitudeRating || 8;

      pdfUrl = await generateServiceCertificate(pdfData);
      await prisma.exitDetails.update({
        where: { id },
        data: { serviceCertificateUrl: pdfUrl },
      });
    } else if (type === 'refcheck') {
      // Reference Check & Verified Profile Dossier for new employer
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

    // Include any attached clearance settlement files (e.g. from Finance)
    const clearanceFiles = [];
    if (remarksObj.clearances) {
      for (const [deptKey, cData] of Object.entries(remarksObj.clearances)) {
        if (cData.fileUrl) {
          clearanceFiles.push({
            dept: deptKey.toUpperCase(),
            fileName: cData.fileName || `${deptKey}_clearance_slip.pdf`,
            url: cData.fileUrl,
          });
        }
      }
    }

    const formattedLastDay = new Date(exitDetails.lastWorkingDay).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const isTerminated = exitDetails.exitReason === 'Terminated';
    const emailSubject = isTerminated
      ? `Important: Formal Termination Notice & Separation Documents | ${companyName}`
      : `Official Relieving & Experience Documents | ${companyName}`;

    const docLinksHtml = generatedDocs.map(d => `
      <li style="margin-bottom: 8px;">
        <strong>${d.label}:</strong> <a href="${d.url}" style="color: #4f46e5; font-weight: 600; text-decoration: underline;" target="_blank">Download Document</a>
      </li>
    `).join('');

    const clearanceFilesHtml = clearanceFiles.length > 0 ? `
      <h4 style="color: #374151; margin-top: 16px; margin-bottom: 8px;">Department Clearance & Settlement Attachments:</h4>
      <ul>
        ${clearanceFiles.map(f => `<li style="margin-bottom: 6px;"><strong>${f.dept}:</strong> <a href="${f.url}" style="color: #059669; font-weight: 600;" target="_blank">${f.fileName} (Download)</a></li>`).join('')}
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

        <p>All mandatory department clearances (IT, Finance, HR, Manager) have been finalized. Below are your official certified separation documents:</p>

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

    const text = `Dear ${employee.name},\n\nYour separation process with ${companyName} has been completed effective ${formattedLastDay}.\n\nYour official documents:\n${generatedDocs.map(d => `- ${d.label}: ${d.url}`).join('\n')}\n\nSincerely,\nHR Operations Team\n${companyName}`;

    await sendMail({
      to: targetEmail,
      subject: emailSubject,
      html,
      text,
      event: 'EMPLOYEE_EXIT_DOCUMENTS',
    });

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
    });
  } catch (err) {
    next(err);
  }
}
