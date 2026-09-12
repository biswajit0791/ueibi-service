import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { emitToTenant } from '../lib/socket.js';
import {
  updateExEmployeeSchema,
  updateNonJoinerSchema,
  inviteEmployeeSchema,
  onboardEmployeeSchema,
  updateEmployeeSchema,
  createExEmployeeSchema,
  createNonJoinerSchema,
  exitEmployeeSchema,
  bulkExEmployeeSchema,
  bulkNonJoinerSchema,
} from '../validations/employee.schema.js';
import { env } from '../config/env.js';
import { canCreateRole, getAllowedRoles } from '../lib/roleHierarchy.js';
import { validatePasswordStrength } from '../lib/passwordPolicy.js';
import { getLicenseStats, assertLicenseAvailable } from '../services/license.service.js';

export async function inviteEmployee(req, res, next) {
  try {
    const parsed = inviteEmployeeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { email, name, role, designation, department, band, managerId, joinDate, phone, pan, dob, feedbackRemarks } = parsed.data;

    const tenantId = req.tenantId;

    // ── Role-creation authorization ───────────────────────────────────────────
    // Determine the target role (default EMPLOYEE for backward compatibility).
    const targetRole = (role || 'EMPLOYEE').toUpperCase();

    // Validate the target role is a known UserRole value.
    const validRoles = [
      'SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE',
      'MANAGER', 'EMPLOYEE', 'STUDENT', 'MENTOR',
    ];
    if (!validRoles.includes(targetRole)) {
      return res.status(400).json({ error: `Invalid role: ${targetRole}` });
    }

    // Backend is the security authority — check creator permission.
    const creatorRole = req.user.role;
    if (!canCreateRole(creatorRole, targetRole)) {
      return res.status(403).json({
        error: `Forbidden: ${creatorRole} cannot assign role ${targetRole}`,
        allowedRoles: getAllowedRoles(creatorRole),
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Check duplicate
    const existing = await prisma.tenantUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email address already exists' });
    }

    // ── Atomic license capacity check ────────────────────────────────────────
    // Using a Prisma interactive transaction ensures the count() and the
    // subsequent create() are serialized, preventing race conditions when two
    // admins invite employees simultaneously at the last available slot.

    // Validate the reporting manager (if supplied) belongs to this tenant.
    let resolvedManagerId = null;
    if (managerId) {
      const mgr = await prisma.tenantUser.findFirst({
        where: { id: managerId, tenantId, isDeleted: false },
        select: { id: true },
      });
      if (!mgr) {
        return res.status(400).json({ error: 'Selected reporting manager was not found in this organization' });
      }
      resolvedManagerId = mgr.id;
    }

    // Generate temp password — 12 hex chars (~48 bits) plus a prefix.
    const tempPassword = 'UEIBI-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Safely parse date fields
    const parsedJoinDate = joinDate ? (() => {
      const d = new Date(joinDate);
      return isNaN(d.getTime()) ? new Date() : d;
    })() : new Date();

    const parsedDob = dob ? (() => {
      const trimmed = String(dob).trim();
      if (/^\d{4}$/.test(trimmed)) return new Date(`${trimmed}-01-01T00:00:00.000Z`);
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? null : d;
    })() : null;

    // Atomic transaction: capacity check + create to prevent race conditions
    const user = await prisma.$transaction(async (tx) => {
      // Re-check license inside the transaction (prevents double-booking)
      await assertLicenseAvailable(tx, tenantId);

      return tx.tenantUser.create({
        data: {
          tenantId,
          email: email.trim().toLowerCase(),
          passwordHash,
          name: name.trim(),
          role: targetRole, // validated & authorized above
          status: 'INVITED',
          mustChangePassword: true,
          designation: designation ? designation.trim() : 'Member',
          department: department ? department.trim() : 'General',
          band: band || undefined,
          managerId: resolvedManagerId,
          joinDate: parsedJoinDate,
          phone: phone ? phone.trim() : null,
          pan: pan ? pan.trim().toUpperCase() : null,
          dob: parsedDob,
          remarks: feedbackRemarks || null,
        },
      });
    });

    // Send invitation email
    const subject = `Welcome to UEIBI - Invitation to join ${tenant.companyName}`;
    const text = `Hello ${name},\n\nYou have been invited to join the ${tenant.companyName} workspace on UEIBI.\n\nYour temporary login credentials are:\nEmail: ${email}\nPassword: ${tempPassword}\n\nPlease log in and complete your onboarding profile here: ${env.frontendOrigin}/login`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; line-height: 1.6;">
        <h2 style="color: #4f46e5;">Welcome to UEIBI</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>You have been invited to join the <strong>${tenant.companyName}</strong> workspace on the UEIBI Employee Registry portal.</p>
        <div style="background-color: #f3f4f6; border-left: 4px solid #4f46e5; padding: 15px; margin: 20px 0;">
          <p style="margin: 0 0 8px 0;"><strong>Your Temporary Credentials:</strong></p>
          <p style="margin: 0 0 4px 0;">Email: <code>${email}</code></p>
          <p style="margin: 0;">Password: <code>${tempPassword}</code></p>
        </div>
        <p>Please log in with these temporary credentials to complete your onboarding profile:</p>
        <a href="${env.frontendOrigin}/login" style="display: inline-block; background-color: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 15px 0;">Log In & Complete Profile</a>
        <p style="color: #6b7280; font-size: 13px;">For security reasons, you will be required to change your password upon your first login.</p>
      </div>
    `;

    await sendMail({
      to: email,
      subject,
      text,
      html,
      event: 'EMPLOYEE_INVITED',
    });

    // Fetch updated license stats to return in response
    const licenseStats = await getLicenseStats(tenantId);

    res.status(201).json({
      message: 'Employee invited successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
      },
      licenseStats,
    });
  } catch (err) {
    // Propagate structured license errors as HTTP 400
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code || undefined,
        details: err.details || undefined,
      });
    }
    next(err);
  }
}
export async function onboardEmployee(req, res, next) {
  try {
    const parsed = onboardEmployeeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      newPassword,
      phone,
      pan,
      aadhaar,
      dob,
      joinDate,
      gender,
      bloodGroup,
      personalEmail,
      emergencyContact,
      uan,
      esic,
      bankDetails,
      workHistory,
      docs,
    } = parsed.data;

    const pwCheck = validatePasswordStrength(newPassword);
    if (!pwCheck.ok) {
      return res.status(400).json({ error: pwCheck.message });
    }

    const userId = req.user.id;

    const user = await prisma.tenantUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Onboarding is a one-time flow: only an INVITED user (or one still flagged
    // to change their password) may run it. An already-onboarded ACTIVE user
    // must use the normal profile / change-password endpoints instead.
    if (user.status !== 'INVITED' && !user.mustChangePassword) {
      return res.status(409).json({ error: 'Onboarding has already been completed for this account' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Update user profile details
      const u = await tx.tenantUser.update({
        where: { id: userId },
        data: {
          passwordHash: newHash,
          phone: phone || undefined,
          pan: pan ? pan.toUpperCase() : undefined,
          aadhaar: aadhaar || undefined,
          dob: dob ? new Date(dob) : undefined,
          joinDate: joinDate ? new Date(joinDate) : undefined,
          gender: gender || undefined,
          bloodGroup: bloodGroup || undefined,
          personalEmail: personalEmail || undefined,
          emergencyContact: emergencyContact || undefined,
          uan: uan || undefined,
          esic: esic || undefined,
          docs: docs || undefined,
          status: 'ACTIVE',
          mustChangePassword: false,
        },
      });

      // 2. Upsert bank details if provided
      if (bankDetails) {
        await tx.bankDetails.upsert({
          where: { userId },
          update: {
            bankName: bankDetails.bankName,
            accountNumber: bankDetails.accountNumber,
            ifscCode: bankDetails.ifscCode,
            branchName: bankDetails.branchName,
          },
          create: {
            userId,
            bankName: bankDetails.bankName,
            accountNumber: bankDetails.accountNumber,
            ifscCode: bankDetails.ifscCode,
            branchName: bankDetails.branchName,
          },
        });
      }

      // 3. Create work history entries if provided (refresh list to avoid duplicates)
      if (workHistory && Array.isArray(workHistory) && workHistory.length > 0) {
        await tx.workHistory.deleteMany({ where: { userId } });
        await Promise.all(
          workHistory.map((history) => {
            const start = new Date(history.startDate);
            // A "current" job (isCurrent, or no end date given) is stored with a
            // null endDate rather than crashing on `new Date(undefined)`.
            const end = (history.isCurrent || !history.endDate) ? null : new Date(history.endDate);
            return tx.workHistory.create({
              data: {
                userId,
                companyName: history.companyName,
                designation: history.designation,
                startDate: start,
                endDate: end,
                reasonForExit: history.reasonForExit || null,
              },
            });
          })
        );
      }

      return u;
    });

    // Fetch full updated user with relations for socket payload
    const fullUser = await prisma.tenantUser.findUnique({
      where: { id: updated.id },
      include: { bankDetails: true, workHistory: true },
    });

    // Emit live status update to all HR/admins in this tenant
    emitToTenant(user.tenantId, 'employee_status_updated', {
      id: fullUser.id,
      status: fullUser.status,
      phone: fullUser.phone,
      pan: fullUser.pan,
      aadhaar: fullUser.aadhaar,
      dob: fullUser.dob,
      joinDate: fullUser.joinDate,
      gender: fullUser.gender,
      docs: fullUser.docs,
      bankDetails: fullUser.bankDetails,
      workHistory: fullUser.workHistory,
    });

    res.json({
      message: 'Onboarding completed successfully',
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        status: updated.status,
        mustChangePassword: updated.mustChangePassword,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listEmployees(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { search, role, status } = req.query || {};

    const where = { tenantId, isDeleted: false };

    if (role) {
      where.role = role;
    }
    if (status) {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const isPrivileged = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user.role);

    const select = isPrivileged
      ? {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          department: true,
          designation: true,
          band: true,
          managerId: true,
          joinDate: true,
          createdAt: true,
          phone: true,
          pan: true,
          aadhaar: true,
          dob: true,
          gender: true,
          bloodGroup: true,
          personalEmail: true,
          emergencyContact: true,
          uan: true,
          esic: true,
          docs: true,
          bankDetails: {
            select: {
              bankName: true,
              accountNumber: true,
              ifscCode: true,
              branchName: true,
            },
          },
          workHistory: {
            select: {
              id: true,
              companyName: true,
              designation: true,
              startDate: true,
              endDate: true,
              reasonForExit: true,
            },
          },
        }
      : {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          department: true,
          designation: true,
          band: true,
          managerId: true,
          joinDate: true,
          createdAt: true,
        };

    const items = await prisma.tenantUser.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select,
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

// ── License Statistics Endpoint ──────────────────────────────────────────────

/**
 * GET /api/employees/stats
 * Returns real-time license capacity and employee category counts for the
 * authenticated user's tenant. Used to drive the dashboard metric cards.
 */
export async function getEmployeeStats(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const stats = await getLicenseStats(tenantId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

export async function listExEmployees(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const records = await prisma.exEmployeeRecord.findMany({
      where: { tenantId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });

    const items = records.map(r => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      email: r.email,
      phone: r.phone,
      pan: r.pan,
      dob: r.dob,
      designation: r.designation,
      department: r.department,
      createdDate: r.createdAt.toISOString().split('T')[0],
      submittedBy: r.submittedBy,
      serviceStart: r.serviceStart.toISOString().split('T')[0],
      serviceEnd: r.serviceEnd.toISOString().split('T')[0],
      exitReason: r.exitReason,
      conductValue: r.conductValue,
      rating: Math.round(((r.techRating + r.attitudeRating) / 2) * 10) / 10,
      techRating: r.techRating,
      attitudeRating: r.attitudeRating,
      status: r.status,
      feedback: r.feedback,
      docs: r.docs || [],
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

export async function addExEmployee(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = createExEmployeeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      firstName,
      lastName,
      email,
      phone,
      pan,
      dob,
      designation,
      department,
      serviceStart,
      serviceEnd,
      exitReason,
      techRating,
      attitudeRating,
      conductValue,
      feedback,
      docs,
    } = parsed.data;

    // ── Auto-deactivate matching TenantUser to free the license slot ──────────
    // If the ex-employee being registered is also still active as a TenantUser
    // in this tenant (matched by email or PAN), automatically transition them
    // to EXITED + isDeleted=true so the license slot is released immediately.
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPan = pan.trim().toUpperCase();

    const matchingTenantUser = await prisma.tenantUser.findFirst({
      where: {
        tenantId,
        isDeleted: false,
        status: { in: ['ACTIVE', 'INVITED'] },
        OR: [
          { email: normalizedEmail },
          ...(normalizedPan ? [{ pan: normalizedPan }] : []),
        ],
      },
      select: { id: true, managerId: true },
    });

    const record = await prisma.$transaction(async (tx) => {
      // 1. Soft-deactivate the TenantUser if found (frees the license slot)
      if (matchingTenantUser) {
        await tx.tenantUser.update({
          where: { id: matchingTenantUser.id },
          data: { isDeleted: true, status: 'EXITED' },
        });
        // Re-assign any direct reports to the departing user's own manager
        await tx.tenantUser.updateMany({
          where: { managerId: matchingTenantUser.id, tenantId },
          data: { managerId: matchingTenantUser.managerId ?? null },
        });
      }

      // 2. Create the ExEmployeeRecord
      return tx.exEmployeeRecord.create({
        data: {
          tenantId,
          firstName,
          lastName,
          email: normalizedEmail,
          phone,
          pan: normalizedPan,
          dob: dob ? String(dob) : null,
          designation,
          department,
          serviceStart: new Date(serviceStart),
          serviceEnd: new Date(serviceEnd),
          exitReason: exitReason || 'Resigned',
          techRating: techRating ?? 8,
          attitudeRating: attitudeRating ?? 8,
          conductValue: conductValue || 'Good',
          feedback: feedback || '',
          submittedBy: req.user.name || 'Direct',
          status: 'Submitted',
          docs: docs || undefined,
        },
      });
    });

    const item = {
      id: record.id,
      name: `${record.firstName} ${record.lastName}`,
      email: record.email,
      phone: record.phone,
      pan: record.pan,
      dob: record.dob,
      designation: record.designation,
      department: record.department,
      createdDate: record.createdAt.toISOString().split('T')[0],
      submittedBy: record.submittedBy,
      serviceStart: record.serviceStart.toISOString().split('T')[0],
      serviceEnd: record.serviceEnd.toISOString().split('T')[0],
      exitReason: record.exitReason,
      conductValue: record.conductValue,
      rating: Math.round(((record.techRating + record.attitudeRating) / 2) * 10) / 10,
      techRating: record.techRating,
      attitudeRating: record.attitudeRating,
      status: record.status,
      feedback: record.feedback,
      docs: record.docs || [],
    };

    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
}

export async function bulkAddExEmployees(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = bulkExEmployeeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { items } = parsed.data;

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const panRe = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
    const skipped = [];
    const validRows = [];

    items.forEach((item, index) => {
      const nameParts = (item.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      const email = (item.email || '').trim().toLowerCase();
      const pan = (item.pan || '').trim().toUpperCase();

      if (!firstName || !email || !emailRe.test(email) || !panRe.test(pan)) {
        skipped.push({ row: index + 1, reason: 'Missing or invalid name / email / PAN' });
        return;
      }

      const tr = parseInt(item.techRating ?? item.technical_rating, 10);
      const ar = parseInt(item.attitudeRating ?? item.professional_rating, 10);

      validRows.push({
        tenantId,
        firstName,
        lastName: lastName || firstName,
        email,
        pan,
        phone: item.phone || 'N/A',
        dob: item.dob ? String(item.dob) : null,
        designation: item.designation || item.employee_designation || 'Staff',
        department: item.department || 'General',
        serviceStart: new Date(item.serviceStart || item.service_start || new Date()),
        serviceEnd: new Date(item.serviceEnd || item.service_end || new Date()),
        exitReason: item.exitReason || 'Resigned',
        techRating: Number.isFinite(tr) && tr >= 1 && tr <= 10 ? tr : 8,
        attitudeRating: Number.isFinite(ar) && ar >= 1 && ar <= 10 ? ar : 8,
        conductValue: item.conductValue || item.conduct_value || 'Good',
        feedback: item.feedback || '',
        submittedBy: req.user.name || 'Direct',
        status: 'Published',
      });
    });

    if (validRows.length === 0) {
      return res.status(400).json({ error: 'No valid rows to import', skipped });
    }

    const createdItems = await prisma.$transaction(
      validRows.map((data) => prisma.exEmployeeRecord.create({ data }))
    );

    const formatted = createdItems.map(r => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      email: r.email,
      phone: r.phone,
      pan: r.pan,
      dob: r.dob,
      designation: r.designation,
      department: r.department,
      createdDate: r.createdAt.toISOString().split('T')[0],
      submittedBy: r.submittedBy,
      serviceStart: r.serviceStart.toISOString().split('T')[0],
      serviceEnd: r.serviceEnd.toISOString().split('T')[0],
      exitReason: r.exitReason,
      conductValue: r.conductValue,
      rating: Math.round(((r.techRating + r.attitudeRating) / 2) * 10) / 10,
      techRating: r.techRating,
      attitudeRating: r.attitudeRating,
      status: r.status,
      feedback: r.feedback,
    }));

    res.status(201).json({ items: formatted, skipped });
  } catch (err) {
    next(err);
  }
}

export async function listNonJoiners(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const records = await prisma.nonJoinerRecord.findMany({
      where: { tenantId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });

    const items = records.map(r => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      email: r.email,
      phone: r.phone,
      pan: r.pan,
      dob: r.dob,
      designation: r.designation,
      department: r.department,
      createdDate: r.createdAt.toISOString().split('T')[0],
      submittedBy: r.submittedBy,
      offerReleaseDate: r.offerReleaseDate.toISOString().split('T')[0],
      dateOfJoining: r.dateOfJoining.toISOString().split('T')[0],
      salary: r.salary,
      offerAccepted: r.offerAccepted,
      status: r.status,
      feedback: r.feedback,
      docs: r.docs || [],
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

export async function addNonJoiner(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = createNonJoinerSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      firstName,
      lastName,
      email,
      phone,
      pan,
      dob,
      designation,
      department,
      offerReleaseDate,
      dateOfJoining,
      salary,
      offerAccepted,
      feedback,
      docs,
    } = parsed.data;

    const record = await prisma.nonJoinerRecord.create({
      data: {
        tenantId,
        firstName,
        lastName,
        email: email.trim().toLowerCase(),
        phone,
        pan: pan.trim().toUpperCase(),
        dob: dob ? String(dob) : null,
        designation,
        department,
        offerReleaseDate: new Date(offerReleaseDate),
        dateOfJoining: new Date(dateOfJoining),
        salary: salary != null ? String(salary) : '0',
        offerAccepted: offerAccepted || 'Yes',
        feedback: feedback || '',
        submittedBy: req.user.name || 'Direct',
        status: 'Submitted',
        docs: docs || undefined,
      },
    });

    const item = {
      id: record.id,
      name: `${record.firstName} ${record.lastName}`,
      email: record.email,
      phone: record.phone,
      pan: record.pan,
      dob: record.dob,
      designation: record.designation,
      department: record.department,
      createdDate: record.createdAt.toISOString().split('T')[0],
      submittedBy: record.submittedBy,
      offerReleaseDate: record.offerReleaseDate.toISOString().split('T')[0],
      dateOfJoining: record.dateOfJoining.toISOString().split('T')[0],
      salary: record.salary,
      offerAccepted: record.offerAccepted,
      status: record.status,
      feedback: record.feedback,
      docs: record.docs || [],
    };

    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
}

export async function bulkAddNonJoiners(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsed = bulkNonJoinerSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { items } = parsed.data;

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const panRe = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
    const skipped = [];
    const validRows = [];

    items.forEach((item, index) => {
      const nameParts = (item.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      const email = (item.email || '').trim().toLowerCase();
      const pan = (item.pan || '').trim().toUpperCase();

      if (!firstName || !email || !emailRe.test(email) || !panRe.test(pan)) {
        skipped.push({ row: index + 1, reason: 'Missing or invalid name / email / PAN' });
        return;
      }

      validRows.push({
        tenantId,
        firstName,
        lastName: lastName || firstName,
        email,
        pan,
        phone: item.phone || 'N/A',
        dob: item.dob ? String(item.dob) : null,
        designation: item.designation || 'Staff',
        department: item.department || 'General',
        offerReleaseDate: new Date(item.offerReleaseDate || item.offer_release_date || new Date()),
        dateOfJoining: new Date(item.dateOfJoining || item.date_of_joining || new Date()),
        salary: String(item.salary || '0'),
        offerAccepted: item.offerAccepted || 'Yes',
        feedback: item.feedback || '',
        submittedBy: req.user.name || 'Direct',
        status: 'Published',
      });
    });

    if (validRows.length === 0) {
      return res.status(400).json({ error: 'No valid rows to import', skipped });
    }

    const createdItems = await prisma.$transaction(
      validRows.map((data) => prisma.nonJoinerRecord.create({ data }))
    );

    const formatted = createdItems.map(r => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      email: r.email,
      phone: r.phone,
      pan: r.pan,
      dob: r.dob,
      designation: r.designation,
      department: r.department,
      createdDate: r.createdAt.toISOString().split('T')[0],
      submittedBy: r.submittedBy,
      offerReleaseDate: r.offerReleaseDate.toISOString().split('T')[0],
      dateOfJoining: r.dateOfJoining.toISOString().split('T')[0],
      salary: r.salary,
      offerAccepted: r.offerAccepted,
      status: r.status,
      feedback: r.feedback,
    }));

    res.status(201).json({ items: formatted, skipped });
  } catch (err) {
    next(err);
  }
}

// ── Update Controllers ──

export async function updateEmployee(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    // updateEmployeeSchema is a strict allow-list — unknown keys (passwordHash,
    // status, role, isDeleted, tenantId, mustChangePassword, …) are dropped.
    const parsed = updateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const updates = { ...parsed.data };

    const existing = await prisma.tenantUser.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Validate a re-assigned reporting manager stays within the tenant.
    if (updates.managerId !== undefined) {
      if (updates.managerId === null || updates.managerId === '') {
        updates.managerId = null;
      } else if (updates.managerId === id) {
        return res.status(400).json({ error: 'An employee cannot be their own manager' });
      } else {
        const mgr = await prisma.tenantUser.findFirst({
          where: { id: updates.managerId, tenantId, isDeleted: false },
          select: { id: true },
        });
        if (!mgr) {
          return res.status(400).json({ error: 'Selected reporting manager was not found in this organization' });
        }
      }
    }

    if (updates.joinDate) updates.joinDate = new Date(updates.joinDate);
    else if (updates.joinDate === null || updates.joinDate === '') delete updates.joinDate;
    if (updates.confirmationDate) updates.confirmationDate = new Date(updates.confirmationDate);
    else if (updates.confirmationDate === null || updates.confirmationDate === '') delete updates.confirmationDate;
    if (updates.dob) {
      // If it's a full date (YYYY-MM-DD), use directly; if year-only (YYYY), append -01-01
      updates.dob = String(updates.dob).length === 4 ? new Date(`${updates.dob}-01-01`) : new Date(updates.dob);
      if (isNaN(updates.dob.getTime())) delete updates.dob; // Drop if still invalid
    } else {
      delete updates.dob; // Don't send null/empty to Prisma
    }

    // Clean up empty optional strings so Prisma gets null instead of ''
    for (const k of ['band', 'aadhaar', 'officeLocation', 'uan', 'esic', 'gender', 'bloodGroup', 'phone', 'personalEmail', 'emergencyContact']) {
      if (updates[k] === '') updates[k] = null;
    }

    const updated = await prisma.tenantUser.update({
      where: { id },
      data: updates,
      select: {
        id: true, email: true, name: true, role: true, status: true,
        department: true, designation: true, band: true,
        phone: true, pan: true, aadhaar: true, dob: true, joinDate: true, docs: true,
      }
    });

    // Notify connected clients of the update (useful if status/name changed)
    emitToTenant(tenantId, 'employee_status_updated', {
      id: updated.id,
      status: updated.status,
    });

    res.json({ message: 'Employee updated successfully', user: updated });
  } catch (err) {
    next(err);
  }
}

export async function updateExEmployee(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    const parsed = updateExEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const updates = parsed.data;

    const existing = await prisma.exEmployeeRecord.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Ex-Employee record not found' });
    }

    delete updates.id;
    delete updates.tenantId;
    delete updates.createdAt;
    delete updates.updatedAt;
    delete updates.status;
    delete updates.type;
    delete updates.submittedBy;
    delete updates.createdDate;
    delete updates.name;
    delete updates.rating;

    if (updates.serviceStart) updates.serviceStart = new Date(updates.serviceStart);
    if (updates.serviceEnd) updates.serviceEnd = new Date(updates.serviceEnd);

    const updated = await prisma.exEmployeeRecord.update({
      where: { id },
      data: updates,
    });

    // Match the format required by the frontend table
    const formatted = {
      id: updated.id,
      name: `${updated.firstName} ${updated.lastName}`,
      email: updated.email,
      phone: updated.phone,
      pan: updated.pan,
      dob: updated.dob,
      designation: updated.designation,
      department: updated.department,
      createdDate: updated.createdAt.toISOString().split('T')[0],
      submittedBy: updated.submittedBy,
      serviceStart: updated.serviceStart.toISOString().split('T')[0],
      serviceEnd: updated.serviceEnd.toISOString().split('T')[0],
      exitReason: updated.exitReason,
      conductValue: updated.conductValue,
      rating: Math.round(((updated.techRating + updated.attitudeRating) / 2) * 10) / 10,
      techRating: updated.techRating,
      attitudeRating: updated.attitudeRating,
      status: updated.status,
      feedback: updated.feedback,
      docs: updated.docs || [],
    };

    res.json({ message: 'Ex-Employee updated successfully', record: formatted });
  } catch (err) {
    next(err);
  }
}

export async function updateNonJoiner(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    const parsed = updateNonJoinerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const updates = parsed.data;

    const existing = await prisma.nonJoinerRecord.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Non-Joiner record not found' });
    }

    delete updates.id;
    delete updates.tenantId;
    delete updates.createdAt;
    delete updates.updatedAt;
    delete updates.status;
    delete updates.type;
    delete updates.submittedBy;
    delete updates.createdDate;
    delete updates.name;

    if (updates.offerReleaseDate) updates.offerReleaseDate = new Date(updates.offerReleaseDate);
    if (updates.dateOfJoining) updates.dateOfJoining = new Date(updates.dateOfJoining);

    const updated = await prisma.nonJoinerRecord.update({
      where: { id },
      data: updates,
    });

    // Match the format required by the frontend table
    const formatted = {
      id: updated.id,
      name: `${updated.firstName} ${updated.lastName}`,
      email: updated.email,
      designation: updated.designation,
      department: updated.department,
      createdDate: updated.createdAt.toISOString().split('T')[0],
      submittedBy: updated.submittedBy,
      offerReleaseDate: updated.offerReleaseDate.toISOString().split('T')[0],
      dateOfJoining: updated.dateOfJoining.toISOString().split('T')[0],
      salary: updated.salary,
      offerAccepted: updated.offerAccepted,
      status: updated.status,
      feedback: updated.feedback,
      docs: updated.docs || [],
    };

    res.json({ message: 'Non-Joiner updated successfully', record: formatted });
  } catch (err) {
    next(err);
  }
}

// ── Employee Exit / Offboarding Workflow ────────────────────────────────────

/**
 * POST /api/employees/:id/exit
 * Dedicated employee offboarding endpoint. In a single atomic transaction:
 *  1. Validates the employee belongs to this tenant and is currently active.
 *  2. Transitions TenantUser to { isDeleted: true, status: 'EXITED' }.
 *  3. Re-assigns any direct reports to the departing manager's own manager.
 *  4. Creates a corresponding ExEmployeeRecord so the offboarding history
 *     is preserved in the Ex-Employees tab.
 *  5. Immediately frees the license slot (no DB round-trip needed).
 */
export async function exitEmployee(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const parsed = exitEmployeeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      serviceStart,
      serviceEnd,
      exitReason,
      techRating,
      attitudeRating,
      conductValue,
      feedback,
      docs,
    } = parsed.data;

    // Guard: requester cannot exit themselves
    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot exit your own account' });
    }

    const tenantUser = await prisma.tenantUser.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: { id: true, name: true, email: true, pan: true, designation: true, department: true, managerId: true, status: true },
    });

    if (!tenantUser) {
      return res.status(404).json({ error: 'Active employee not found' });
    }

    if (tenantUser.status === 'EXITED') {
      return res.status(409).json({ error: 'This employee has already been exited' });
    }

    const nameParts = (tenantUser.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    // Atomic transaction: deactivate + re-assign subordinates + create exit record
    const exitRecord = await prisma.$transaction(async (tx) => {
      // 1. Soft-delete the TenantUser
      await tx.tenantUser.update({
        where: { id },
        data: { isDeleted: true, status: 'EXITED' },
      });

      // 2. Re-route direct reports to the exiting manager's manager
      await tx.tenantUser.updateMany({
        where: { managerId: id, tenantId },
        data: { managerId: tenantUser.managerId ?? null },
      });

      // 3. Create the historical ExEmployeeRecord
      return tx.exEmployeeRecord.create({
        data: {
          tenantId,
          firstName,
          lastName,
          email: tenantUser.email,
          phone: 'N/A',
          pan: tenantUser.pan || 'N/A',
          designation: tenantUser.designation || 'Member',
          department: tenantUser.department || 'General',
          serviceStart: new Date(serviceStart),
          serviceEnd: new Date(serviceEnd),
          exitReason: exitReason || 'Resigned',
          techRating: techRating ?? 8,
          attitudeRating: attitudeRating ?? 8,
          conductValue: conductValue || 'Good',
          feedback: feedback || '',
          submittedBy: req.user.name || 'Direct',
          status: 'Published',
          docs: docs || undefined,
        },
      });
    });

    // Notify connected HR/Admin clients
    emitToTenant(tenantId, 'employee_status_updated', { id, status: 'EXITED' });

    // Return updated license stats so the frontend can refresh metrics instantly
    const licenseStats = await getLicenseStats(tenantId);

    res.json({
      message: `${tenantUser.name} has been offboarded successfully`,
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

/**
 * POST /api/employees/:id/reactivate
 * Re-activates a previously deactivated (EXITED + isDeleted:true) employee
 * if license capacity is available. The account is restored to INVITED status
 * so the employee is prompted to reset their password on next login.
 */
export async function reactivateEmployee(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const tenantUser = await prisma.tenantUser.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, email: true, status: true, isDeleted: true },
    });

    if (!tenantUser) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (!tenantUser.isDeleted && tenantUser.status !== 'EXITED') {
      return res.status(409).json({ error: 'Employee is already active and does not need reactivation' });
    }

    // Atomic: check capacity THEN reactivate
    await prisma.$transaction(async (tx) => {
      await assertLicenseAvailable(tx, tenantId);
      await tx.tenantUser.update({
        where: { id },
        data: { isDeleted: false, status: 'INVITED', mustChangePassword: true },
      });
    });

    const licenseStats = await getLicenseStats(tenantId);

    res.json({
      message: `${tenantUser.name} has been reactivated. They will be prompted to change their password on next login.`,
      licenseStats,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code || undefined,
        details: err.details || undefined,
      });
    }
    next(err);
  }
}

export async function deleteEmployee(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const userRecord = await prisma.tenantUser.findFirst({
      where: { id, tenantId },
    });

    if (!userRecord) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    await prisma.$transaction([
      // Soft-delete + mark exited so any live JWT session is rejected on next request.
      prisma.tenantUser.update({
        where: { id },
        data: { isDeleted: true, status: 'EXITED' },
      }),
      // Detach direct reports so the reporting chain doesn't dangle on a deleted node.
      prisma.tenantUser.updateMany({
        where: { managerId: id, tenantId },
        data: { managerId: userRecord.managerId ?? null },
      }),
    ]);

    const licenseStats = await getLicenseStats(tenantId);
    res.json({ success: true, message: 'Employee deactivated successfully', licenseStats });
  } catch (err) {
    next(err);
  }
}

export async function deleteExEmployee(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const record = await prisma.exEmployeeRecord.findFirst({
      where: { id, tenantId },
    });

    if (!record) {
      return res.status(404).json({ error: 'Ex-Employee record not found' });
    }

    await prisma.exEmployeeRecord.update({
      where: { id },
      data: { isDeleted: true },
    });

    res.json({ success: true, message: 'Ex-Employee record soft-deleted successfully' });
  } catch (err) {
    next(err);
  }
}

export async function deleteNonJoiner(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const record = await prisma.nonJoinerRecord.findFirst({
      where: { id, tenantId },
    });

    if (!record) {
      return res.status(404).json({ error: 'Non-Joiner record not found' });
    }

    await prisma.nonJoinerRecord.update({
      where: { id },
      data: { isDeleted: true },
    });

    res.json({ success: true, message: 'Non-Joiner record soft-deleted successfully' });
  } catch (err) {
    next(err);
  }
}
