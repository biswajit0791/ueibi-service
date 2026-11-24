import { ACCOUNT_EXITED } from '../lib/accountAccess.js';
import { issuePasswordResetLink } from '../services/passwordReset.service.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { loadCapabilities } from '../lib/capabilities.js';
import { getEffectiveUserPermissions } from '../services/permission.service.js';
import { env } from '../config/env.js';
import { hashToken } from '../lib/tokens.js';
import { sendMail } from '../lib/mailer.js';
import { renderPasswordResetEmail } from '../lib/emailTemplates.js';
import { loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../validations/auth.schema.js';
import { tenantAccessDenial } from '../lib/tenantAccess.js';
import {
  is2FAEnforcedForUser,
  initiateLoginChallenge,
  verifyLoginChallenge,
  resendLoginChallenge,
  formatAuthUser,
  getUser2FAStatus,
  requestEnable2FA,
  verifyAndEnable2FA,
  disable2FA,
} from '../services/login2fa.service.js';
import { getRegistrationConfig } from '../services/registrationConfig.service.js';
import { getUserPlatformPermissions } from '../services/platformPermissions.service.js';
import { isPlatformUser } from '../lib/roles.js';
import { recordLoginSession, recordUserLogout } from '../services/sessionTracking.service.js';
import { parseCookies } from '../lib/cookies.js';
import { verifyToken } from '../lib/jwt.js';

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
    const user = await prisma.tenantUser.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
      include: {
        tenant: true,
        bankDetails: true,
        workHistory: true,
        educations: true,
      },
    });

    if (!user) {
      console.warn(`[AUTH] 401: User "${cleanEmail}" not found in database`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      console.warn(`[AUTH] 401: Password mismatch for user "${cleanEmail}"`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // ── Exited or Deactivated Account ─────────────────────────────────────────
    if (user.status === 'EXITED' || user.isDeleted) {
      console.warn(`[AUTH] 403: Attempted login by exited/inactive user "${cleanEmail}"`);
      return res.status(403).json({ error: ACCOUNT_EXITED.message, code: ACCOUNT_EXITED.code });
    }

    // ── Blocked by Platform Owner ─────────────────────────────────────────────
    if (user.isBlocked) {
      console.warn(`[AUTH] 403: Attempted login by blocked user "${cleanEmail}"`);
      return res.status(403).json({
        error: 'Your account has been blocked by the platform administrator.',
        code: 'USER_BLOCKED',
        reason: user.blockedReason || null,
      });
    }

    // ── Suspended company ────────────────────────────────────────────────────
    // Checked only AFTER the password matched, so this never reveals whether an
    // address exists to someone guessing. The message is specific on purpose: a
    // generic 401 would send a paying customer to support thinking their
    // password broke, when the account is deliberately frozen.
    const loginTenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { status: true, companyName: true },
    });
    const tenantDenial = loginTenant && tenantAccessDenial(loginTenant.status);
    if (tenantDenial) {
      console.warn(`[AUTH] 403: Tenant "${loginTenant.companyName}" is ${loginTenant.status}`);
      return res.status(403).json({ error: tenantDenial.message, code: tenantDenial.code });
    }

    // Stamp the login. Fire-and-forget: a failed stamp must never cost someone
    // their session, and the value is informational for the operator console.
    prisma.tenantUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }).catch((err) => console.warn('[AUTH] Notice stamping lastLoginAt:', err.message));

    // Auto-activate user if they were in INVITED status
    if (user.status === 'INVITED') {
      await prisma.tenantUser.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      }).catch(() => { });
      user.status = 'ACTIVE';
    }

    // Standardize email to lowercase in database if stored with capital letters
    if (user.email !== normalizedEmail) {
      await prisma.tenantUser.update({
        where: { id: user.id },
        data: { email: normalizedEmail },
      }).catch(() => { });
      user.email = normalizedEmail;
    }

    // ── Two-Factor Authentication (2FA) Check ────────────────────────────────
    // When enabled, do NOT issue tokens or session cookies at this stage.
    // Instead, dispatch an OTP to the user's verified email and return a challenge.
    const requires2FA = await is2FAEnforcedForUser(user);
    if (requires2FA) {
      const challengeData = await initiateLoginChallenge({ user, req });
      return res.json(challengeData);
    }

    const userCapabilities = await loadCapabilities(user.id);

    let effectiveAccess = null;
    try {
      effectiveAccess = await getEffectiveUserPermissions(user.tenantId, user.id);
    } catch (e) {
      // Fallback
    }

    let platformPermissions = null;
    if (isPlatformUser(user.role)) {
      try {
        platformPermissions = await getUserPlatformPermissions(user.id, user.role);
      } catch (e) {
        // Fallback
      }
    }

    let sessionRecord = null;
    try {
      sessionRecord = await recordLoginSession({ user, req, loginType: 'PASSWORD' });
    } catch (sErr) {
      console.warn('[AUTH] Session record warning:', sErr.message);
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tenantId: user.tenantId,
      sessionId: sessionRecord?.session?.id || null,
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
        capabilities: userCapabilities,
        effectivePermissions: effectiveAccess?.effectivePermissions || null,
        platformPermissions,
        dataScope: effectiveAccess?.dataScope || null,
        accessProfile: effectiveAccess?.user?.accessProfile || null,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        tenantId: user.tenantId,
        companyName: user.tenant.companyName,
        companyLogoUrl: user.tenant.logoUrl || null,
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
        presentAddressLine1: user.presentAddressLine1 || '',
        presentAddressLine2: user.presentAddressLine2 || '',
        presentCity: user.presentCity || '',
        presentState: user.presentState || '',
        presentPincode: user.presentPincode || '',
        permanentAddressLine1: user.permanentAddressLine1 || '',
        permanentAddressLine2: user.permanentAddressLine2 || '',
        permanentCity: user.permanentCity || '',
        permanentState: user.permanentState || '',
        permanentPincode: user.permanentPincode || '',
        sameAsPresentAddress: !!user.sameAsPresentAddress,
        linkedinUrl: user.linkedinUrl || '',
        primarySkills: Array.isArray(user.primarySkills) ? user.primarySkills : [],
        secondarySkills: Array.isArray(user.secondarySkills) ? user.secondarySkills : [],
        profilePhoto: user.profilePhoto || '',
        hubBio: user.hubBio || '',
        hubBirthday: user.hubBirthday || '',
        profileSnaps: Array.isArray(user.profileSnaps) ? user.profileSnaps : (user.profilePhoto ? [user.profilePhoto] : []),
        docs: user.docs || [],
        bankDetails: user.bankDetails,
        workHistory: user.workHistory,
        educations: user.educations || [],
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
        workHistory: true,
        educations: true,
      },
    });

    if (!user || user.isDeleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.status === 'EXITED') {
      return res.status(403).json({ error: ACCOUNT_EXITED.message, code: ACCOUNT_EXITED.code });
    }

    const userCapabilities = await loadCapabilities(user.id);
    const global2FAAllowed = await getRegistrationConfig('LOGIN_2FA_ENABLED', true);

    let effectiveAccess = null;
    try {
      effectiveAccess = await getEffectiveUserPermissions(user.tenantId, user.id);
    } catch (e) {
      // Fallback
    }

    let platformPermissions = null;
    if (isPlatformUser(user.role)) {
      try {
        platformPermissions = await getUserPlatformPermissions(user.id, user.role);
      } catch (e) {
        // Fallback
      }
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        capabilities: userCapabilities,
        effectivePermissions: effectiveAccess?.effectivePermissions || null,
        platformPermissions,
        dataScope: effectiveAccess?.dataScope || null,
        accessProfile: effectiveAccess?.user?.accessProfile || null,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        twoFactorEnabled: Boolean(user.twoFactorEnabled),
        twoFactorEnabledAt: user.twoFactorEnabledAt || null,
        twoFactorDisabledAt: user.twoFactorDisabledAt || null,
        global2FAAllowed: Boolean(global2FAAllowed),
        tenantId: user.tenantId,
        companyName: user.tenant.companyName,
        companyLogoUrl: user.tenant.logoUrl || null,
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
        presentAddressLine1: user.presentAddressLine1 || '',
        presentAddressLine2: user.presentAddressLine2 || '',
        presentCity: user.presentCity || '',
        presentState: user.presentState || '',
        presentPincode: user.presentPincode || '',
        permanentAddressLine1: user.permanentAddressLine1 || '',
        permanentAddressLine2: user.permanentAddressLine2 || '',
        permanentCity: user.permanentCity || '',
        permanentState: user.permanentState || '',
        permanentPincode: user.permanentPincode || '',
        sameAsPresentAddress: !!user.sameAsPresentAddress,
        linkedinUrl: user.linkedinUrl || '',
        primarySkills: Array.isArray(user.primarySkills) ? user.primarySkills : [],
        secondarySkills: Array.isArray(user.secondarySkills) ? user.secondarySkills : [],
        profilePhoto: user.profilePhoto || '',
        hubBio: user.hubBio || '',
        hubBirthday: user.hubBirthday || '',
        profileSnaps: Array.isArray(user.profileSnaps) ? user.profileSnaps : (user.profilePhoto ? [user.profilePhoto] : []),
        docs: user.docs || [],
        bankDetails: user.bankDetails,
        workHistory: user.workHistory,
        educations: user.educations || [],
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    if (!token && req.headers.cookie) {
      const cookies = parseCookies(req.headers.cookie);
      token = cookies['ueibi_session'];
    }
    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        await recordUserLogout({ userId: decoded.userId, sessionId: decoded.sessionId });
      }
    }
  } catch (err) {
    console.warn('[AUTH] Error during logout session recording:', err.message);
  }
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

    // Unknown email: generic message (anti-enumeration).
    if (!user) {
      return res.status(200).json({ message: genericMessage });
    }

    // Exited / deactivated employee: say so plainly instead of pretending a
    // link was sent. Product decision — this reveals that the address belongs
    // to an ex-employee, in exchange for not leaving them waiting on an email.
    if (user.isDeleted || user.status === 'EXITED') {
      return res.status(403).json({ error: ACCOUNT_EXITED.message, code: ACCOUNT_EXITED.code });
    }

    const { resetUrl, expiresMinutes } = await issuePasswordResetLink(user.id);

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
        return { ok: false, error: ACCOUNT_EXITED.message, code: ACCOUNT_EXITED.code, status: 403 };
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

      // Update user password, set passwordChangedAt, and clear mustChangePassword
      await tx.$executeRawUnsafe(
        `UPDATE "tenant_users"
         SET "passwordHash" = $1, "mustChangePassword" = false, "passwordChangedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $2`,
        newHash,
        tokenRecord.userId
      );

      // Terminate any active sessions for this user on password reset
      await tx.userSession.updateMany({
        where: { userId: tokenRecord.userId, status: 'ACTIVE' },
        data: {
          status: 'TERMINATED',
          endedAt: new Date(),
          logoutAt: new Date(),
          endReason: 'PASSWORD_RESET',
        },
      });

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
      return res.status(resetResult.status || 400).json({ error: resetResult.error, ...(resetResult.code ? { code: resetResult.code } : {}) });
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

/**
 * Step 5: Verify Login OTP and issue authenticated session
 * POST /api/auth/verify-login-otp
 */
export async function verifyLoginOtp(req, res, next) {
  try {
    const { challengeId, otp } = req.body || {};
    if (!challengeId || typeof challengeId !== 'string') {
      return res.status(400).json({ error: 'Challenge ID is required' });
    }
    if (!otp || typeof otp !== 'string') {
      return res.status(400).json({ error: 'OTP code is required' });
    }

    const result = await verifyLoginChallenge({ challengeId, otp, req });

    // Set HTTP-only session cookie
    res.cookie('ueibi_session', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    if (result.user && isPlatformUser(result.user.role)) {
      try {
        result.user.platformPermissions = await getUserPlatformPermissions(result.user.id, result.user.role);
      } catch (e) {}
    }

    return res.json({
      token: result.token,
      user: result.user,
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      error: err.message || 'Verification failed',
      code: err.code,
      remainingAttempts: err.remainingAttempts,
      isLocked: err.isLocked,
    });
  }
}

/**
 * Step 6: Resend Login OTP
 * POST /api/auth/resend-login-otp
 */
export async function resendLoginOtp(req, res, next) {
  try {
    const { challengeId } = req.body || {};
    if (!challengeId || typeof challengeId !== 'string') {
      return res.status(400).json({ error: 'Challenge ID is required' });
    }

    const result = await resendLoginChallenge({ challengeId, req });
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 400).json({
      error: err.message || 'Failed to resend verification code',
      cooldownSeconds: err.cooldownSeconds,
      remainingSeconds: err.remainingSeconds,
      maxResendAttempts: err.maxResendAttempts,
    });
  }
}

/**
 * GET /api/auth/2fa/status
 * Get the current user's 2FA status and global availability
 */
export async function get2FAStatus(req, res, next) {
  try {
    const status = await getUser2FAStatus(req.user.id);
    res.json(status);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/2fa/enable/request
 * Send OTP to user's registered email to begin 2FA activation
 */
export async function requestEnable2FAHandler(req, res, next) {
  try {
    const result = await requestEnable2FA({ userId: req.user.id, req });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
}

/**
 * POST /api/auth/2fa/enable/verify
 * Validate OTP and confirm 2FA enablement
 */
export async function verifyEnable2FAHandler(req, res, next) {
  try {
    const { challengeId, otp } = req.body || {};
    const result = await verifyAndEnable2FA({ userId: req.user.id, challengeId, otp, req });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({
      error: err.message,
      remainingAttempts: err.remainingAttempts,
    });
  }
}

/**
 * POST /api/auth/2fa/disable
 * Disable 2FA with password confirmation
 */
export async function disable2FAHandler(req, res, next) {
  try {
    const { password } = req.body || {};
    const result = await disable2FA({ userId: req.user.id, password, req });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
}

