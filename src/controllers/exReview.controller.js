import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { AppraisalNotificationService } from '../services/appraisalNotification.service.js';
import { requestExReviewSchema, submitExReviewSchema } from '../validations/exReview.schema.js';

export async function requestExReview(req, res, next) {
  try {
    const parsed = requestExReviewSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { exCompany, exManagerName, exManagerEmail } = parsed.data;

    // Rate-limit: max 3 pending verification requests per employee
    const pendingCount = await prisma.exEmployerReview.count({
      where: {
        employeeId: req.user.id,
        status: 'PENDING',
      },
    });

    if (pendingCount >= 3) {
      return res.status(429).json({ error: 'Maximum 3 pending verification requests allowed at a time. Please wait for previous requests to complete.' });
    }

    const token = crypto.randomBytes(32).toString('hex');

    const review = await prisma.exEmployerReview.create({
      data: {
        employeeId: req.user.id,
        exCompany,
        exManagerName,
        exManagerEmail,
        token,
        status: 'PENDING',
      },
    });

    const verifyUrl = `http://localhost:5173/verify-conduct/${token}`;
    const subject = `UEIBI Verification Check - Feedback Request for ${req.user.name}`;
    const text = `Hello ${exManagerName},\n\n${req.user.name} has requested an employment verification and conduct review from you regarding their tenure at ${exCompany}.\n\nPlease fill in this short review form here: ${verifyUrl}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #1e293b;">
        <h2 style="color: #4f46e5;">Employment Verification Request</h2>
        <p>Hello <strong>${exManagerName}</strong>,</p>
        <p><strong>${req.user.name}</strong> has submitted an employment verification request on the UEIBI Employee Registry regarding their previous role at <strong>${exCompany}</strong>.</p>
        <p>We kindly request you to complete this quick feedback and verification form regarding their conduct, skills, and tenure details:</p>
        <a href="${verifyUrl}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0; font-weight: 600;">Verify & Provide Feedback</a>
        <p style="color: #64748b; font-size: 13px;">This secure link is unique to this request and expires once completed.</p>
      </div>
    `;

    await sendMail({
      to: exManagerEmail,
      subject,
      text,
      html,
      event: 'EX_EMPLOYER_VERIFICATION_REQUESTED',
    });

    res.status(201).json(review);
  } catch (err) {
    next(err);
  }
}

export async function getExReviewByToken(req, res, next) {
  try {
    const { token } = req.params;

    const review = await prisma.exEmployerReview.findUnique({
      where: { token },
      include: {
        employee: {
          select: { name: true },
        },
      },
    });

    if (!review) {
      return res.status(404).json({ error: 'Verification request not found or invalid token' });
    }

    if (review.status === 'COMPLETED') {
      return res.status(410).json({ error: 'This verification request has already been completed' });
    }

    res.json({
      id: review.id,
      exCompany: review.exCompany,
      exManagerName: review.exManagerName,
      status: review.status,
      employeeName: review.employee.name,
      createdAt: review.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

export async function submitExReview(req, res, next) {
  try {
    const { token } = req.params;
    const parsed = submitExReviewSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { rating, feedback } = parsed.data;

    const review = await prisma.exEmployerReview.findUnique({
      where: { token },
      include: {
        employee: {
          select: { id: true, tenantId: true, name: true },
        },
      },
    });

    if (!review) {
      return res.status(404).json({ error: 'Verification request not found or invalid token' });
    }

    if (review.status === 'COMPLETED') {
      return res.status(400).json({ error: 'This verification request has already been completed' });
    }

    const updated = await prisma.exEmployerReview.update({
      where: { token },
      data: {
        rating: parseFloat(rating),
        feedback,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // Notify employee and HR
    await AppraisalNotificationService.notifyExEmployerVerificationCompleted({
      tenantId: review.employee.tenantId,
      employeeId: review.employee.id,
      exCompany: review.exCompany,
      reviewId: review.id,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
