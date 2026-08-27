import { prisma } from '../lib/prisma.js';
import { findActionToken } from '../lib/actionTokens.js';
import { notifyStakeholders } from '../lib/notify.js';

async function resolveHrToken(req, res) {
  const actionToken = await findActionToken(req.params.token, 'HR');
  if (!actionToken) {
    res.status(404).json({ error: 'Invalid link' });
    return null;
  }
  if (actionToken.expiresAt.getTime() < Date.now()) {
    res.status(410).json({ error: 'This link has expired' });
    return null;
  }
  if (actionToken.registration.status !== 'PENDING_HR_ACTIVATION') {
    res.status(410).json({ error: 'This registration has already been activated' });
    return null;
  }
  return actionToken;
}

export async function getHrSummary(req, res, next) {
  try {
    const actionToken = await resolveHrToken(req, res);
    if (!actionToken) return;
    const { registration } = actionToken;

    res.json({
      status: registration.status,
      companyName: registration.companyName,
      companyType: registration.companyType,
      domainName: registration.domainName,
      fullName: registration.fullName,
      designation: registration.designation,
      email: registration.email,
      licenseQuantity: registration.licenseQuantity,
      totalAmount: registration.totalAmount,
      paymentMethod: registration.paymentMethod,
      paymentReference: registration.paymentReference,
    });
  } catch (err) {
    next(err);
  }
}

export async function activate(req, res, next) {
  try {
    const actionToken = await resolveHrToken(req, res);
    if (!actionToken) return;
    const { registration } = actionToken;

    const updated = await prisma.companyRegistration.update({
      where: { id: registration.id },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    });

    await notifyStakeholders({
      registration: updated,
      event: 'HR_ACTIVATED',
      subject: `Registration activated: ${registration.companyName}`,
      message: `HR has activated the account for ${registration.companyName}. Onboarding is complete.`,
    });

    res.json({ status: 'ACTIVE' });
  } catch (err) {
    next(err);
  }
}
