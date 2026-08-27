import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { COMPANY_TYPES, DESIGNATIONS } from '../lib/constants.js';
import { domainMatchesEmail, normalizeDomain } from '../lib/domain.js';
import { generateOtp, hashOtp, verifyOtpHash } from '../lib/otp.js';
import { generateRawToken, hashToken } from '../lib/tokens.js';
import { generateTenantCode } from '../lib/slug.js';
import { notifyStakeholders } from '../lib/notify.js';
import { sendMail } from '../lib/mailer.js';
import { renderOtpEmail } from '../lib/emailTemplates.js';

const otpRequestSchema = z.object({
  email: z.string().email(),
  domainName: z.string().min(1),
});

const otpVerifySchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

const registrationSchema = z
  .object({
    companyName: z.string().min(1),
    companyType: z.enum(COMPANY_TYPES),
    domainName: z.string().min(1),
    fullName: z.string().min(1),
    designation: z.enum(DESIGNATIONS),
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
    financeEmail: z.string().email(),
    hrEmail: z.string().email(),
    acceptedTerms: z.literal(true),
    verificationToken: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => domainMatchesEmail(data.domainName, data.email), {
    message: 'Domain name must match your email domain',
    path: ['domainName'],
  });

export async function requestOtp(req, res, next) {
  try {
    const { email, domainName } = otpRequestSchema.parse(req.body);

    if (!domainMatchesEmail(domainName, email)) {
      return res.status(400).json({
        error: `Domain name must match your email domain (e.g. ${email.split('@')[0]}@${normalizeDomain(domainName)})`,
      });
    }

    const existing = await prisma.companyRegistration.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'A registration with this email already exists' });
    }

    const otp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + env.otpTtlMinutes * 60 * 1000);

    await prisma.emailVerification.create({
      data: {
        email,
        domainName,
        otpHash: hashOtp(otp),
        otpExpiresAt,
      },
    });

    await sendMail({
      to: email,
      subject: 'Your UEIBI verification code',
      text: `Your verification code is ${otp}. It expires in ${env.otpTtlMinutes} minutes.`,
      html: renderOtpEmail({ code: otp, expiresMinutes: env.otpTtlMinutes }),
      event: 'OTP_REQUESTED',
    });

    res.json({ message: 'OTP sent', expiresInSeconds: env.otpTtlMinutes * 60 });
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(req, res, next) {
  try {
    const { email, otp } = otpVerifySchema.parse(req.body);

    const challenge = await prisma.emailVerification.findFirst({
      where: { email, consumedAt: null, verifiedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      return res.status(400).json({ error: 'No pending OTP for this email' });
    }
    if (challenge.otpExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'OTP has expired' });
    }
    if (challenge.attempts >= env.otpMaxAttempts) {
      return res.status(429).json({ error: 'Too many incorrect attempts' });
    }
    if (!verifyOtpHash(otp, challenge.otpHash)) {
      await prisma.emailVerification.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ error: 'Incorrect OTP' });
    }

    const verificationToken = generateRawToken();
    await prisma.emailVerification.update({
      where: { id: challenge.id },
      data: {
        verifiedAt: new Date(),
        verificationToken,
        verificationTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    res.json({ verificationToken, expiresInSeconds: 30 * 60 });
  } catch (err) {
    next(err);
  }
}

export async function createRegistration(req, res, next) {
  try {
    const data = registrationSchema.parse(req.body);

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

    const passwordHash = await bcrypt.hash(data.password, 10);
    const tenantCode = generateTenantCode(data.companyName);
    const rawFinanceToken = generateRawToken();

    const registration = await prisma.$transaction(async (tx) => {
      const created = await tx.companyRegistration.create({
        data: {
          companyName: data.companyName,
          companyType: data.companyType,
          domainName: normalizeDomain(data.domainName),
          tenantCode,
          fullName: data.fullName,
          designation: data.designation,
          email: data.email,
          passwordHash,
          financeEmail: data.financeEmail,
          hrEmail: data.hrEmail,
          acceptedTermsAt: new Date(),
        },
      });

      await tx.registrationActionToken.create({
        data: {
          registrationId: created.id,
          role: 'FINANCE',
          tokenHash: hashToken(rawFinanceToken),
          expiresAt: new Date(Date.now() + env.actionTokenTtlDays * 24 * 60 * 60 * 1000),
        },
      });

      await tx.emailVerification.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });

      return created;
    });

    await notifyStakeholders({
      registration,
      event: 'LEVEL1_SUBMITTED',
      subject: `Company registration submitted: ${registration.companyName}`,
      message: `${registration.fullName} (${registration.designation}) has submitted a company registration for ${registration.companyName}. It is now pending Finance review.`,
      actionRole: 'FINANCE',
      actionUrl: `${env.frontendOrigin}/finance/registrations/${rawFinanceToken}`,
    });

    res.status(201).json({ id: registration.id, status: registration.status });
  } catch (err) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', details: err.issues });
    }
    next(err);
  }
}
