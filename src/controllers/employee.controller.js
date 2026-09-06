import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { emitToTenant } from '../lib/socket.js';
import {
  updateActiveEmployeeSchema,
  updateExEmployeeSchema,
  updateNonJoinerSchema
} from '../validations/employee.schema.js';
import { env } from '../config/env.js';
import { canCreateRole, getAllowedRoles } from '../lib/roleHierarchy.js';

export async function inviteEmployee(req, res, next) {
  try {
    const { email, name, role, designation, department, joinDate, phone, pan, dob, feedbackRemarks } = req.body || {};
    if (!email || !name) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

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

    // Check license limit
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const activeCount = await prisma.tenantUser.count({
      where: {
        tenantId,
        status: { in: ['ACTIVE', 'INVITED'] },
      },
    });

    if (activeCount >= tenant.licenseLimit) {
      return res.status(400).json({
        error: `License limit reached (${tenant.licenseLimit} licenses). Cannot invite more users.`,
      });
    }

    // Generate temp password
    const tempPassword = 'UEIBI-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const user = await prisma.tenantUser.create({
      data: {
        tenantId,
        email: email.trim().toLowerCase(),
        passwordHash,
        name: name.trim(),
        role: targetRole, // validated & authorized above
        status: 'INVITED',
        mustChangePassword: true,
        designation,
        department,
        joinDate: joinDate ? new Date(joinDate) : null,
        phone,
        pan,
        dob: dob ? new Date(`${dob}-01-01`) : null, // Store birth year correctly as DateTime
        remarks: feedbackRemarks,
      },
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

    res.status(201).json({
      message: 'Employee invited successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
      },
    });
  } catch (err) {
    next(err);
  }
}
export async function onboardEmployee(req, res, next) {
  try {
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
    } = req.body || {};

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required to complete onboarding' });
    }

    const userId = req.user.id;

    const user = await prisma.tenantUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
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
          workHistory.map((history) =>
            tx.workHistory.create({
              data: {
                userId,
                companyName: history.companyName,
                designation: history.designation,
                startDate: new Date(history.startDate),
                endDate: new Date(history.endDate),
                reasonForExit: history.reasonForExit,
              },
            })
          )
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
    } = req.body || {};

    if (!firstName || !lastName || !email || !phone || !pan || !designation || !department || !serviceStart || !serviceEnd) {
      return res.status(400).json({ error: 'Required fields are missing' });
    }

    const record = await prisma.exEmployeeRecord.create({
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
        serviceStart: new Date(serviceStart),
        serviceEnd: new Date(serviceEnd),
        exitReason: exitReason || 'Resigned',
        techRating: parseInt(techRating, 10) || 8,
        attitudeRating: parseInt(attitudeRating, 10) || 8,
        conductValue: conductValue || 'Good',
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
    const { items } = req.body || {};

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const createdItems = await prisma.$transaction(
      items.map((item) => {
        // Parse name into first and last name
        const nameParts = (item.name || '').trim().split(/\s+/);
        const firstName = nameParts[0] || 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || 'Unknown';

        // Extract rating if present or calculate from tech/attitude
        const tr = parseInt(item.techRating || item.technical_rating, 10) || 8;
        const ar = parseInt(item.attitudeRating || item.professional_rating, 10) || 8;

        return prisma.exEmployeeRecord.create({
          data: {
            tenantId,
            firstName,
            lastName,
            email: (item.email || '').trim().toLowerCase(),
            phone: item.phone || '0000000000',
            pan: (item.pan || 'PANPLACEHR').trim().toUpperCase(),
            dob: item.dob ? String(item.dob) : '1990',
            designation: item.designation || item.employee_designation || 'Staff',
            department: item.department || 'General',
            serviceStart: new Date(item.serviceStart || item.service_start || new Date()),
            serviceEnd: new Date(item.serviceEnd || item.service_end || new Date()),
            exitReason: item.exitReason || 'Resigned',
            techRating: tr,
            attitudeRating: ar,
            conductValue: item.conductValue || item.conduct_value || 'Good',
            feedback: item.feedback || '',
            submittedBy: req.user.name || 'Direct',
            status: 'Published',
          },
        });
      })
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

    res.status(201).json({ items: formatted });
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
    } = req.body || {};

    if (!firstName || !lastName || !email || !phone || !pan || !designation || !department || !offerReleaseDate || !dateOfJoining) {
      return res.status(400).json({ error: 'Required fields are missing' });
    }

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
        salary: String(salary),
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
    const { items } = req.body || {};

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const createdItems = await prisma.$transaction(
      items.map((item) => {
        const nameParts = (item.name || '').trim().split(/\s+/);
        const firstName = nameParts[0] || 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || 'Unknown';

        return prisma.nonJoinerRecord.create({
          data: {
            tenantId,
            firstName,
            lastName,
            email: (item.email || '').trim().toLowerCase(),
            phone: item.phone || '0000000000',
            pan: (item.pan || 'PANPLACEHR').trim().toUpperCase(),
            dob: item.dob ? String(item.dob) : '1990',
            designation: item.designation || 'Staff',
            department: item.department || 'General',
            offerReleaseDate: new Date(item.offerReleaseDate || item.offer_release_date || new Date()),
            dateOfJoining: new Date(item.dateOfJoining || item.date_of_joining || new Date()),
            salary: String(item.salary || '0'),
            offerAccepted: item.offerAccepted || 'Yes',
            feedback: item.feedback || '',
            submittedBy: req.user.name || 'Direct',
            status: 'Published',
          },
        });
      })
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

    res.status(201).json({ items: formatted });
  } catch (err) {
    next(err);
  }
}

// ── Update Controllers ──

export async function updateEmployee(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    const parsed = updateActiveEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const updates = parsed.data;

    const existing = await prisma.tenantUser.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Filter out fields that shouldn't be updated via this route
    delete updates.id;
    delete updates.tenantId;
    delete updates.passwordHash;
    delete updates.createdAt;
    delete updates.updatedAt;
    delete updates.role; // Role updates should have a separate mechanism if needed
    delete updates.status;
    delete updates.type;
    delete updates.submittedBy;
    delete updates.createdDate;
    delete updates.email; // Email is read-only for active employees in Edit Modal

    if (updates.joinDate) updates.joinDate = new Date(updates.joinDate);
    if (updates.dob) {
      // If it's a full date (YYYY-MM-DD), use directly; if year-only (YYYY), append -01-01
      updates.dob = updates.dob.length === 4 ? new Date(`${updates.dob}-01-01`) : new Date(updates.dob);
      if (isNaN(updates.dob.getTime())) delete updates.dob; // Drop if still invalid
    } else {
      delete updates.dob; // Don't send null/empty to Prisma
    }

    // Clean up empty optional strings so Prisma gets null instead of ''
    if (updates.band === '') updates.band = null;
    if (updates.aadhaar === '') updates.aadhaar = null;

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

    await prisma.tenantUser.update({
      where: { id },
      data: { isDeleted: true },
    });

    res.json({ success: true, message: 'Employee soft-deleted successfully' });
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
