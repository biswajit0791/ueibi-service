import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { sendMail } from '../lib/mailer.js';

export async function requestExReview(req, res, next) {
  try {
    const { exCompany, exManagerName, exManagerEmail } = req.body || {};
    if (!exCompany || !exManagerName || !exManagerEmail) {
      return res.status(400).json({ error: 'Ex-company details, ex-manager name, and ex-manager email are required' });
    }

    const token = crypto.randomBytes(16).toString('hex');

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

    const subject = `UEIBI Verification Check - Feedback Request for ${req.user.name}`;
    const text = `Hello ${exManagerName},\n\n${req.user.name} has requested an employment verification and conduct review from you regarding their tenure at ${exCompany}.\n\nPlease fill in this short review form here: http://localhost:5173/public/reviews/${token}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; line-height: 1.6;">
        <h2 style="color: #4f46e5;">Employment Verification Request</h2>
        <p>Hello <strong>${exManagerName}</strong>,</p>
        <p><strong>${req.user.name}</strong> has submitted an employment verification request on the UEIBI Employee Registry regarding their previous role at <strong>${exCompany}</strong>.</p>
        <p>We kindly request you to complete this quick feedback and verification form regarding their conduct, skills, and tenure details:</p>
        <a href="http://localhost:5173/public/reviews/${token}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 15px 0;">Verify & Provide Feedback</a>
        <p style="color: #6b7280; font-size: 13px;">This secure link is unique to this request and expires once completed.</p>
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
          select: { name: true, email: true, designation: true },
        },
      },
    });

    if (!review) {
      return res.status(404).json({ error: 'Verification request not found or expired' });
    }

    res.json(review);
  } catch (err) {
    next(err);
  }
}

export async function submitExReview(req, res, next) {
  try {
    const { token } = req.params;
    const { rating, feedback } = req.body || {};

    if (rating === undefined || !feedback) {
      return res.status(400).json({ error: 'Rating and feedback are required' });
    }

    const review = await prisma.exEmployerReview.findUnique({
      where: { token },
    });

    if (!review) {
      return res.status(404).json({ error: 'Verification request not found' });
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

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
