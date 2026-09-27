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
import { getLicenseStats } from '../services/license.service.js';
import { generateRelievingLetter, generateServiceCertificate } from '../services/pdf.service.js';
import {
  initiateExitSchema,
  exitInterviewSchema,
  clearanceSchema,
  completeExitSchema,
  exitIdParamSchema,
  employeeIdParamSchema,
  certificateTypeSchema,
} from '../validations/exit.schema.js';

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

    const { department, cleared } = parsed.data;

    const exitDetails = await prisma.exitDetails.findFirst({
      where: { id, tenantId: req.tenantId },
    });

    if (!exitDetails) {
      return res.status(404).json({ error: 'Exit record not found' });
    }

    if (exitDetails.exitStatus === 'COMPLETED') {
      return res.status(409).json({ error: 'Exit process is already completed' });
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
    } else if (exitDetails.exitStatus === 'INITIATED' || exitDetails.exitStatus === 'INTERVIEW_DONE') {
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
    });

    res.json({
      message: allCleared
        ? 'All departments cleared! Ready for final exit completion.'
        : `${department.toUpperCase()} clearance ${cleared ? 'approved' : 'revoked'}`,
      exitDetails: updated,
      allCleared,
    });
  } catch (err) {
    next(err);
  }
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

    const exitDetails = await prisma.exitDetails.findFirst({
      where: { userId: employeeId, tenantId: req.tenantId },
      include: {
        user: {
          select: { id: true, name: true, email: true, designation: true, department: true, employeeId: true, joinDate: true, profilePhoto: true },
        },
      },
    });

    if (!exitDetails) {
      return res.status(404).json({ error: 'No exit process found for this employee' });
    }

    // Build clearance summary
    const clearances = [
      { dept: 'IT', cleared: exitDetails.itCleared, clearedAt: exitDetails.itClearedAt, clearedBy: exitDetails.itClearedBy },
      { dept: 'HR', cleared: exitDetails.hrCleared, clearedAt: exitDetails.hrClearedAt, clearedBy: exitDetails.hrClearedBy },
      { dept: 'Finance', cleared: exitDetails.financeCleared, clearedAt: exitDetails.financeClearedAt, clearedBy: exitDetails.financeClearedBy },
      { dept: 'Manager', cleared: exitDetails.managerCleared, clearedAt: exitDetails.managerClearedAt, clearedBy: exitDetails.managerClearedBy },
    ];

    res.json({
      exitDetails,
      clearances,
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
// GET /api/exit/pending
// List all in-progress exit processes for the current tenant.
// ─────────────────────────────────────────────────────────────────────────────
export async function listPendingExits(req, res, next) {
  try {
    const tenantId = req.tenantId;

    const exits = await prisma.exitDetails.findMany({
      where: {
        tenantId,
        exitStatus: { not: 'COMPLETED' },
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, designation: true, department: true, employeeId: true, profilePhoto: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with clearance progress
    const enriched = exits.map(exit => {
      const cleared = [exit.itCleared, exit.hrCleared, exit.financeCleared, exit.managerCleared]
        .filter(Boolean).length;
      return {
        ...exit,
        clearanceProgress: { total: 4, completed: cleared, percentage: Math.round((cleared / 4) * 100) },
      };
    });

    res.json({ exits: enriched, total: enriched.length });
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

    const nameParts = (employee.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const {
      serviceStart, serviceEnd, techRating, attitudeRating,
      conductValue, feedback, docs,
    } = parsed.data;

    // Atomic transaction: deactivate + re-assign subordinates + create exit record + update exit details
    const exitRecord = await prisma.$transaction(async (tx) => {
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
    } else {
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
    }

    res.json({
      message: `${type === 'relieving' ? 'Relieving letter' : 'Service certificate'} generated successfully`,
      pdfUrl,
    });
  } catch (err) {
    next(err);
  }
}
