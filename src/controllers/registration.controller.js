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
import { otpRequestSchema, otpVerifySchema, registrationSchema } from '../validations/registration.schema.js';

export async function requestOtp(req, res, next) {
  try {
    const parsed = otpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { email, domainName } = parsed.data;

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
    const parsed = otpVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { email, otp } = parsed.data;

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
    next(err);
  }
}
