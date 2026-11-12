import { prisma } from '../lib/prisma.js';
import { generateOtp, hashOtp, verifyOtpHash } from '../lib/otp.js';
import { sendMail } from '../lib/mailer.js';
import { renderLogin2FAEmail } from '../lib/emailTemplates.js';
import { getRegistrationConfig } from './registrationConfig.service.js';
import { loadCapabilities } from '../lib/capabilities.js';
import { signToken } from '../lib/jwt.js';
import { ACCOUNT_EXITED } from '../lib/accountAccess.js';
import { tenantAccessDenial } from '../lib/tenantAccess.js';

export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const [local, domain] = parts;
  if (!local) return email;
  const visible = Math.min(2, Math.max(1, Math.floor(local.length / 3)));
  return `${local.slice(0, visible)}****@${domain}`;
}

export function formatAuthUser(user, capabilities = []) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    capabilities,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    tenantId: user.tenantId,
    companyName: user.tenant?.companyName || '',
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
    profileSnaps: Array.isArray(user.profileSnaps)
      ? user.profileSnaps
      : (user.profilePhoto ? [user.profilePhoto] : []),
    docs: user.docs || [],
    bankDetails: user.bankDetails,
    workHistory: user.workHistory,
    educations: user.educations || [],
  };
}

/**
 * Checks whether 2FA is enforced for a given user account based on Platform Owner settings.
 */
export async function is2FAEnforcedForUser(user) {
  const isEnabled = await getRegistrationConfig('LOGIN_2FA_ENABLED', true);
  if (!isEnabled) return false;

  const rolesConfig = await getRegistrationConfig('LOGIN_2FA_ROLES', 'ALL');
  if (rolesConfig && typeof rolesConfig === 'string' && rolesConfig.trim() !== 'ALL') {
    const roles = rolesConfig.split(',').map((r) => r.trim().toUpperCase());
    const userRole = (user.role || '').toUpperCase();
    if (!roles.includes(userRole)) {
      return false;
    }
  }

  return true;
}

/**
 * Initiates a login 2FA challenge and dispatches OTP email.
 */
export async function initiateLoginChallenge({ user, req }) {
  const [
    otpTtlMinutes,
    otpLength,
    otpMaxAttempts,
    otpCooldownSecs,
    otpMaxResendAttempts,
    maxActiveChallenges,
  ] = await Promise.all([
    getRegistrationConfig('OTP_TTL_MINUTES', 10),
    getRegistrationConfig('OTP_LENGTH', 6),
    getRegistrationConfig('OTP_MAX_ATTEMPTS', 5),
    getRegistrationConfig('OTP_RESEND_COOLDOWN_SECONDS', 60),
    getRegistrationConfig('OTP_MAX_RESEND_ATTEMPTS', 3),
    getRegistrationConfig('LOGIN_MAX_ACTIVE_CHALLENGES', 5),
  ]);

  const ipAddress = req?.ip || req?.headers?.['x-forwarded-for'] || null;
  const userAgent = req?.headers?.['user-agent'] || null;

  // Cleanup old unconsumed challenges if user exceeded maximum concurrent active challenges
  const activeChallenges = await prisma.loginChallenge.count({
    where: {
      userId: user.id,
      consumedAt: null,
      otpExpiresAt: { gt: new Date() },
    },
  });

  if (activeChallenges >= maxActiveChallenges) {
    // Invalidate oldest unconsumed challenges
    await prisma.loginChallenge.updateMany({
      where: {
        userId: user.id,
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });
  }

  const otp = generateOtp(otpLength);
  const otpExpiresAt = new Date(Date.now() + otpTtlMinutes * 60 * 1000);

  const challenge = await prisma.loginChallenge.create({
    data: {
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email.toLowerCase(),
      otpHash: hashOtp(otp),
      otpExpiresAt,
      attempts: 0,
      maxAttempts: otpMaxAttempts,
      resendAttempts: 0,
      maxResendAttempts: otpMaxResendAttempts,
      isLocked: false,
      purpose: 'LOGIN_2FA',
      ipAddress: typeof ipAddress === 'string' ? ipAddress.slice(0, 100) : null,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 255) : null,
    },
  });

  console.log(`\n============================================================`);
  console.log(`🔐 [LOGIN 2FA] Challenge Created`);
  console.log(`👤 User        : ${user.name} (${user.email})`);
  console.log(`🔑 Challenge ID: ${challenge.id}`);
  console.log(`🔢 OTP Code    : >>> ${otp} <<< (${otpLength} digits)`);
  console.log(`⏱️  Expires     : In ${otpTtlMinutes} minutes (${otpExpiresAt.toISOString()})`);
  console.log(`============================================================\n`);

  try {
    await sendMail({
      to: user.email,
      subject: 'Your Karyam Login Verification Code',
      text: `Your Karyam login verification code is ${otp}. It expires in ${otpTtlMinutes} minutes. Do not share this code with anyone.`,
      html: renderLogin2FAEmail({
        code: otp,
        expiresMinutes: otpTtlMinutes,
        userName: user.name,
        ipAddress,
        userAgent,
      }),
      event: 'LOGIN_2FA_OTP',
    });
  } catch (mailErr) {
    console.error(`[AUTH/2FA] Email delivery failed for ${user.email}:`, mailErr.message);
  }

  return {
    requires2FA: true,
    challengeId: challenge.id,
    maskedEmail: maskEmail(user.email),
    email: maskEmail(user.email),
    otpLength,
    cooldownSeconds: otpCooldownSecs,
    expiresInSeconds: otpTtlMinutes * 60,
    maxResendAttempts: otpMaxResendAttempts,
    ...(process.env.NODE_ENV !== 'production' || process.env.EXPOSE_OTP === 'true'
      ? { devOtp: otp }
      : {}),
  };
}

/**
 * Verifies a login 2FA OTP and generates session tokens upon success.
 */
export async function verifyLoginChallenge({ challengeId, otp }) {
  if (!challengeId || typeof challengeId !== 'string') {
    throw new Error('Verification challenge ID is required.');
  }

  if (!otp || typeof otp !== 'string') {
    throw new Error('Verification OTP code is required.');
  }

  const cleanOtp = otp.trim();
  const challenge = await prisma.loginChallenge.findUnique({
    where: { id: challengeId },
    include: {
      user: {
        include: {
          tenant: true,
          bankDetails: true,
          workHistory: true,
          educations: true,
        },
      },
    },
  });

  if (!challenge || challenge.purpose !== 'LOGIN_2FA') {
    const err = new Error('Invalid or expired verification session.');
    err.status = 400;
    throw err;
  }

  if (challenge.consumedAt) {
    const err = new Error('This verification code has already been used. Please log in again.');
    err.status = 400;
    throw err;
  }

  if (challenge.isLocked || challenge.attempts >= challenge.maxAttempts) {
    const err = new Error('Maximum verification attempts reached. Please restart the login process.');
    err.status = 400;
    throw err;
  }

  if (challenge.otpExpiresAt.getTime() < Date.now()) {
    const err = new Error('Your verification code has expired. Please request a new code.');
    err.status = 400;
    throw err;
  }

  const isValid = verifyOtpHash(cleanOtp, challenge.otpHash);

  if (!isValid) {
    const newAttempts = challenge.attempts + 1;
    const isLocked = newAttempts >= challenge.maxAttempts;

    await prisma.loginChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts: newAttempts,
        isLocked,
      },
    });

    if (isLocked) {
      const err = new Error('Maximum verification attempts reached. Please restart the login process.');
      err.status = 400;
      err.isLocked = true;
      throw err;
    }

    const remaining = challenge.maxAttempts - newAttempts;
    const err = new Error(
      `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
    );
    err.status = 400;
    err.remainingAttempts = remaining;
    throw err;
  }

  // Atomically mark challenge as consumed and verified
  await prisma.$transaction([
    prisma.loginChallenge.update({
      where: { id: challenge.id },
      data: {
        verifiedAt: new Date(),
        consumedAt: new Date(),
      },
    }),
    prisma.loginChallenge.updateMany({
      where: {
        userId: challenge.userId,
        id: { not: challenge.id },
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    }),
  ]);

  const user = challenge.user;
  if (!user || user.isDeleted || user.status === 'EXITED') {
    const err = new Error(ACCOUNT_EXITED.message);
    err.status = 403;
    err.code = ACCOUNT_EXITED.code;
    throw err;
  }

  if (user.tenant) {
    const tenantDenial = tenantAccessDenial(user.tenant.status);
    if (tenantDenial) {
      const err = new Error(tenantDenial.message);
      err.status = 403;
      err.code = tenantDenial.code;
      throw err;
    }
  }

  // Stamp login
  prisma.tenantUser
    .update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })
    .catch((e) => console.warn('[AUTH] Error stamping lastLoginAt:', e.message));

  // Auto-activate user if invited
  if (user.status === 'INVITED') {
    await prisma.tenantUser
      .update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      })
      .catch(() => {});
    user.status = 'ACTIVE';
  }

  const userCapabilities = await loadCapabilities(user.id);
  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    tenantId: user.tenantId,
  });

  return {
    token,
    user: formatAuthUser(user, userCapabilities),
  };
}

/**
 * Resends a new OTP for an active login 2FA challenge.
 */
export async function resendLoginChallenge({ challengeId, req }) {
  if (!challengeId || typeof challengeId !== 'string') {
    const err = new Error('Challenge ID is required for resending OTP.');
    err.status = 400;
    throw err;
  }

  const challenge = await prisma.loginChallenge.findUnique({
    where: { id: challengeId },
    include: { user: true },
  });

  if (!challenge || challenge.purpose !== 'LOGIN_2FA') {
    const err = new Error('Invalid verification session.');
    err.status = 400;
    throw err;
  }

  if (challenge.consumedAt) {
    const err = new Error('This verification session has already completed. Please log in again.');
    err.status = 400;
    throw err;
  }

  if (challenge.isLocked) {
    const err = new Error('This verification challenge is locked. Please log in again.');
    err.status = 400;
    throw err;
  }

  const [otpTtlMinutes, otpLength, otpCooldownSecs] = await Promise.all([
    getRegistrationConfig('OTP_TTL_MINUTES', 10),
    getRegistrationConfig('OTP_LENGTH', 6),
    getRegistrationConfig('OTP_RESEND_COOLDOWN_SECONDS', 60),
  ]);

  const maxResends = challenge.maxResendAttempts || 3;
  if (challenge.resendAttempts >= maxResends) {
    const err = new Error(
      `Maximum resend limit (${maxResends}) reached for this login session. Please restart login.`
    );
    err.status = 400;
    err.maxResendAttempts = maxResends;
    throw err;
  }

  // Cooldown check against lastResentAt or createdAt
  const lastSent = challenge.lastResentAt || challenge.createdAt;
  const elapsedSecs = Math.floor((Date.now() - new Date(lastSent).getTime()) / 1000);
  if (elapsedSecs < otpCooldownSecs) {
    const remaining = otpCooldownSecs - elapsedSecs;
    const err = new Error(`Please wait ${remaining} seconds before requesting another code.`);
    err.status = 429;
    err.cooldownSeconds = otpCooldownSecs;
    err.remainingSeconds = remaining;
    throw err;
  }

  const newOtp = generateOtp(otpLength);
  const newExpiresAt = new Date(Date.now() + otpTtlMinutes * 60 * 1000);
  const ipAddress = req?.ip || req?.headers?.['x-forwarded-for'] || null;
  const userAgent = req?.headers?.['user-agent'] || null;

  const updated = await prisma.loginChallenge.update({
    where: { id: challenge.id },
    data: {
      otpHash: hashOtp(newOtp),
      otpExpiresAt: newExpiresAt,
      resendAttempts: challenge.resendAttempts + 1,
      lastResentAt: new Date(),
      ipAddress: typeof ipAddress === 'string' ? ipAddress.slice(0, 100) : challenge.ipAddress,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 255) : challenge.userAgent,
    },
  });

  console.log(`\n============================================================`);
  console.log(`🔄 [LOGIN 2FA] OTP Resent`);
  console.log(`👤 User        : ${challenge.user?.name} (${challenge.email})`);
  console.log(`🔑 Challenge ID: ${challenge.id}`);
  console.log(`🔢 New OTP Code: >>> ${newOtp} <<< (${otpLength} digits)`);
  console.log(`⏱️  New Expiry  : In ${otpTtlMinutes} minutes (${newExpiresAt.toISOString()})`);
  console.log(`🔄 Resend Count: ${updated.resendAttempts} of ${maxResends}`);
  console.log(`============================================================\n`);

  try {
    await sendMail({
      to: challenge.email,
      subject: 'Your Karyam Login Verification Code',
      text: `Your Karyam login verification code is ${newOtp}. It expires in ${otpTtlMinutes} minutes. Do not share this code with anyone.`,
      html: renderLogin2FAEmail({
        code: newOtp,
        expiresMinutes: otpTtlMinutes,
        userName: challenge.user?.name,
        ipAddress,
        userAgent,
      }),
      event: 'LOGIN_2FA_RESEND',
    });
  } catch (mailErr) {
    console.error(`[AUTH/2FA] Email delivery failed for ${challenge.email}:`, mailErr.message);
  }

  return {
    message: `Verification code resent. Valid for ${otpTtlMinutes} minutes.`,
    cooldownSeconds: otpCooldownSecs,
    resendAttempts: updated.resendAttempts,
    maxResendAttempts: maxResends,
    expiresInSeconds: otpTtlMinutes * 60,
    ...(process.env.NODE_ENV !== 'production' || process.env.EXPOSE_OTP === 'true'
      ? { devOtp: newOtp }
      : {}),
  };
}
