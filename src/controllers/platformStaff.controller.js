/**
 * Platform staff (Sales / Business Development) accounts.
 *
 * Only the platform owner manages these, and only PLATFORM_SALES can be
 * created here — PLATFORM_OWNER still comes into existence solely through
 * scripts/seed-platform-owner.js. Staff live in the internal platform tenant
 * and set their first password through a one-time link.
 * Deactivate / reactivate use the existing /platform/users/:id/* actions.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { renderInvitationEmail } from '../lib/emailTemplates.js';
import { issuePasswordResetLink } from '../services/passwordReset.service.js';
import { recordPlatformAction, PLATFORM_ACTIONS } from '../services/platformAudit.service.js';

const INVITE_EXPIRES_HOURS = 72;

const createStaffSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
});

const STAFF_SELECT = {
  id: true, name: true, email: true, role: true, status: true,
  isDeleted: true, lastLoginAt: true, createdAt: true,
};

/** GET /platform/staff — Sales/BD accounts. */
export async function listPlatformStaff(req, res, next) {
  try {
    const items = await prisma.tenantUser.findMany({
      where: { role: 'PLATFORM_SALES' },
      orderBy: { createdAt: 'desc' },
      select: STAFF_SELECT,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/staff — create a Sales/BD user and email them a set-password link. */
export async function createPlatformStaff(req, res, next) {
  try {
    const parsed = createStaffSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { name, email } = parsed.data;

    const platformTenant = await prisma.tenant.findFirst({ where: { isPlatform: true }, select: { id: true, companyName: true } });
    if (!platformTenant) {
      return res.status(500).json({ error: 'Platform tenant is missing. Run the platform owner seed script first.' });
    }

    const existing = await prisma.tenantUser.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists.', code: 'EMAIL_EXISTS' });
    }

    // Unusable random password; the person sets their own through the link.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    const staff = await prisma.$transaction(async (tx) => {
      const user = await tx.tenantUser.create({
        data: {
          tenantId: platformTenant.id,
          name,
          email,
          passwordHash,
          role: 'PLATFORM_SALES',
          status: 'ACTIVE',
          mustChangePassword: false,
        },
        select: STAFF_SELECT,
      });
      await recordPlatformAction({
        tx,
        req,
        action: PLATFORM_ACTIONS.STAFF_CREATED,
        targetType: 'USER',
        targetId: user.id,
        afterValue: { email, role: 'PLATFORM_SALES' },
      });
      return user;
    });

    const { resetUrl } = await issuePasswordResetLink(staff.id, { expiresMinutes: INVITE_EXPIRES_HOURS * 60 });
    const { html, text } = renderInvitationEmail({
      setupUrl: resetUrl,
      expiresHours: INVITE_EXPIRES_HOURS,
      name,
      companyName: `${platformTenant.companyName} (Sales)`,
      email,
    });
    let inviteSent = true;
    try {
      await sendMail({ to: email, subject: 'You have been added as a UEIBI Sales user', html, text, event: 'PLATFORM_STAFF_INVITE' });
    } catch (mailErr) {
      inviteSent = false;
      console.error('[PLATFORM_STAFF] Invite email failed:', mailErr.message);
    }

    res.status(201).json({
      message: inviteSent
        ? `${name} has been added as a Sales user. A set-password link has been emailed to ${email}.`
        : `${name} has been added, but the invite email could not be sent. Use "Force reset" to send a new link.`,
      staff,
      inviteSent,
    });
  } catch (err) {
    next(err);
  }
}
