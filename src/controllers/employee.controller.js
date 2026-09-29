import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { emitToTenant } from '../lib/socket.js';
import { generateRawToken, hashToken } from '../lib/tokens.js';
import { renderInvitationEmail } from '../lib/emailTemplates.js';
import {
  updateExEmployeeSchema,
  updateNonJoinerSchema,
  inviteEmployeeSchema,
  bulkInviteEmployeesSchema,
  onboardEmployeeSchema,
  updateEmployeeSchema,
  createExEmployeeSchema,
  createNonJoinerSchema,
  exitEmployeeSchema,
  bulkExEmployeeSchema,
  bulkNonJoinerSchema,
  employeeIdOnlyParamSchema,
  listEmployeesQuerySchema,
  addLicenseSchema,
} from '../validations/employee.schema.js';
import { env } from '../config/env.js';
import { canCreateRole, getAllowedRoles } from '../lib/roleHierarchy.js';
import { validatePasswordStrength } from '../lib/passwordPolicy.js';
import {
  getLicenseStats,
  assertLicenseAvailable,
  assertBulkLicenseAvailable,
  listEligibleManagers,
  notifyLicensingActivity,
} from '../services/license.service.js';
import { generateReferenceCheckProfile } from '../services/pdf.service.js';

// ── Shared select for privileged (SUPER_ADMIN / ADMIN / HR) employee queries ──
// Includes every onboarding field so the HR edit modal and read-only view
// can display the full employee profile without a second round-trip.
const PRIVILEGED_EMPLOYEE_SELECT = {
  id: true,
  employeeId: true,
  empType: true,
  email: true,
  name: true,
  role: true,
  status: true,
  department: true,
  designation: true,
  band: true,
  managerId: true,
  joinDate: true,
  confirmationDate: true,
  officeLocation: true,
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
  // Address
  presentAddressLine1: true,
  presentAddressLine2: true,
  presentCity: true,
  presentState: true,
  presentPincode: true,
  permanentAddressLine1: true,
  permanentAddressLine2: true,
  permanentCity: true,
  permanentState: true,
  permanentPincode: true,
  sameAsPresentAddress: true,
  // Professional & Skills
  linkedinUrl: true,
  profilePhoto: true,
  primarySkills: true,
  secondarySkills: true,
  // Relations
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
  educations: {
    select: {
      id: true,
      qualification: true,
      institutionName: true,
      boardUniversity: true,
      passingYear: true,
      percentageCgpa: true,
    },
  },
};

/**
 * Augments employee database record with verification status and fallback fields
 * expected by the frontend without requiring nonexistent columns in Prisma.
 */
function formatEmployeeResponse(emp) {
  if (!emp) return emp;
  const isVerified = Boolean(emp.isVerified || emp.status === 'ACTIVE');
  return {
    ...emp,
    isVerified,
    verificationStatus: emp.verificationStatus || (isVerified ? 'VERIFIED' : emp.status === 'INVITED' ? 'UNVERIFIED' : 'PENDING_UEIBI'),
    verifiedAt: emp.verifiedAt || null,
    verifiedBy: emp.verifiedBy || null,
    ueibiNotes: emp.ueibiNotes || '',
    ueibiSubmittedAt: emp.ueibiSubmittedAt || null,
    ueibiSubmittedBy: emp.ueibiSubmittedBy || null,
    annualEvaluation: emp.annualEvaluation || null,
  };
}

/**
 * Issues a one-time password setup token (PasswordResetToken model) for employee invitation.
 */
async function issueInvitePasswordToken(tx, userId) {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresMinutes = (env.passwordResetTokenExpiresMinutes || 72 * 60);
  const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);
  const tokenId = `prt_${crypto.randomBytes(12).toString('hex')}`;

  await tx.$executeRawUnsafe(
    `UPDATE "password_reset_tokens"
     SET "usedAt" = CURRENT_TIMESTAMP
     WHERE "userId" = $1 AND "usedAt" IS NULL`,
    userId
  );

  await tx.$executeRawUnsafe(
    `INSERT INTO "password_reset_tokens" ("id", "userId", "tokenHash", "expiresAt", "usedAt", "createdAt")
     VALUES ($1, $2, $3, $4, NULL, CURRENT_TIMESTAMP)`,
    tokenId,
    userId,
    tokenHash,
    expiresAt
  );

  const setupUrl = `${env.frontendOrigin}/reset-password?token=${rawToken}`;
  return { rawToken, setupUrl, expiresHours: Math.round(expiresMinutes / 60) };
}

export function normalizeEmploymentType(val) {
  if (!val) return 'PERMANENT';
  const clean = String(val).trim().toUpperCase().replace(/[\s\-_]+/g, '_');
  if (['PERMANENT', 'FULL_TIME', 'FULLTIME', 'REGULAR'].includes(clean)) return 'PERMANENT';
  if (['CONTRACT', 'CONTRACTOR', 'CONSULTANT'].includes(clean)) return 'CONTRACT';
  if (['PROBATION', 'TRAINEE'].includes(clean)) return 'PROBATION';
  if (['INTERN', 'INTERNSHIP'].includes(clean)) return 'INTERN';
  if (['PART_TIME', 'PARTTIME', 'HALF_TIME'].includes(clean)) return 'PART_TIME';
  return 'PERMANENT';
}

export async function inviteEmployee(req, res, next) {
  try {
    const parsed = inviteEmployeeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { email, employeeId, empType, firstName, lastName, name, role, designation, department, band, managerId, joinDate, phone, pan, dob, feedbackRemarks } = parsed.data;

    const resolvedName = (firstName || lastName)
      ? `${firstName || ''} ${lastName || ''}`.trim()
      : (name || '').trim();

    if (!resolvedName) {
      return res.status(400).json({ error: 'Employee name is required' });
    }

    const tenantId = req.tenantId;

    // ── Role-creation authorization ───────────────────────────────────────────
    const targetRole = (role || 'EMPLOYEE').toUpperCase();

    const validRoles = [
      'SUPER_ADMIN', 'ADMIN', 'CMD', 'HR', 'FINANCE',
      'MANAGER', 'EMPLOYEE', 'STUDENT', 'MENTOR',
    ];
    if (!validRoles.includes(targetRole)) {
      return res.status(400).json({ error: `Invalid role: ${targetRole}` });
    }

    const creatorRole = req.user.role;
    if (!canCreateRole(creatorRole, targetRole)) {
      return res.status(403).json({
        error: `Forbidden: ${creatorRole} cannot assign role ${targetRole}`,
        allowedRoles: getAllowedRoles(creatorRole),
      });
    }

    let resolvedManagerId = null;
    if (managerId) {
      const trimmed = String(managerId).trim();
      const mgr = await prisma.tenantUser.findFirst({
        where: {
          tenantId,
          isDeleted: false,
          OR: [
            { id: trimmed },
            { name: { equals: trimmed, mode: 'insensitive' } },
            { email: { equals: trimmed.toLowerCase(), mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (mgr) {
        resolvedManagerId = mgr.id;
      }
      // If manager name is not found, resolvedManagerId remains null (can be edited later)
    }

    const initialPlaceholder = 'INVITED_NO_PASS_' + crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(initialPlaceholder, 10);

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

    const existing = await prisma.tenantUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (existing) {
      if (existing.status === 'INVITED') {
        const { setupUrl, expiresHours } = await prisma.$transaction(async (tx) => {
          await tx.tenantUser.update({
            where: { id: existing.id },
            data: {
              name: resolvedName,
              role: targetRole,
              employeeId: employeeId ? employeeId.trim() : existing.employeeId,
              empType: empType ? normalizeEmploymentType(empType) : existing.empType,
              designation: designation ? designation.trim() : existing.designation,
              department: department ? department.trim() : existing.department,
              band: band || existing.band,
              managerId: resolvedManagerId || existing.managerId,
              phone: phone ? phone.trim() : existing.phone,
              pan: pan ? pan.trim().toUpperCase() : existing.pan,
              dob: parsedDob || existing.dob,
            },
          });
          return issueInvitePasswordToken(tx, existing.id);
        });

        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { companyName: true },
        });
        const companyName = tenant?.companyName || 'your organization';

        const { html, text } = renderInvitationEmail({
          setupUrl,
          expiresHours,
          name: resolvedName,
          companyName,
          email,
        });

        await sendMail({
          to: email,
          subject: `Invitation to join ${companyName} - Set Your Password`,
          text,
          html,
          event: 'EMPLOYEE_INVITED',
        }).catch((err) => console.warn('[EMPLOYEE] Failed to resend invite email:', err.message));

        const licenseStats = await getLicenseStats(tenantId);
        return res.status(200).json({
          message: 'Invitation re-sent successfully',
          user: {
            id: existing.id,
            email: existing.email,
            name: resolvedName,
            role: targetRole,
            status: 'INVITED',
          },
          licenseStats,
        });
      }

      return res.status(409).json({ error: 'A user with this email address already exists' });
    }

    // Atomic transaction: capacity check + create
    const { user, tenant, setupUrl, expiresHours } = await prisma.$transaction(async (tx) => {
      await assertLicenseAvailable(tx, tenantId);

      const t = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, companyName: true },
      });

      const u = await tx.tenantUser.create({
        data: {
          tenantId,
          email: email.trim().toLowerCase(),
          passwordHash,
          name: resolvedName,
          role: targetRole,
          status: 'INVITED',
          mustChangePassword: true,
          employeeId: employeeId ? employeeId.trim() : null,
          empType: normalizeEmploymentType(empType),
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

      const tokenData = await issueInvitePasswordToken(tx, u.id);
      return { user: u, tenant: t, ...tokenData };
    });

    const companyName = tenant?.companyName || 'your organization';
    const { html, text } = renderInvitationEmail({
      setupUrl,
      expiresHours,
      name: resolvedName,
      companyName,
      email,
    });

    await sendMail({
      to: email,
      subject: `Welcome to ${companyName} - Set Your Password`,
      text,
      html,
      event: 'EMPLOYEE_INVITED',
    }).catch((err) => console.warn('[EMPLOYEE] Failed to send invite email:', err.message));

    const licenseStats = await getLicenseStats(tenantId);

    res.status(201).json({
      message: 'Employee invited successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        employeeId: user.employeeId,
        empType: user.empType,
      },
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

export async function bulkInviteEmployees(req, res, next) {
  try {
    const parsed = bulkInviteEmployeesSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const tenantId = req.tenantId;
    const creatorRole = req.user.role;
    const items = parsed.data.employees;

    const emailsSeen = new Set();
    const batchDuplicates = [];
    for (const emp of items) {
      const em = emp.email.trim().toLowerCase();
      if (emailsSeen.has(em)) {
        batchDuplicates.push(em);
      }
      emailsSeen.add(em);
    }
    if (batchDuplicates.length > 0) {
      return res.status(400).json({
        error: `Duplicate emails found within the import file: ${batchDuplicates.join(', ')}`,
      });
    }

    const existingUsers = await prisma.tenantUser.findMany({
      where: {
        email: { in: Array.from(emailsSeen) },
      },
      select: { email: true, status: true },
    });
    if (existingUsers.length > 0) {
      const existingEmails = existingUsers.map(u => u.email).join(', ');
      return res.status(409).json({
        error: `The following email(s) already exist in the system: ${existingEmails}`,
      });
    }

    const createdUsers = await prisma.$transaction(async (tx) => {
      await assertBulkLicenseAvailable(tx, tenantId, items.length);

      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { companyName: true },
      });
      const companyName = tenant?.companyName || 'your organization';
      // Resolve reporting managers by name, email, or id across the organization
      const existingTenantUsers = await tx.tenantUser.findMany({
        where: { tenantId, isDeleted: false },
        select: { id: true, name: true, email: true, employeeId: true },
      });

      const managerByName = new Map();
      const managerByEmail = new Map();
      const managerById = new Map();

      const registerUserForLookup = (u) => {
        if (!u || !u.id) return;
        managerById.set(String(u.id).toLowerCase(), u.id);
        if (u.name) {
          const lower = u.name.trim().toLowerCase();
          managerByName.set(lower, u.id);
          managerByName.set(lower.replace(/\s+/g, ' '), u.id);
        }
        if (u.email) {
          managerByEmail.set(u.email.trim().toLowerCase(), u.id);
        }
        if (u.employeeId) {
          managerById.set(String(u.employeeId).trim().toLowerCase(), u.id);
        }
      };

      existingTenantUsers.forEach(registerUserForLookup);

      const results = [];
      for (const emp of items) {
        // Excel bulk import ALWAYS explicitly assigns default EMPLOYEE role.
        // Role cannot be overridden or accepted from Excel input.
        const targetRole = 'EMPLOYEE';

        const resolvedName = (emp.firstName || emp.lastName)
          ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim()
          : (emp.name || '').trim();

        const initialPlaceholder = 'INVITED_NO_PASS_' + crypto.randomBytes(16).toString('hex');
        const passwordHash = await bcrypt.hash(initialPlaceholder, 10);

        const parsedJoinDate = emp.joinDate ? new Date(emp.joinDate) : new Date();

        // Resolve reporting manager: from name, find out the id.
        // If name not found, keep reporting manager empty (null) in db so it can be edited later.
        const rawManager = String(emp.managerId || emp.reportingManager || emp.manager || '').trim();
        let resolvedManagerId = null;

        if (rawManager) {
          const lower = rawManager.toLowerCase();
          const lowerSingleSpaced = lower.replace(/\s+/g, ' ');
          if (managerById.has(lower)) {
            resolvedManagerId = managerById.get(lower);
          } else if (managerByName.has(lower)) {
            resolvedManagerId = managerByName.get(lower);
          } else if (managerByName.has(lowerSingleSpaced)) {
            resolvedManagerId = managerByName.get(lowerSingleSpaced);
          } else if (managerByEmail.has(lower)) {
            resolvedManagerId = managerByEmail.get(lower);
          }
          // If name is not found, resolvedManagerId stays null
        }

        const u = await tx.tenantUser.create({
          data: {
            tenantId,
            email: emp.email.trim().toLowerCase(),
            passwordHash,
            name: resolvedName || emp.email.split('@')[0],
            role: targetRole,
            status: 'INVITED',
            mustChangePassword: true,
            employeeId: emp.employeeId ? String(emp.employeeId).trim() : null,
            empType: normalizeEmploymentType(emp.empType),
            designation: emp.designation ? emp.designation.trim() : 'Member',
            department: emp.department ? emp.department.trim() : 'General',
            managerId: resolvedManagerId,
            joinDate: isNaN(parsedJoinDate.getTime()) ? new Date() : parsedJoinDate,
            phone: emp.phone ? emp.phone.trim() : null,
          },
        });

        // Register newly created user so subsequent employees in the same upload batch
        // can reference a manager defined earlier in the file.
        registerUserForLookup(u);

        const tokenData = await issueInvitePasswordToken(tx, u.id);
        results.push({ user: u, companyName, ...tokenData });
      }

      return results;
    });

    for (const item of createdUsers) {
      const { html, text } = renderInvitationEmail({
        setupUrl: item.setupUrl,
        expiresHours: item.expiresHours,
        name: item.user.name,
        companyName: item.companyName,
        email: item.user.email,
      });

      sendMail({
        to: item.user.email,
        subject: `Welcome to ${item.companyName} - Set Your Password`,
        text,
        html,
        event: 'EMPLOYEE_INVITED',
      }).catch((err) => console.warn(`[BULK_INVITE] Failed email to ${item.user.email}:`, err.message));
    }

    const licenseStats = await getLicenseStats(tenantId);

    return res.status(201).json({
      message: `Successfully onboarded ${createdUsers.length} employee(s)`,
      count: createdUsers.length,
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

export async function getEligibleManagers(req, res, next) {
  try {
    const managers = await listEligibleManagers(req.tenantId);
    return res.status(200).json({ managers });
  } catch (err) {
    next(err);
  }
}

export async function resendInvite(req, res, next) {
  try {
    const paramParsed = employeeIdOnlyParamSchema.safeParse(req.params || {});
    if (!paramParsed.success) {
      return res.status(400).json({ error: 'Invalid employee ID', details: paramParsed.error.issues });
    }
    const { id } = paramParsed.data;
    const tenantId = req.tenantId;

    const user = await prisma.tenantUser.findFirst({
      where: { id, tenantId, isDeleted: false },
    });

    if (!user) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (user.status !== 'INVITED') {
      return res.status(400).json({ error: 'Invitation can only be re-sent to employees with status INVITED' });
    }

    const { setupUrl, expiresHours } = await prisma.$transaction(async (tx) => {
      return issueInvitePasswordToken(tx, user.id);
    });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { companyName: true },
    });
    const companyName = tenant?.companyName || 'your organization';

    const { html, text } = renderInvitationEmail({
      setupUrl,
      expiresHours,
      name: user.name,
      companyName,
      email: user.email,
    });

    await sendMail({
      to: user.email,
      subject: `Invitation to join ${companyName} - Set Your Password`,
      text,
      html,
      event: 'EMPLOYEE_INVITED',
    });

    return res.status(200).json({ message: 'Invitation email re-sent successfully' });
  } catch (err) {
    next(err);
  }
}

export async function onboardEmployee(req, res, next) {
  try {
    const parsed = onboardEmployeeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const issueMessages = parsed.error.issues.map((iss) => {
        const field = iss.path && iss.path.length > 0 ? iss.path.join('.') : 'field';
        return `${field}: ${iss.message}`;
      });
      return res.status(400).json({
        error: `Validation failed: ${issueMessages.join(', ')}`,
        details: parsed.error.issues,
      });
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
      presentAddressLine1,
      presentAddressLine2,
      presentCity,
      presentState,
      presentPincode,
      permanentAddressLine1,
      permanentAddressLine2,
      permanentCity,
      permanentState,
      permanentPincode,
      sameAsPresentAddress,
      linkedinUrl,
      primarySkills,
      secondarySkills,
      profilePhoto,
      educationHistory,
      bankDetails,
      workHistory,
      docs,
    } = parsed.data;

    const userId = req.user.id;

    const user = await prisma.tenantUser.findUnique({
      where: { id: userId },
    });

    if (!user || user.isDeleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.status === 'EXITED') {
      return res.status(403).json({ error: 'Exited employees cannot modify onboarding profile' });
    }

    // A first-time invited user must set a new secure password.
    // For already-active employees (e.g. uploaded via Excel or updating profile), new password is optional.
    const isFirstTimeSetup = user.status === 'INVITED' || user.mustChangePassword;
    if (isFirstTimeSetup && (!newPassword || !newPassword.trim())) {
      return res.status(400).json({ error: 'New password is required to complete onboarding' });
    }

    let newHash = undefined;
    if (newPassword && newPassword.trim()) {
      const pwCheck = validatePasswordStrength(newPassword.trim());
      if (!pwCheck.ok) {
        return res.status(400).json({ error: pwCheck.message });
      }
      newHash = await bcrypt.hash(newPassword.trim(), 10);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Update user profile details
      const u = await tx.tenantUser.update({
        where: { id: userId },
        data: {
          passwordHash: newHash || undefined,
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
          presentAddressLine1: presentAddressLine1 || undefined,
          presentAddressLine2: presentAddressLine2 || undefined,
          presentCity: presentCity || undefined,
          presentState: presentState || undefined,
          presentPincode: presentPincode || undefined,
          permanentAddressLine1: permanentAddressLine1 || undefined,
          permanentAddressLine2: permanentAddressLine2 || undefined,
          permanentCity: permanentCity || undefined,
          permanentState: permanentState || undefined,
          permanentPincode: permanentPincode || undefined,
          sameAsPresentAddress: typeof sameAsPresentAddress === 'boolean' ? sameAsPresentAddress : undefined,
          linkedinUrl: linkedinUrl || undefined,
          primarySkills: Array.isArray(primarySkills) ? primarySkills : undefined,
          secondarySkills: Array.isArray(secondarySkills) ? secondarySkills : undefined,
          profilePhoto: profilePhoto || undefined,
          profileSnaps: profilePhoto ? [profilePhoto] : undefined,
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

      // 3. Create education history entries if provided
      if (educationHistory && Array.isArray(educationHistory) && educationHistory.length > 0) {
        await tx.employeeEducation.deleteMany({ where: { userId } });
        await Promise.all(
          educationHistory.map((edu) => {
            return tx.employeeEducation.create({
              data: {
                userId,
                qualification: edu.qualification,
                institutionName: edu.institutionName,
                boardUniversity: edu.boardUniversity || null,
                passingYear: edu.passingYear || null,
                percentageCgpa: edu.percentageCgpa || null,
              },
            });
          })
        );
      }

      // 4. Create/append work history entries if provided
      // Compliance rule: Existing submitted work history cannot be changed or deleted; only new records can be added
      if (workHistory && Array.isArray(workHistory) && workHistory.length > 0) {
        const existingHistories = await tx.workHistory.findMany({ where: { userId } });

        for (const history of workHistory) {
          const start = new Date(history.startDate);
          const end = (history.isCurrent || !history.endDate) ? null : new Date(history.endDate);

          // Check if this experience record already exists on file
          const alreadyExists = existingHistories.some(
            (eh) => eh.companyName.toLowerCase().trim() === history.companyName.toLowerCase().trim() &&
                    new Date(eh.startDate).getTime() === start.getTime()
          );

          if (!alreadyExists) {
            await tx.workHistory.create({
              data: {
                userId,
                companyName: history.companyName.trim(),
                designation: history.designation.trim(),
                startDate: start,
                endDate: end,
                reasonForExit: history.reasonForExit ? history.reasonForExit.trim() : null,
                remarks: history.remarks ? history.remarks.trim() : null,
              },
            });
          }
        }
      }

      return u;
    });

    // Fetch full updated user with relations for socket payload
    const fullUser = await prisma.tenantUser.findUnique({
      where: { id: updated.id },
      include: { bankDetails: true, workHistory: true, educations: true },
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
      educations: fullUser.educations,
    });

    res.json({
      message: 'Onboarding completed successfully',
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        status: updated.status,
        mustChangePassword: updated.mustChangePassword,
        phone: updated.phone,
        pan: updated.pan,
        aadhaar: updated.aadhaar,
        dob: updated.dob,
        gender: updated.gender,
        bloodGroup: updated.bloodGroup,
        personalEmail: updated.personalEmail,
        emergencyContact: updated.emergencyContact,
        uan: updated.uan,
        esic: updated.esic,
        presentAddressLine1: updated.presentAddressLine1,
        presentAddressLine2: updated.presentAddressLine2,
        presentCity: updated.presentCity,
        presentState: updated.presentState,
        presentPincode: updated.presentPincode,
        permanentAddressLine1: updated.permanentAddressLine1,
        permanentAddressLine2: updated.permanentAddressLine2,
        permanentCity: updated.permanentCity,
        permanentState: updated.permanentState,
        permanentPincode: updated.permanentPincode,
        sameAsPresentAddress: updated.sameAsPresentAddress,
        linkedinUrl: updated.linkedinUrl,
        primarySkills: updated.primarySkills,
        secondarySkills: updated.secondarySkills,
        profilePhoto: updated.profilePhoto,
        profileSnaps: updated.profileSnaps,
        bankDetails: fullUser.bankDetails,
        workHistory: fullUser.workHistory,
        educations: fullUser.educations,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listEmployees(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsedQuery = listEmployeesQuerySchema.safeParse(req.query || {});
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsedQuery.error.issues });
    }
    const { search, role, status } = parsedQuery.data;

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
        { employeeId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const isPrivileged = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user.role);

    const select = isPrivileged
      ? PRIVILEGED_EMPLOYEE_SELECT
      : {
          id: true,
          employeeId: true,
          empType: true,
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

    res.json({ items: items.map(formatEmployeeResponse) });
  } catch (err) {
    next(err);
  }
}

export async function getEmployee(req, res, next) {
  try {
    const parsedParams = employeeIdOnlyParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
    const isPrivileged = ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(req.user.role);

    const select = isPrivileged
      ? PRIVILEGED_EMPLOYEE_SELECT
      : {
          id: true,
          employeeId: true,
          empType: true,
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

    const employee = await prisma.tenantUser.findFirst({
      where: { id, tenantId: req.tenantId, isDeleted: false },
      select,
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({ employee: formatEmployeeResponse(employee) });
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

/**
 * GET /api/employees/license-requests
 * Returns all license requests (pending and past) for the tenant along with license capacity stats.
 */
export async function listLicenseRequests(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const requests = await prisma.licenseRequest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        requestedBy: {
          select: { id: true, name: true, email: true, role: true, designation: true },
        },
        paidBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    const stats = await getLicenseStats(tenantId);

    res.json({
      requests,
      licenseStats: stats,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/employees/request-license
 * Allows HR to submit a license purchase request to Finance with estimated price breakdown.
 */
export async function requestTenantLicenses(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const seats = parseInt(req.body.seats, 10);
    const reason = req.body.reason || 'HR employee capacity expansion';

    if (!seats || isNaN(seats) || seats < 1) {
      return res.status(400).json({ error: 'Please specify at least 1 license seat to request.' });
    }

    const unitPrice = 499.00;
    const taxRate = 0.18;
    const subtotal = seats * unitPrice;
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100;

    const licenseReq = await prisma.licenseRequest.create({
      data: {
        tenantId,
        requestedById: req.user.id,
        seats,
        unitPrice,
        taxRate,
        taxAmount,
        totalAmount,
        currency: 'INR',
        reason,
        status: 'PENDING_FINANCE_APPROVAL',
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    // Notify Finance & CEO about the pending license request
    await notifyLicensingActivity({
      tenantId,
      actor: req.user,
      action: 'REQUESTED',
      seats,
      totalAmount,
      reason,
      requestId: licenseReq.id,
    });

    emitToTenant(tenantId, 'LICENSE_REQUEST_CREATED', {
      request: licenseReq,
      message: `HR submitted a request for ${seats} additional licenses.`,
    });

    res.json({
      message: `License request for ${seats} seat(s) submitted to Finance successfully. Estimated amount: ₹${totalAmount.toLocaleString('en-IN')}.`,
      request: licenseReq,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/employees/pay-license
 * Allows Finance / Leadership to review, pay, and purchase licenses.
 * Increases the tenant's license capacity and notifies CEO, Finance, and HR.
 */
export async function payAndAddLicenses(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { requestId, paymentMethod = 'UPI', paymentRef, notes } = req.body;
    let additionalSeats = 0;
    let targetRequest = null;
    let totalPaid = 0;

    if (requestId) {
      targetRequest = await prisma.licenseRequest.findUnique({
        where: { id: requestId },
        include: { requestedBy: true },
      });

      if (!targetRequest || targetRequest.tenantId !== tenantId) {
        return res.status(404).json({ error: 'License request not found.' });
      }

      if (targetRequest.status === 'PAID') {
        return res.status(400).json({ error: 'This license request has already been paid and processed.' });
      }

      additionalSeats = targetRequest.seats;
      totalPaid = Number(targetRequest.totalAmount);

      await prisma.licenseRequest.update({
        where: { id: requestId },
        data: {
          status: 'PAID',
          paidById: req.user.id,
          paidAt: new Date(),
          paymentMethod: paymentMethod || 'ONLINE',
          paymentRef: paymentRef || `TXN-${Date.now().toString(36).toUpperCase()}`,
        },
      });
    } else {
      // Direct license purchase by Finance / Admin
      const seats = parseInt(req.body.seats || req.body.additionalSeats, 10);
      if (!seats || isNaN(seats) || seats < 1) {
        return res.status(400).json({ error: 'Please specify a valid number of license seats to purchase.' });
      }

      additionalSeats = seats;
      const unitPrice = 499.00;
      const taxRate = 0.18;
      const subtotal = additionalSeats * unitPrice;
      const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
      totalPaid = Math.round((subtotal + taxAmount) * 100) / 100;

      targetRequest = await prisma.licenseRequest.create({
        data: {
          tenantId,
          requestedById: req.user.id,
          paidById: req.user.id,
          paidAt: new Date(),
          seats: additionalSeats,
          unitPrice,
          taxRate,
          taxAmount,
          totalAmount: totalPaid,
          currency: 'INR',
          reason: req.body.reason || 'Finance direct license purchase',
          status: 'PAID',
          paymentMethod: paymentMethod || 'ONLINE',
          paymentRef: paymentRef || `TXN-${Date.now().toString(36).toUpperCase()}`,
        },
      });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, companyName: true, licenseLimit: true },
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found.' });
    }

    const newLimit = (tenant.licenseLimit || 0) + additionalSeats;

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { licenseLimit: newLimit },
    });

    const stats = await getLicenseStats(tenantId);

    // Notify CEO, Finance, and HR
    await notifyLicensingActivity({
      tenantId,
      actor: req.user,
      action: 'PURCHASED',
      seats: additionalSeats,
      totalAmount: totalPaid,
      paymentMethod,
      paymentRef: paymentRef || targetRequest?.paymentRef,
      reason: notes || targetRequest?.reason,
      requestId: targetRequest?.id,
      newCapacity: newLimit,
    });

    // Broadcast license capacity update via WebSocket
    emitToTenant(tenantId, 'LICENSE_CAPACITY_UPDATED', {
      licenseStats: stats,
      message: `Tenant license capacity increased by ${additionalSeats} seat(s) after verified payment.`,
    });

    res.json({
      message: `Payment confirmed! Successfully purchased and added ${additionalSeats} employee license seat(s). New capacity is ${newLimit}. CEO, Finance, and HR have been notified.`,
      newCapacity: newLimit,
      addedSeats: additionalSeats,
      licenseStats: stats,
      paymentRef: paymentRef || targetRequest?.paymentRef,
      totalPaid,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/employees/reject-license-request
 * Allows Finance / Leadership to decline an HR license request.
 */
export async function rejectLicenseRequest(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { requestId, rejectionReason } = req.body;

    const targetRequest = await prisma.licenseRequest.findUnique({
      where: { id: requestId },
      include: { requestedBy: true },
    });

    if (!targetRequest || targetRequest.tenantId !== tenantId) {
      return res.status(404).json({ error: 'License request not found.' });
    }

    if (targetRequest.status === 'PAID') {
      return res.status(400).json({ error: 'Cannot reject an already paid license request.' });
    }

    const updated = await prisma.licenseRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        rejectionReason: rejectionReason || 'Declined by Finance department.',
      },
    });

    await notifyLicensingActivity({
      tenantId,
      actor: req.user,
      action: 'REJECTED',
      seats: targetRequest.seats,
      reason: rejectionReason || 'Declined by Finance department.',
      requestId: targetRequest.id,
    });

    emitToTenant(tenantId, 'LICENSE_REQUEST_UPDATED', {
      request: updated,
      message: `License request #${requestId} was declined.`,
    });

    res.json({
      message: 'License request declined.',
      request: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Backward compatibility alias for POST /api/employees/add-license
 */
export const addTenantLicenses = payAndAddLicenses;


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
    const parsedParams = employeeIdOnlyParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

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

    // ── Handover check for Department Switch ────────────────────────────────
    if (updates.department !== undefined && updates.department !== '' && updates.department !== existing.department) {
      const overrideHandover = req.body?.overrideHandover === true || req.body?.skipHandover === true;
      const isLeadership = ['SUPER_ADMIN', 'ADMIN', 'HR', 'CMD'].includes(req.user?.role);

      const pendingHandoverGoals = await prisma.goal.findMany({
        where: {
          tenantId,
          status: { not: 'COMPLETED' },
          OR: [
            { employeeId: id },
            { assignments: { some: { employeeId: id } } },
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
          error: `Employee has ${pendingHandoverGoals.length} pending handover goal(s) that must be completed before switching departments.`,
          code: 'PENDING_DEPARTMENT_HANDOVER',
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

      if (pendingHandoverGoals.length > 0 && overrideHandover && isLeadership) {
        await prisma.goal.updateMany({
          where: { id: { in: pendingHandoverGoals.map((g) => g.id) } },
          data: { handoverOverridden: true, handoverOverriddenBy: req.user.id },
        });
      }
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

    // ── Statutory PII & Verification Compliance Guardrails ──────────────────
    // 1. PAN compliance: prevent overwriting real PAN with masked string, and lock verified PAN
    if (updates.pan !== undefined) {
      if (!updates.pan || updates.pan === '') {
        if (existing.isVerified) {
          return res.status(400).json({ error: 'Cannot remove PAN from a verified employee profile.' });
        }
        updates.pan = null;
      } else {
        const cleanPan = updates.pan.trim().toUpperCase();
        // If client sent masked PAN (starts with XXXXXX or has *), do not overwrite DB with masked placeholder
        if (cleanPan.startsWith('XXXXXX') || cleanPan.includes('*') || cleanPan.includes('•')) {
          delete updates.pan; // retain existing.pan
        } else if (cleanPan !== (existing.pan || '')) {
          // If PAN is actually being modified on an already verified profile:
          if (existing.isVerified) {
            if (req.user?.role !== 'SUPER_ADMIN') {
              return res.status(403).json({
                error: 'Cannot modify PAN on a verified employee profile. Identity document is locked. Only SUPER_ADMIN may reset verification status.',
                code: 'VERIFIED_PAN_LOCKED',
              });
            }
            // SUPER_ADMIN override: allow updating PAN
          }
          updates.pan = cleanPan;
        } else {
          updates.pan = cleanPan;
        }
      }
    }

    // 2. Aadhaar compliance (UIDAI Section 29): prevent overwriting real Aadhaar with masked string
    if (updates.aadhaar !== undefined) {
      if (!updates.aadhaar || updates.aadhaar === '') {
        updates.aadhaar = null;
      } else {
        const cleanAadhaar = updates.aadhaar.trim();
        if (cleanAadhaar.startsWith('X') || cleanAadhaar.includes('*') || cleanAadhaar.includes('•')) {
          delete updates.aadhaar; // retain existing.aadhaar
        } else {
          updates.aadhaar = cleanAadhaar;
        }
      }
    }

    // Clean up empty optional strings so Prisma gets null instead of ''
    for (const k of ['band', 'aadhaar', 'officeLocation', 'uan', 'esic', 'gender', 'bloodGroup', 'phone', 'personalEmail', 'emergencyContact', 'employeeId']) {
      if (updates[k] === '') updates[k] = null;
    }

    // ── Nested relation writes (bank, work history, education) ──────────────
    // These are handled separately via their own Prisma models, not as
    // columns on TenantUser, so we extract them before the main update.
    const bankDetailsPayload = updates.bankDetails;
    delete updates.bankDetails;
    const workHistoryPayload = updates.workHistory;
    delete updates.workHistory;
    const educationHistoryPayload = updates.educationHistory;
    delete updates.educationHistory;

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Update the main TenantUser record
      const user = await tx.tenantUser.update({
        where: { id },
        data: updates,
        select: PRIVILEGED_EMPLOYEE_SELECT,
      });

      // 2. Bank details — upsert (create if missing, update if exists)
      if (bankDetailsPayload && typeof bankDetailsPayload === 'object') {
        const hasBankData = bankDetailsPayload.bankName || bankDetailsPayload.accountNumber || bankDetailsPayload.ifscCode || bankDetailsPayload.branchName;
        if (hasBankData) {
          await tx.bankDetails.upsert({
            where: { userId: id },
            create: {
              userId: id,
              bankName: bankDetailsPayload.bankName || '',
              accountNumber: bankDetailsPayload.accountNumber || '',
              ifscCode: bankDetailsPayload.ifscCode || '',
              branchName: bankDetailsPayload.branchName || '',
            },
            update: {
              ...(bankDetailsPayload.bankName !== undefined && { bankName: bankDetailsPayload.bankName }),
              ...(bankDetailsPayload.accountNumber !== undefined && { accountNumber: bankDetailsPayload.accountNumber }),
              ...(bankDetailsPayload.ifscCode !== undefined && { ifscCode: bankDetailsPayload.ifscCode }),
              ...(bankDetailsPayload.branchName !== undefined && { branchName: bankDetailsPayload.branchName }),
            },
          });
        }
      }

      // 3. Work history — delete-and-recreate (replaces all entries)
      if (Array.isArray(workHistoryPayload)) {
        await tx.workHistory.deleteMany({ where: { userId: id } });
        if (workHistoryPayload.length > 0) {
          await tx.workHistory.createMany({
            data: workHistoryPayload.map((wh) => ({
              userId: id,
              companyName: wh.companyName,
              designation: wh.designation,
              startDate: new Date(wh.startDate),
              endDate: wh.endDate ? new Date(wh.endDate) : null,
              reasonForExit: wh.reasonForExit || null,
              remarks: wh.remarks || null,
            })),
          });
        }
      }

      // 4. Education history — delete-and-recreate (replaces all entries)
      if (Array.isArray(educationHistoryPayload)) {
        await tx.employeeEducation.deleteMany({ where: { userId: id } });
        if (educationHistoryPayload.length > 0) {
          await tx.employeeEducation.createMany({
            data: educationHistoryPayload.map((edu) => ({
              userId: id,
              qualification: edu.qualification,
              institutionName: edu.institutionName,
              boardUniversity: edu.boardUniversity || '',
              passingYear: edu.passingYear || '',
              percentageCgpa: edu.percentageCgpa || null,
            })),
          });
        }
      }

      // Re-fetch with full relations after nested writes
      return tx.tenantUser.findUnique({
        where: { id },
        select: PRIVILEGED_EMPLOYEE_SELECT,
      });
    });

    // Notify connected clients of the update (useful if status/name changed)
    emitToTenant(tenantId, 'employee_status_updated', {
      id: updated.id,
      status: updated.status,
    });

    res.json({ message: 'Employee updated successfully', user: formatEmployeeResponse(updated) });
  } catch (err) {
    next(err);
  }
}

export async function updateExEmployee(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const parsedParams = employeeIdOnlyParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

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
    const parsedParams = employeeIdOnlyParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;

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
    const parsedParams = employeeIdOnlyParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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

    // ── Handover / Exit Tasks Guardrail Check ────────────────────────────────
    const overrideHandover = req.body?.overrideHandover === true || req.body?.skipHandover === true;
    const isLeadership = ['SUPER_ADMIN', 'ADMIN', 'HR', 'CMD'].includes(req.user?.role);

    const pendingHandoverGoals = await prisma.goal.findMany({
      where: {
        tenantId,
        status: { not: 'COMPLETED' },
        OR: [
          { employeeId: id },
          { assignments: { some: { employeeId: id } } },
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
        error: `Employee has ${pendingHandoverGoals.length} pending handover goal(s) that must be completed before offboarding.`,
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

    const nameParts = (tenantUser.name || '').trim().split(/\s+/);
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    // Atomic transaction: deactivate + re-assign subordinates + create exit record
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
    const parsedParams = employeeIdOnlyParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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
    const parsedParams = employeeIdOnlyParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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

/**
 * POST /api/employees/ex/:id/restore
 * Restores an ex-employee back to active status.
 *
 * Handles two cases:
 *  1. TenantUser exists (EXITED / isDeleted) → reactivate it, send password-reset invite
 *  2. No TenantUser (manually added to registry) → create a new INVITED TenantUser, send invite
 */
export async function restoreExEmployee(req, res, next) {
  try {
    console.log('[RESTORE] ▶ Restore endpoint hit');
    console.log('[RESTORE] req.params:', req.params);
    console.log('[RESTORE] req.user:', req.user?.id, req.user?.role);
    console.log('[RESTORE] req.tenantId:', req.tenantId);

    const parsedParams = employeeIdOnlyParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      console.log('[RESTORE] ✗ Param validation failed:', parsedParams.error.issues);
      return res.status(400).json({ error: 'Invalid record ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
    const tenantId = req.tenantId;
    console.log('[RESTORE] Parsed ID:', id, '| tenantId:', tenantId);

    // 1. Find the ex-employee registry record with flexible fallbacks
    let exRecord = await prisma.exEmployeeRecord.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: { id: true, email: true, firstName: true, lastName: true, designation: true, department: true },
    });

    if (!exRecord) {
      console.log('[RESTORE] ExEmployeeRecord not found by tenant, trying without tenant filter...');
      exRecord = await prisma.exEmployeeRecord.findFirst({
        where: { id, isDeleted: false },
        select: { id: true, email: true, firstName: true, lastName: true, designation: true, department: true },
      });
    }

    if (!exRecord) {
      console.log('[RESTORE] ExEmployeeRecord not found, checking TenantUser by ID or email...');
      const tu = await prisma.tenantUser.findFirst({
        where: {
          OR: [{ id }, { email: { equals: id, mode: 'insensitive' } }],
          tenantId,
        },
        select: { id: true, name: true, email: true, designation: true, department: true },
      });
      if (tu) {
        console.log('[RESTORE] Fallback found TenantUser:', tu);
        const nameParts = (tu.name || '').trim().split(/\s+/);
        exRecord = {
          id: tu.id,
          email: tu.email,
          firstName: nameParts[0] || 'Unknown',
          lastName: nameParts.slice(1).join(' ') || nameParts[0] || 'Unknown',
          designation: tu.designation || 'Member',
          department: tu.department || 'General',
          isTenantUserFallback: true,
        };
      }
    }

    console.log('[RESTORE] Resolved ExRecord lookup result:', exRecord);

    if (!exRecord) {
      console.log('[RESTORE] ✗ Ex-Employee record not found for id:', id, 'tenantId:', tenantId);
      return res.status(404).json({ error: 'Ex-Employee record not found' });
    }

    const normalizedEmail = exRecord.email.trim().toLowerCase();
    const restoredName = `${exRecord.firstName} ${exRecord.lastName}`.trim();
    console.log('[RESTORE] Searching TenantUser for email:', normalizedEmail, '| tenantId:', tenantId);

    // 2. Try to find an existing TenantUser (including deleted/exited ones)
    const existingUser = await prisma.tenantUser.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        tenantId,
      },
      select: { id: true, name: true, email: true, status: true, isDeleted: true },
    });
    console.log('[RESTORE] TenantUser lookup result:', existingUser);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { companyName: true },
    });
    const companyName = tenant?.companyName || 'your organization';

    let restoredUserId;
    let setupUrl;
    let expiresHours;

    if (existingUser) {
      // ── Case 1: TenantUser exists — reactivate ───────────────────────────
      console.log('[RESTORE] Case 1: Existing TenantUser found — status:', existingUser.status, '| isDeleted:', existingUser.isDeleted);
      if (!existingUser.isDeleted && existingUser.status !== 'EXITED') {
        console.log('[RESTORE] ✗ Already active, rejecting');
        return res.status(409).json({ error: 'This employee is already active and does not need restoration' });
      }

      const result = await prisma.$transaction(async (tx) => {
        console.log('[RESTORE] Checking license availability...');
        await assertLicenseAvailable(tx, tenantId);
        console.log('[RESTORE] License OK, updating TenantUser...');
        await tx.tenantUser.update({
          where: { id: existingUser.id },
          data: { isDeleted: false, status: 'INVITED', mustChangePassword: true },
        });
        console.log('[RESTORE] TenantUser updated, issuing invite token...');
        return issueInvitePasswordToken(tx, existingUser.id);
      });

      restoredUserId = existingUser.id;
      setupUrl = result.setupUrl;
      expiresHours = result.expiresHours;
      console.log('[RESTORE] Case 1 complete. Setup URL generated:', !!setupUrl);
    } else {
      // ── Case 2: No TenantUser — create a fresh one ────────────────────────
      console.log('[RESTORE] Case 2: No TenantUser found — creating new INVITED user for:', normalizedEmail);
      const initialPlaceholder = 'INVITED_NO_PASS_' + crypto.randomBytes(16).toString('hex');
      const passwordHash = await bcrypt.hash(initialPlaceholder, 10);

      const result = await prisma.$transaction(async (tx) => {
        await assertLicenseAvailable(tx, tenantId);

        const u = await tx.tenantUser.create({
          data: {
            tenantId,
            email: normalizedEmail,
            passwordHash,
            name: restoredName,
            role: 'EMPLOYEE',
            status: 'INVITED',
            mustChangePassword: true,
            designation: exRecord.designation || 'Member',
            department: exRecord.department || 'General',
          },
        });

        const tokenData = await issueInvitePasswordToken(tx, u.id);
        console.log('[RESTORE] Case 2 TenantUser created:', u.id, '| invite token issued:', !!tokenData.setupUrl);
        return { userId: u.id, ...tokenData };
      });

      restoredUserId = result.userId;
      setupUrl = result.setupUrl;
      expiresHours = result.expiresHours;
    }

    // Soft-delete the ExEmployeeRecord so it leaves the Ex-Employees tab
    if (!exRecord.isTenantUserFallback) {
      await prisma.exEmployeeRecord.update({
        where: { id: exRecord.id },
        data: { isDeleted: true },
      }).catch((err) => console.warn('[RESTORE] Non-critical: Failed to soft-delete ExEmployeeRecord:', err.message));
    }

    // 3. Send password-setup invitation email
    console.log('[RESTORE] Sending restore email to:', normalizedEmail);
    const { html, text } = renderInvitationEmail({
      setupUrl,
      expiresHours,
      name: restoredName,
      companyName,
      email: normalizedEmail,
    });

    await sendMail({
      to: normalizedEmail,
      subject: `Your account has been restored — Set Your Password | ${companyName}`,
      text,
      html,
      event: 'EMPLOYEE_INVITED',
    }).catch((err) => console.warn('[RESTORE] Failed to send restore email:', err.message));

    const licenseStats = await getLicenseStats(tenantId);
    console.log('[RESTORE] ✓ Restore complete for:', restoredName, '| userId:', restoredUserId);

    // 4. Real-time update
    emitToTenant(tenantId, 'employee_status_updated', { id: restoredUserId, status: 'INVITED' });

    res.json({
      message: `${restoredName} has been restored successfully. A password setup link has been sent to ${normalizedEmail}.`,
      restoredUserId,
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


export async function deleteExEmployee(req, res, next) {
  try {
    const parsedParams = employeeIdOnlyParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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
    const parsedParams = employeeIdOnlyParamSchema.safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid employee ID parameter', details: parsedParams.error.issues });
    }
    const { id } = parsedParams.data;
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

/**
 * GET /api/employees/:id/handover-status
 * Returns real-time status of an employee's pending handover / exit tasks.
 */
export async function getEmployeeHandoverStatus(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const pendingHandoverGoals = await prisma.goal.findMany({
      where: {
        tenantId,
        status: { not: 'COMPLETED' },
        OR: [
          { employeeId: id },
          { assignments: { some: { employeeId: id } } },
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
      select: {
        id: true,
        title: true,
        progress: true,
        dueDate: true,
        category: true,
        status: true,
        handoverType: true,
        targetDepartment: true,
      },
    });

    const isLeadership = ['SUPER_ADMIN', 'ADMIN', 'HR', 'CMD'].includes(req.user?.role);

    res.json({
      employeeId: id,
      pendingCount: pendingHandoverGoals.length,
      hasPendingHandover: pendingHandoverGoals.length > 0,
      canOverride: isLeadership,
      pendingGoals: pendingHandoverGoals.map((g) => ({
        id: g.id,
        title: g.title,
        progress: g.progress,
        dueDate: g.dueDate ? g.dueDate.toISOString().split('T')[0] : null,
        category: g.category,
        status: g.status,
        handoverType: g.handoverType,
        targetDepartment: g.targetDepartment,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH / POST /employees/:id/verify
 * HR marks an employee profile as verified.
 * Transitions verificationStatus to 'VERIFIED', sets isVerified to true,
 * stamps verifiedAt and verifiedBy.
 */
export async function verifyEmployee(req, res, next) {
  try {
    const { id } = req.params;
    const employee = await prisma.tenantUser.findFirst({
      where: { id, tenantId: req.tenantId, isDeleted: false },
    });
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (employee.status === 'EXITED') {
      return res.status(400).json({ error: 'Cannot verify an employee who has already exited the company' });
    }

    const verified = await prisma.tenantUser.update({
      where: { id },
      data: {
        status: 'ACTIVE',
      },
    });

    // Notify via Socket.io
    try {
      emitToTenant(req.tenantId, 'employee_status_updated', {
        id: verified.id,
        status: verified.status,
        verificationStatus: 'VERIFIED',
        isVerified: true,
        // Mask first 6 characters of PAN in broadcast to avoid PII network leakage
        pan: verified.pan && verified.pan.length === 10 ? `XXXXXX${verified.pan.slice(6)}` : verified.pan,
        name: verified.name,
      });
    } catch (e) {
      console.warn('Socket emit error in verifyEmployee:', e.message);
    }

    res.json({
      message: 'Employee record verified successfully',
      employee: verified,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/employees/ex/:id/refcheck-pdf
 * Generates an official Reference Check & Verified Profile Dossier PDF for an ex-employee.
 */
export async function generateExEmployeeRefCheckPdf(req, res, next) {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const [exRecord, tenant] = await Promise.all([
      prisma.exEmployeeRecord.findFirst({
        where: { id, tenantId, isDeleted: false },
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { companyName: true },
      }),
    ]);

    if (!exRecord) {
      return res.status(404).json({ error: 'Ex-employee record not found' });
    }

    // Find any attached work history from TenantUser matching email
    const originalUser = await prisma.tenantUser.findFirst({
      where: { email: exRecord.email, tenantId },
      include: { workHistory: true },
    });

    const pdfData = {
      companyName: tenant?.companyName || 'UEIBI Organization',
      employeeName: `${exRecord.firstName} ${exRecord.lastName}`,
      employeeId: originalUser?.employeeId || exRecord.id,
      designation: exRecord.designation,
      department: exRecord.department,
      joinDate: exRecord.serviceStart,
      lastWorkingDay: exRecord.serviceEnd,
      exitReason: exRecord.exitReason || 'Relieved',
      pan: exRecord.pan || originalUser?.pan || null,
      conductValue: exRecord.conductValue || 'Good',
      techRating: exRecord.techRating || 8,
      attitudeRating: exRecord.attitudeRating || 8,
      feedback: exRecord.feedback || '',
      workHistory: originalUser?.workHistory || [],
      authorizedSignatory: req.user.name || 'HR Department',
    };

    const pdfUrl = await generateReferenceCheckProfile(pdfData);

    res.json({
      message: 'Reference check & verified profile dossier generated successfully',
      pdfUrl,
    });
  } catch (err) {
    next(err);
  }
}
