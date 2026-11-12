import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

/** The caller's address, honouring the proxy header app.js already trusts. */
function ipOfRequest(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}
import { env } from '../config/env.js';
import { domainMatchesEmail, normalizeDomain } from '../lib/domain.js';
import { generateOtp, hashOtp, verifyOtpHash } from '../lib/otp.js';
import { generateRawToken, hashToken } from '../lib/tokens.js';
import { generateTenantCode } from '../lib/slug.js';
import { notifyStakeholders } from '../lib/notify.js';
import { sendMail } from '../lib/mailer.js';
import { renderOtpEmail } from '../lib/emailTemplates.js';
import { computePricing, couponValidationError } from '../lib/pricing.js';
import { getRegistrationConfig } from '../services/registrationConfig.service.js';
import { computeRegistrationPricing, calculateLicenceBreakdown } from '../services/licenceCalculation.service.js';
import {
  validateDomainSyntax,
  validateCompanyName,
  checkDomainMxRecords,
  validateOfficialEmailMatch,
} from '../lib/mouValidation.js';
import {
  otpRequestSchema,
  otpVerifySchema,
  registrationSchema,
  validateDomainSchema,
  validateOfficialEmailSchema,
  publicPricingPreviewSchema,
} from '../validations/registration.schema.js';

async function lookupCoupon(couponCode) {
  if (!couponCode) return { coupon: null, error: null };
  const coupon = await prisma.coupon.findUnique({ where: { code: couponCode } });
  const error = couponValidationError(coupon);
  return { coupon: error ? null : coupon, error };
}

/**
 * Public pricing and coupon preview for CMD during MOU registration (Step 3).
 */
export async function getPublicPricingPreview(req, res, next) {
  try {
    const parsed = publicPricingPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const {
      cmdEmail,
      hrEmail,
      hrNotRequired,
      financeEmail,
      financeNotRequired,
      additionalLicenses,
      licenseQuantity,
      couponCode,
    } = parsed.data;

    const { coupon, error: couponError } = await lookupCoupon(couponCode);

    const [minQty, maxQty] = await Promise.all([
      getRegistrationConfig('MIN_LICENSE_QUANTITY', 1),
      getRegistrationConfig('MAX_LICENSE_QUANTITY', 10000),
    ]);

    const pricing = await computeRegistrationPricing(
      {
        cmdEmail,
        hrEmail,
        hrNotRequired,
        financeEmail,
        financeNotRequired,
        additionalLicenses,
        licenseQuantity,
      },
      { coupon }
    );

    res.json({
      ...pricing,
      couponValid: Boolean(coupon),
      couponCode: coupon?.code || null,
      couponError,
      minQuantity: minQty,
      maxQuantity: maxQty,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Real-time AJAX validation for company domain.
 * Validates syntax, normalization, MX records, and checks existing registrations.
 */
export async function validateCompanyDomain(req, res, next) {
  try {
    const parsed = validateDomainSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        valid: false,
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { domainName, companyName } = parsed.data;

    // Validate domain syntax and reject public webmail providers
    const domainCheck = validateDomainSyntax(domainName);
    if (!domainCheck.valid) {
      return res.status(400).json({
        valid: false,
        field: 'domainName',
        error: domainCheck.message,
      });
    }

    const normalizedDomain = domainCheck.normalizedDomain;

    // If companyName is provided, also validate company name rules
    if (companyName) {
      const companyCheck = validateCompanyName(companyName);
      if (!companyCheck.valid) {
        return res.status(400).json({
          valid: false,
          field: 'companyName',
          error: companyCheck.message,
        });
      }
    }

    // Check if domain is already registered in CompanyRegistration or active Tenant
    const [existingReg, existingTenant] = await Promise.all([
      prisma.companyRegistration.findFirst({
        where: { domainName: { equals: normalizedDomain, mode: 'insensitive' } },
      }),
      prisma.tenant.findFirst({
        where: { domainName: { equals: normalizedDomain, mode: 'insensitive' } },
      }),
    ]);

    if (existingReg || existingTenant) {
      return res.status(409).json({
        valid: false,
        field: 'domainName',
        error: `The domain "${normalizedDomain}" is already registered in Karyam. Please sign in or contact support.`,
      });
    }

    // Check DNS MX / host records
    const dnsResult = await checkDomainMxRecords(normalizedDomain);
    if (!dnsResult.valid) {
      return res.status(400).json({
        valid: false,
        field: 'domainName',
        error: dnsResult.message,
      });
    }

    return res.json({
      valid: true,
      domainName: normalizedDomain,
      mxVerified: dnsResult.hasMx,
      message: 'Company domain is valid, active, and available for registration.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Real-time AJAX validation for official CMD contact email.
 * Strictly verifies domain match with the Step 1 company domain and checks existing accounts.
 */
export async function validateOfficialEmail(req, res, next) {
  try {
    const parsed = validateOfficialEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        valid: false,
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { email, domainName } = parsed.data;

    const emailCheck = validateOfficialEmailMatch(email, domainName);
    if (!emailCheck.valid) {
      return res.status(400).json({
        valid: false,
        field: 'email',
        error: emailCheck.message,
      });
    }

    const normalizedEmail = emailCheck.email;

    // Check existing registration or existing active tenant user
    const [existingReg, existingUser] = await Promise.all([
      prisma.companyRegistration.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      }),
      prisma.tenantUser.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      }),
    ]);

    if (existingReg || existingUser) {
      return res.status(409).json({
        valid: false,
        field: 'email',
        error: 'An account with this email address already exists in Karyam. Please sign in or use another company email.',
      });
    }

    return res.json({
      valid: true,
      email: normalizedEmail,
      message: 'Valid company email address.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Public registration & OTP security settings for signup flow.
 */
export async function getPublicRegistrationSettings(req, res, next) {
  try {
    const [
      otpTtlMinutes,
      otpLength,
      otpMaxAttempts,
      otpCooldownSecs,
      otpMaxResendAttempts,
      unitPrice,
      currency,
      gstRate,
      taxEnabled,
    ] = await Promise.all([
      getRegistrationConfig('OTP_TTL_MINUTES', 10),
      getRegistrationConfig('OTP_LENGTH', 6),
      getRegistrationConfig('OTP_MAX_ATTEMPTS', 5),
      getRegistrationConfig('OTP_RESEND_COOLDOWN_SECONDS', 60),
      getRegistrationConfig('OTP_MAX_RESEND_ATTEMPTS', 3),
      getRegistrationConfig('LICENSE_UNIT_PRICE', 3999),
      getRegistrationConfig('CURRENCY', 'INR'),
      getRegistrationConfig('GST_RATE', 0.18),
      getRegistrationConfig('TAX_ENABLED', true),
    ]);

    res.json({
      otpTtlMinutes: Number(otpTtlMinutes) || 10,
      otpLength: Number(otpLength) || 6,
      otpMaxAttempts: Number(otpMaxAttempts) || 5,
      otpResendCooldownSeconds: Number(otpCooldownSecs) || 60,
      otpMaxResendAttempts: Number(otpMaxResendAttempts) || 3,
      licenseUnitPrice: Number(unitPrice) || 3999,
      currency: currency || 'INR',
      gstRate: Number(gstRate) || 0.18,
      taxEnabled: Boolean(taxEnabled),
    });
  } catch (err) {
    next(err);
  }
}

export async function requestOtp(req, res, next) {
  try {
    const parsed = otpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { email, domainName } = parsed.data;

    const emailMatch = validateOfficialEmailMatch(email, domainName);
    if (!emailMatch.valid) {
      return res.status(400).json({
        error: emailMatch.message,
      });
    }

    const [existingReg, existingUser] = await Promise.all([
      prisma.companyRegistration.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      }),
      prisma.tenantUser.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      }),
    ]);

    if (existingReg || existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Dynamic OTP security parameters from Platform Owner configuration
    const [otpTtlMinutes, otpLength, otpMaxAttempts, otpCooldownSecs, otpMaxResendAttempts] = await Promise.all([
      getRegistrationConfig('OTP_TTL_MINUTES', 10),
      getRegistrationConfig('OTP_LENGTH', 6),
      getRegistrationConfig('OTP_MAX_ATTEMPTS', 5),
      getRegistrationConfig('OTP_RESEND_COOLDOWN_SECONDS', 60),
      getRegistrationConfig('OTP_MAX_RESEND_ATTEMPTS', 3),
    ]);

    // Check existing pending challenge
    const latestChallenge = await prisma.emailVerification.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        consumedAt: null,
        verifiedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    let resendCount = 0;
    if (latestChallenge) {
      const isStillActive = latestChallenge.otpExpiresAt.getTime() > Date.now();
      if (isStillActive) {
        // Enforce resend cooldown
        const referenceTime = latestChallenge.lastResentAt || latestChallenge.createdAt;
        const elapsedSecs = Math.floor((Date.now() - referenceTime.getTime()) / 1000);
        if (elapsedSecs < otpCooldownSecs) {
          const remaining = otpCooldownSecs - elapsedSecs;
          return res.status(429).json({
            error: `Please wait ${remaining} second${remaining === 1 ? '' : 's'} before requesting another OTP.`,
            remainingSeconds: remaining,
            cooldownSeconds: otpCooldownSecs,
          });
        }

        // Enforce max resend attempts
        if ((latestChallenge.resendAttempts || 0) >= otpMaxResendAttempts) {
          return res.status(429).json({
            error: `Maximum OTP resend limit (${otpMaxResendAttempts}) reached for this verification session. Please wait for the OTP to expire.`,
            maxResendReached: true,
            maxResendAttempts: otpMaxResendAttempts,
          });
        }
        resendCount = (latestChallenge.resendAttempts || 0) + 1;
      }

      // Invalidate the previous active challenge so old code cannot be used
      await prisma.emailVerification.update({
        where: { id: latestChallenge.id },
        data: { consumedAt: new Date() },
      });
    }

    // Generate dynamic OTP of configured length
    const otp = generateOtp(otpLength);
    const otpExpiresAt = new Date(Date.now() + otpTtlMinutes * 60 * 1000);

    await prisma.emailVerification.create({
      data: {
        email,
        domainName: normalizeDomain(domainName),
        otpHash: hashOtp(otp),
        otpExpiresAt,
        resendAttempts: resendCount,
        lastResentAt: new Date(),
      },
    });

    // Prominently print OTP to console so developers and admins can view it in terminal / PM2 logs
    console.log('\n======================================================');
    console.log(`🔑 [AUTH/OTP] Generated Registration OTP`);
    console.log(`📧 Recipient  : ${email}`);
    console.log(`🔐 OTP Code   : >>> ${otp} <<< (${otpLength} digits)`);
    console.log(`⏱️  Expires    : In ${otpTtlMinutes} minutes (${otpExpiresAt.toISOString()})`);
    console.log(`🔄 Resend #   : ${resendCount} of ${otpMaxResendAttempts}`);
    console.log('======================================================\n');

    const mailResult = await sendMail({
      to: email,
      subject: 'Your UEIBI verification code',
      text: `Your verification code is ${otp}. It expires in ${otpTtlMinutes} minutes.`,
      html: renderOtpEmail({ code: otp, expiresMinutes: otpTtlMinutes }),
      event: 'OTP_REQUESTED',
    });

    if (mailResult?.status === 'FAILED') {
      console.warn(`[AUTH/OTP] ⚠️ Email delivery failed for ${email}. OTP is printed above in console: ${otp}`);
    }

    res.json({
      message: `OTP sent. Code expires in ${otpTtlMinutes} minutes.`,
      expiresInSeconds: otpTtlMinutes * 60,
      otpTtlMinutes,
      otpLength,
      cooldownSeconds: otpCooldownSecs,
      resendAttempts: resendCount,
      maxResendAttempts: otpMaxResendAttempts,
      ...(process.env.NODE_ENV !== 'production' || process.env.EXPOSE_OTP === 'true' || mailResult?.status === 'FAILED' ? { otp } : {}),
    });
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(req, res, next) {
  try {
    const parsed = otpVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { email, otp } = parsed.data;

    const challenge = await prisma.emailVerification.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        consumedAt: null,
        verifiedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      return res.status(400).json({ error: 'No pending OTP verification found for this email. Please request an OTP first.' });
    }

    if (challenge.otpExpiresAt.getTime() < Date.now()) {
      await prisma.emailVerification.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      return res.status(400).json({ error: 'OTP has expired. Please request a new verification code.', expired: true });
    }

    const otpMaxAttempts = await getRegistrationConfig('OTP_MAX_ATTEMPTS', 5);

    if (challenge.attempts >= otpMaxAttempts) {
      await prisma.emailVerification.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      return res.status(429).json({
        error: `Too many incorrect attempts (${otpMaxAttempts}). This verification code has been locked. Please request a new OTP.`,
        locked: true,
      });
    }

    if (!verifyOtpHash(otp, challenge.otpHash)) {
      const newAttempts = challenge.attempts + 1;
      const isLocked = newAttempts >= otpMaxAttempts;
      await prisma.emailVerification.update({
        where: { id: challenge.id },
        data: {
          attempts: { increment: 1 },
          ...(isLocked ? { consumedAt: new Date() } : {}),
        },
      });

      if (isLocked) {
        return res.status(429).json({
          error: `Incorrect OTP. Maximum attempts (${otpMaxAttempts}) reached. This code is now locked. Please request a new OTP.`,
          locked: true,
          attemptsLeft: 0,
        });
      }

      const remaining = otpMaxAttempts - newAttempts;
      return res.status(400).json({
        error: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        attemptsLeft: remaining,
      });
    }

    // Successful verification
    const verificationToken = generateRawToken();
    await prisma.emailVerification.update({
      where: { id: challenge.id },
      data: {
        verifiedAt: new Date(),
        verificationToken,
        verificationTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour validity
      },
    });

    res.json({
      valid: true,
      message: 'Email verified successfully.',
      verificationToken,
      expiresInSeconds: 60 * 60,
    });
  } catch (err) {
    next(err);
  }
}

export async function createRegistration(req, res, next) {
  try {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const data = parsed.data;

    const challenge = await prisma.emailVerification.findFirst({
      where: {
        email: data.email,
        verificationToken: data.verificationToken,
        consumedAt: null,
      },
    });

    if (!challenge) {
      return res.status(400).json({ error: 'Invalid or already-used verification token' });
    }
    if (!challenge.verifiedAt) {
      return res.status(400).json({ error: 'Email is not verified' });
    }
    if (challenge.verificationTokenExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification token has expired, please request a new OTP' });
    }

    const [existingEmail, existingDomain] = await Promise.all([
      prisma.companyRegistration.findUnique({ where: { email: data.email } }),
      prisma.companyRegistration.findUnique({ where: { domainName: normalizeDomain(data.domainName) } }),
    ]);
    if (existingEmail) {
      return res.status(409).json({ error: 'A registration with this email already exists' });
    }
    if (existingDomain) {
      return res.status(409).json({ error: 'A registration with this domain already exists' });
    }

    // Validate organization structure: must exist and be actively enabled
    let orgStructure = null;
    if (data.organizationStructureId) {
      orgStructure = await prisma.organizationStructure.findFirst({
        where: { id: data.organizationStructureId, isActive: true },
      });
    }
    if (!orgStructure && data.companyType) {
      orgStructure = await prisma.organizationStructure.findFirst({
        where: {
          OR: [
            { id: data.companyType },
            { code: { equals: data.companyType, mode: 'insensitive' } },
            { name: { equals: data.companyType, mode: 'insensitive' } },
          ],
          isActive: true,
        },
      });
    }

    if (!orgStructure) {
      return res.status(400).json({
        error: 'Invalid or inactive organization structure selected. Please refresh and select an active structure.',
      });
    }

    // Purchase Configuration (CMD Controlled)
    const actionTokenTtlDays = await getRegistrationConfig('ACTION_TOKEN_TTL_DAYS', env.actionTokenTtlDays || 14);

    const { coupon, error: couponError } = await lookupCoupon(data.couponCode);
    if (data.couponCode && couponError) {
      return res.status(400).json({ error: couponError });
    }

    const pricing = await computeRegistrationPricing(
      {
        cmdEmail: data.email,
        hrEmail: data.hrEmail,
        hrNotRequired: data.hrNotRequired,
        financeEmail: data.financeEmail,
        financeNotRequired: data.financeNotRequired,
        additionalLicenses: data.additionalLicenses,
        licenseQuantity: data.licenseQuantity,
      },
      { coupon }
    );

    const passwordHash = await bcrypt.hash(data.password, 10);
    const tenantCode = generateTenantCode(data.companyName);
    const rawFinanceToken = generateRawToken();

    const registration = await prisma.$transaction(async (tx) => {
      const created = await tx.companyRegistration.create({
        data: {
          companyName: data.companyName,
          companyType: orgStructure.name,
          organizationStructureId: orgStructure.id,
          domainName: normalizeDomain(data.domainName),
          tenantCode,
          fullName: data.fullName,
          designation: data.designation,
          email: data.email,
          passwordHash,
          financeEmail: data.financeNotRequired ? null : (data.financeEmail ? data.financeEmail.trim() : null),
          financeName: data.financeNotRequired ? null : (data.financeName ? data.financeName.trim() : null),
          financeNotRequired: Boolean(data.financeNotRequired),
          hrEmail: data.hrNotRequired ? null : (data.hrEmail ? data.hrEmail.trim() : null),
          hrName: data.hrNotRequired ? null : (data.hrName ? data.hrName.trim() : null),
          hrNotRequired: Boolean(data.hrNotRequired),
          additionalLicenses: pricing.additionalLicenses,
          licenseQuantity: pricing.totalLicenses,
          gstin: data.gstin || null,
          unitPrice: pricing.unitPrice,
          couponId: coupon?.id || null,
          discountAmount: pricing.discountAmount,
          subtotalAmount: pricing.subtotalAmount,
          gstRate: pricing.gstRate,
          gstAmount: pricing.gstAmount,
          totalAmount: pricing.totalAmount,
          acceptedTermsAt: new Date(),
        },
      });

      // Record WHICH version of each document was on screen when they agreed.
      // acceptedTermsAt alone only says they ticked a box at some point; if the
      // terms are later amended it cannot show what they actually accepted.
      const liveVersions = await tx.legalDocumentVersion.findMany({
        where: { publishedAt: { not: null } },
        orderBy: { version: 'desc' },
        select: { id: true, documentSlug: true, version: true },
      });
      // findMany came back newest-first, so the first sighting of each document
      // is its live version.
      const seen = new Set();
      for (const v of liveVersions) {
        if (seen.has(v.documentSlug)) continue;
        seen.add(v.documentSlug);
        await tx.legalAcceptance.create({
          data: {
            versionId: v.id,
            registrationId: created.id,
            ipAddress: ipOfRequest(req),
            userAgent: String(req.headers?.['user-agent'] || '').slice(0, 1000) || null,
          },
        });
      }

      await tx.registrationActionToken.create({
        data: {
          registrationId: created.id,
          role: 'FINANCE',
          tokenHash: hashToken(rawFinanceToken),
          expiresAt: new Date(Date.now() + actionTokenTtlDays * 24 * 60 * 60 * 1000),
        },
      });

      await tx.emailVerification.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });

      return created;
    });

    if (!data.financeNotRequired) {
      await notifyStakeholders({
        registration,
        event: 'LEVEL1_SUBMITTED',
        subject: `Company registration submitted: ${registration.companyName}`,
        message: `${registration.fullName} (${registration.designation}) has submitted a company registration for ${registration.companyName}. It is now pending Finance review.`,
        actionRole: 'FINANCE',
        actionUrl: `${env.frontendOrigin}/finance/registrations/${rawFinanceToken}`,
      });
    }

    res.status(201).json({
      id: registration.id,
      status: registration.status,
      directPayment: Boolean(data.financeNotRequired),
      paymentToken: rawFinanceToken,
      paymentUrl: `/finance/registrations/${rawFinanceToken}`,
    });
  } catch (err) {
    next(err);
  }
}
