import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { env } from '../config/env.js';
import { generateRawToken, hashToken } from '../lib/tokens.js';
import { sendMail } from '../lib/mailer.js';
import { renderPasswordResetEmail } from '../lib/emailTemplates.js';
import { loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../validations/auth.schema.js';

export async function login(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { email, password } = parsed.data;
    const cleanEmail = email.trim();
    const normalizedEmail = cleanEmail.toLowerCase();

    // 1. Case-insensitive lookup in TenantUser
    let user = await prisma.tenantUser.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
      include: {
        tenant: true,
        bankDetails: true,
        workHistory: true,
      },
    });

    // 2. If not found in TenantUser, check CompanyRegistration
    if (!user) {
      const reg = await prisma.companyRegistration.findFirst({
        where: {
          OR: [
            { email: { equals: normalizedEmail, mode: 'insensitive' } },
            { hrEmail: { equals: normalizedEmail, mode: 'insensitive' } },
            { financeEmail: { equals: normalizedEmail, mode: 'insensitive' } },
          ],
        },
        include: { tenant: true },
      });

      if (reg) {
        console.log(`[AUTH] Found CompanyRegistration for "${cleanEmail}" (status: ${reg.status})`);
        const regPasswordMatch = await bcrypt.compare(password, reg.passwordHash);
        if (regPasswordMatch) {
          // Provision or locate tenant
          let tenant = reg.tenant;
          if (!tenant) {
            tenant = await prisma.tenant.findFirst({
              where: {
                OR: [
                  { registrationId: reg.id },
                  { domainName: reg.domainName },
                ],
              },
            });
          }
          if (!tenant) {
            tenant = await prisma.tenant.create({
              data: {
                companyName: reg.companyName,
                domainName: reg.domainName,
                tenantCode: reg.tenantCode || reg.companyName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase(),
                licenseLimit: reg.licenseQuantity || 50,
                registrationId: reg.id,
              },
            });
          }

          // Determine role based on email in registration
          let role = 'HR';
          if (reg.email.toLowerCase() === normalizedEmail) {
            role = 'SUPER_ADMIN';
          } else if (reg.financeEmail && reg.financeEmail.toLowerCase() === normalizedEmail) {
            role = 'FINANCE';
          }

          user = await prisma.tenantUser.create({
            data: {
              tenantId: tenant.id,
              email: normalizedEmail,
              passwordHash: reg.passwordHash,
              name: reg.fullName || 'User',
              role,
              status: 'ACTIVE',
              mustChangePassword: false,
              designation: reg.designation || 'Manager',
            },
            include: {
              tenant: true,
              bankDetails: true,
              workHistory: true,
            },
          });
          console.log(`[AUTH] Auto-provisioned TenantUser: ${user.email} (${user.role}) in "${tenant.companyName}"`);
        }
      }
    }

    if (!user) {
      console.warn(`[AUTH] 401: User "${cleanEmail}" not found in database`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status === 'EXITED') {
      return res.status(403).json({ error: 'Access forbidden: this account is inactive/exited' });
    }

    let match = await bcrypt.compare(password, user.passwordHash);

    // Fallback: If password did not match user.passwordHash, check if password matches CompanyRegistration
    if (!match) {
      const reg = await prisma.companyRegistration.findFirst({
        where: {
          OR: [
            { email: { equals: normalizedEmail, mode: 'insensitive' } },
            { hrEmail: { equals: normalizedEmail, mode: 'insensitive' } },
          ],
        },
      });
      if (reg && reg.passwordHash) {
        const regMatch = await bcrypt.compare(password, reg.passwordHash);
        if (regMatch) {
          match = true;
          // Sync updated passwordHash to TenantUser
          await prisma.tenantUser.update({
            where: { id: user.id },
            data: { passwordHash: reg.passwordHash },
          }).catch(() => {});
        }
      }
    }

    if (!match) {
      console.warn(`[AUTH] 401: Password mismatch for user "${cleanEmail}"`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Auto-activate user if they were in INVITED status
    if (user.status === 'INVITED') {
      await prisma.tenantUser.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      }).catch(() => {});
      user.status = 'ACTIVE';
    }

    // Standardize email to lowercase in database if stored with capital letters
    if (user.email !== normalizedEmail) {
      await prisma.tenantUser.update({
        where: { id: user.id },
        data: { email: normalizedEmail },
      }).catch(() => {});
      user.email = normalizedEmail;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tenantId: user.tenantId,
    });

    // Set HTTP-only session cookie
    res.cookie('ueibi_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        tenantId: user.tenantId,
        companyName: user.tenant.companyName,
        designation: user.designation,
        department: user.department,
        band: user.band,
        phone: user.phone,
        pan: user.pan,
        aadhaar: user.aadhaar,
        dob: user.dob,
        joinDate: user.joinDate,
        gender: user.gender,
        bloodGroup: user.bloodGroup,
        personalEmail: user.personalEmail,
        emergencyContact: user.emergencyContact,
        uan: user.uan,
        esic: user.esic,
        hubBio: user.hubBio || '',
        hubBirthday: user.hubBirthday || '',
        profileSnaps: Array.isArray(user.profileSnaps) ? user.profileSnaps : [],
        docs: user.docs || [],
        bankDetails: user.bankDetails,
        workHistory: user.workHistory,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await prisma.tenantUser.findUnique({
      where: { id: req.user.id },
      include: { 
        tenant: true,
        bankDetails: true,
        workHistory: true
      },
    });

    if (!user || user.isDeleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.status === 'EXITED') {
      return res.status(403).json({ error: 'Access forbidden: this account is inactive/exited' });
    }


    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        tenantId: user.tenantId,
        companyName: user.tenant.companyName,
        designation: user.designation,
        department: user.department,
        band: user.band,
        phone: user.phone,
        pan: user.pan,
        aadhaar: user.aadhaar,
        dob: user.dob,
        joinDate: user.joinDate,
        gender: user.gender,
        bloodGroup: user.bloodGroup,
        personalEmail: user.personalEmail,
        emergencyContact: user.emergencyContact,
        uan: user.uan,
        esic: user.esic,
        hubBio: user.hubBio || '',
        hubBirthday: user.hubBirthday || '',
        profileSnaps: Array.isArray(user.profileSnaps) ? user.profileSnaps : [],
        docs: user.docs || [],
        bankDetails: user.bankDetails,
        workHistory: user.workHistory,
      },
    });
  } catch (err) {
    next(err);
  }
}

export function logout(req, res) {
  res.clearCookie('ueibi_session', { path: '/' });
  res.json({ ok: true });
}

/**
 * Initiates the Forgot Password recovery flow.
 * Validates email, searches user, creates secure one-time reset token, sends email,
 * and always returns a generic response to prevent account enumeration.
 */
export async function forgotPassword(req, res, next) {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const normalizedEmail = email.trim().toLowerCase();

    const genericMessage =
      'If an account exists for this email address, a password reset link has been sent.';

    // Look up user by normalized email (case-insensitive)
    const user = await prisma.tenantUser.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        isDeleted: true,
      },
    });

    // If account does not exist or is inactive/exited, respond with generic message (anti-enumeration)
    if (!user || user.isDeleted || user.status === 'EXITED') {
      return res.status(200).json({ message: genericMessage });
    }

    // Generate high-entropy 32-byte raw token and SHA-256 hash
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);

    const expiresMinutes = env.passwordResetTokenExpiresMinutes || 30;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);
    const tokenId = `prt_${crypto.randomBytes(12).toString('hex')}`;

    // Atomically invalidate old tokens for this user and store new token hash
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "password_reset_tokens"
         SET "usedAt" = CURRENT_TIMESTAMP
         WHERE "userId" = $1 AND "usedAt" IS NULL`,
        user.id
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO "password_reset_tokens" ("id", "userId", "tokenHash", "expiresAt", "usedAt", "createdAt")
         VALUES ($1, $2, $3, $4, NULL, CURRENT_TIMESTAMP)`,
        tokenId,
        user.id,
        tokenHash,
        expiresAt
      );
    });

    // Build reset URL using environment frontend origin
    const resetUrl = `${env.frontendOrigin}/reset-password?token=${rawToken}`;

    // Prepare and dispatch password reset email
    const { html, text } = renderPasswordResetEmail({
      resetUrl,
      expiresMinutes,
      name: user.name,
    });

    await sendMail({
      to: user.email,
      subject: 'Reset your UEIBI password',
      html,
      text,
      event: 'AUTH_PASSWORD_RESET',
    });

    return res.status(200).json({ message: genericMessage });
  } catch (err) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({
        error: err.issues?.[0]?.message || 'Validation failed',
        details: err.issues || [],
      });
    }
    next(err);
  }
}

/**
 * Validates one-time reset token, updates user password, marks token as used,
 * and invalidates any concurrent/alternate reset tokens within an atomic transaction.
 */
export async function resetPassword(req, res, next) {
  try {
    const { token: rawToken, newPassword } = resetPasswordSchema.parse(req.body);
    const tokenHash = hashToken(rawToken);
    const now = new Date();

    const genericError = 'This password reset link is invalid or has expired.';

    const resetResult = await prisma.$transaction(async (tx) => {
      // Find token record with row lock to prevent race conditions
      const rows = await tx.$queryRawUnsafe(
        `SELECT prt."id", prt."userId", prt."expiresAt", prt."usedAt",
                u."id" AS "userExists", u."status", u."isDeleted"
         FROM "password_reset_tokens" prt
         JOIN "tenant_users" u ON prt."userId" = u."id"
         WHERE prt."tokenHash" = $1
         LIMIT 1
         FOR UPDATE`,
        tokenHash
      );

      const tokenRecord = rows?.[0];
      if (!tokenRecord) {
        return { ok: false, error: genericError };
      }

      if (tokenRecord.usedAt !== null) {
        return { ok: false, error: genericError };
      }

      if (new Date(tokenRecord.expiresAt) <= now) {
        return { ok: false, error: genericError };
      }

      if (tokenRecord.isDeleted || tokenRecord.status === 'EXITED') {
        return { ok: false, error: 'Account is inactive or not found.' };
      }

      // Atomic conditional update to mark token as used
      const updateResult = await tx.$executeRawUnsafe(
        `UPDATE "password_reset_tokens"
         SET "usedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "usedAt" IS NULL`,
        tokenRecord.id
      );

      if (updateResult === 0) {
        return { ok: false, error: genericError };
      }

      // Hash new password with existing bcrypt implementation (10 rounds)
      const newHash = await bcrypt.hash(newPassword, 10);

      // Update user password and clear mustChangePassword
      await tx.$executeRawUnsafe(
        `UPDATE "tenant_users"
         SET "passwordHash" = $1, "mustChangePassword" = false, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $2`,
        newHash,
        tokenRecord.userId
      );

      // Invalidate any other active reset tokens for this user
      await tx.$executeRawUnsafe(
        `UPDATE "password_reset_tokens"
         SET "usedAt" = CURRENT_TIMESTAMP
         WHERE "userId" = $1 AND "id" != $2 AND "usedAt" IS NULL`,
        tokenRecord.userId,
        tokenRecord.id
      );

      return { ok: true };
    });

    if (!resetResult.ok) {
      return res.status(400).json({ error: resetResult.error });
    }

    // Clear session cookie if any
    res.clearCookie('ueibi_session', { path: '/' });

    return res.status(200).json({
      message: 'Password reset successfully.',
    });
  } catch (err) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({
        error: err.issues?.[0]?.message || 'Validation failed',
        details: err.issues || [],
      });
    }
    next(err);
  }
}

