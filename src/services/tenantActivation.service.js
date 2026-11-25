import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { addMonths, num, nextInvoiceNumber } from './billing.service.js';
import {
  findEligiblePromotion,
  calculateSubscriptionExtension,
  recordPromotionRedemption,
} from './promotion.service.js';
import { issuePasswordResetLink } from './passwordReset.service.js';
import { notifyStakeholders } from '../lib/notify.js';
import { sendMail } from '../lib/mailer.js';
import { renderHrActivatedEmail } from '../lib/emailTemplates.js';

/**
 * Commits single coupon redemption with optimistic concurrency and audit tracking.
 */
async function commitCouponUsage(tx, coupon, registrationId = null, tenantId = null, invoiceId = null, discountAmount = 0) {
  if (!coupon) return;
  const isCompanyOffer = Boolean(coupon.companyName);
  const where = {
    id: coupon.id,
    active: true,
  };
  if (isCompanyOffer && coupon.usageLimit != null) {
    where.timesUsed = { lt: coupon.usageLimit };
  }
  const data = {
    timesUsed: { increment: 1 },
    usedAt: new Date(),
    usedCompanyId: tenantId || registrationId || null,
    paymentReference: invoiceId || null,
    activationReference: registrationId || tenantId || null,
  };
  if (isCompanyOffer) {
    data.status = 'USED';
  }
  const updated = await tx.coupon.updateMany({
    where,
    data,
  });

  if (updated.count === 0) {
    throw new Error(`Coupon "${coupon.code}" usage limit has already been reached.`);
  }

  try {
    await tx.couponRedemption.create({
      data: {
        couponId: coupon.id,
        invoiceId: invoiceId || null,
        tenantId: tenantId || null,
        registrationId: registrationId || null,
        discountAmount: discountAmount || 0,
      },
    });
  } catch (err) {
    console.warn('[COUPON] Failed to record coupon redemption audit entry:', err.message);
  }
}

/**
 * Idempotent, transaction-safe automatic tenant activation upon verified payment.
 *
 * Requirements:
 * 1. Activates Tenant with exact licenseLimit chosen by CMD.
 * 2. Creates Annual Subscription.
 * 3. Creates CMD User (SUPER_ADMIN) using their chosen password.
 * 4. Creates HR and Finance users with individual, secure, time-limited password setup links.
 * 5. Records audit logs and marks registration as ACTIVE.
 * 6. Dispatches confirmation emails to all stakeholders.
 */
export async function activateTenantFromRegistration({
  registrationId,
  paymentMethod = 'ONLINE',
  paymentReference = null,
  transactionId = null,
  performedBy = 'FINANCE',
}) {
  const registration = await prisma.companyRegistration.findUnique({
    where: { id: registrationId },
    include: { coupon: true },
  });

  if (!registration) {
    throw new Error(`Registration ${registrationId} not found`);
  }

  // Idempotency: If tenant already exists, return existing without duplication
  const existingTenant = await prisma.tenant.findFirst({
    where: {
      OR: [
        { registrationId: registration.id },
        { domainName: registration.domainName },
      ],
    },
  });

  if (existingTenant) {
    return {
      tenant: existingTenant,
      alreadyActive: true,
      status: 'ACTIVE',
    };
  }

  const startsAt = new Date();
  let promo = null;
  if (registration.promotionId) {
    promo = await prisma.subscriptionPromotion.findUnique({
      where: { id: registration.promotionId },
    });
  }
  if (!promo) {
    promo = await findEligiblePromotion({
      packageId: null,
      termMonths: registration.paidDurationMonths || 12,
      seatCount: registration.licenseQuantity || 1,
      context: 'NEW_REGISTRATIONS',
      coupon: registration.coupon,
      code: registration.promoCode,
    });
  }

  const paidMonths = registration.paidDurationMonths || (promo ? promo.paidMonths : 12);
  const freeMonths = registration.freeDurationMonths != null ? registration.freeDurationMonths : (promo ? promo.freeMonths : 0);
  const totalMonths = registration.totalDurationMonths || (paidMonths + freeMonths);
  const paidEndsAt = addMonths(startsAt, paidMonths);
  const endsAt = addMonths(startsAt, totalMonths);
  const licenseLimit = registration.licenseQuantity && registration.licenseQuantity > 0
    ? registration.licenseQuantity
    : 10;

  // Execute atomic activation transaction
  const { tenant, updatedRegistration, hrUser, financeUser } = await prisma.$transaction(
    async (tx) => {
      // 1. Update Registration Status
      const updatedReg = await tx.companyRegistration.update({
        where: { id: registration.id },
        data: {
          status: 'ACTIVE',
          activatedAt: new Date(),
          paymentMethod: paymentMethod,
          paymentReference: paymentReference || registration.paymentReference,
          transactionId: transactionId || registration.transactionId,
          financeApprovedAt: registration.financeApprovedAt || new Date(),
        },
      });

      // 2. Create Tenant Root Entity
      const createdTenant = await tx.tenant.create({
        data: {
          companyName: registration.companyName,
          domainName: registration.domainName,
          tenantCode: registration.tenantCode,
          licenseLimit,
          planEndsAt: endsAt,
          registrationId: registration.id,
          status: 'ACTIVE',
          logoUrl: registration.logoUrl || null,
        },
      });

      // 2b. Initialize TenantSettings with registration company logo
      await tx.tenantSettings.create({
        data: {
          tenantId: createdTenant.id,
          logoUrl: registration.logoUrl || null,
          ...(registration.logoUrl ? { theme: { logoUrl: registration.logoUrl } } : {}),
        },
      });

      // 3. Create Subscription with Promotional Extension
      const createdSub = await tx.subscription.create({
        data: {
          tenantId: createdTenant.id,
          packageName: `${licenseLimit} Licenses (${totalMonths} Months${freeMonths ? ` incl. ${freeMonths} Mo Free` : ' Annual'})`,
          seatCount: licenseLimit,
          state: 'ACTIVE',
          startsAt,
          endsAt,
          registrationId: registration.id,
          promotionId: promo?.id || registration.promotionId || null,
          paidDurationMonths: paidMonths,
          freeDurationMonths: freeMonths,
          totalDurationMonths: totalMonths,
          paidEndsAt,
        },
      });

      if (promo) {
        await recordPromotionRedemption(tx, {
          promotionId: promo.id,
          subscriptionId: createdSub.id,
          tenantId: createdTenant.id,
          salesRepId: null,
          paidMonths,
          freeMonths,
          totalMonths,
          paidRevenue: num(registration.totalAmount) || 0,
        });
      }

      // 3b. Create Tax Invoice (PAID) and Payment Record
      const invoiceNumber = await nextInvoiceNumber(tx, startsAt);
      const createdInvoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          tenantId: createdTenant.id,
          subscriptionId: createdSub.id,
          registrationId: registration.id,
          state: 'PAID',
          billToName: registration.companyName,
          billToGstin: registration.gstin || null,
          billToEmail: registration.email,
          issuedAt: startsAt,
          currency: 'INR',
          quantity: licenseLimit,
          unitPrice: registration.unitPrice || env.licenseUnitPrice,
          subtotalAmount: registration.subtotalAmount || (licenseLimit * (registration.unitPrice || env.licenseUnitPrice)),
          couponId: registration.couponId || null,
          couponCode: registration.coupon?.code || null,
          discountAmount: registration.discountAmount || 0,
          gstRate: registration.gstRate || env.gstRate,
          gstAmount: registration.gstAmount || 0,
          totalAmount: registration.totalAmount || 0,
          amountPaid: registration.totalAmount || 0,
          amountRefunded: 0,
          paidDurationMonths: paidMonths,
          freeDurationMonths: freeMonths,
          totalDurationMonths: totalMonths,
          periodStartsAt: startsAt,
          periodEndsAt: endsAt,
          notes: `Paid subscription activation for ${licenseLimit} licenses (${paidMonths} Months paid + ${freeMonths} Months promotional free). Reference: ${transactionId || paymentReference || 'ONLINE'}`,
        },
      });

      await tx.payment.create({
        data: {
          invoiceId: createdInvoice.id,
          tenantId: createdTenant.id,
          amount: registration.totalAmount || 0,
          method: ['ONLINE', 'CHEQUE', 'BANK_TRANSFER', 'UPI', 'CASH', 'ADJUSTMENT', 'LEGACY'].includes(paymentMethod)
            ? paymentMethod
            : 'ONLINE',
          reference: transactionId || paymentReference || (paymentMethod === 'CASH' ? null : 'ONLINE'),
          receivedAt: startsAt,
          recordedById: performedBy,
          notes: `Automatic payment recording upon ${paymentMethod} confirmation for registration ${registration.id}`,
        },
      });

      // 4. Create CMD User (SUPER_ADMIN)
      await tx.tenantUser.create({
        data: {
          tenantId: createdTenant.id,
          email: registration.email,
          passwordHash: registration.passwordHash,
          name: registration.fullName,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          mustChangePassword: false,
          designation: registration.designation || 'CMD',
        },
      });

      // 5. Create HR User (if required and distinct email)
      let createdHr = null;
      if (
        !registration.hrNotRequired &&
        registration.hrEmail &&
        registration.hrEmail.toLowerCase() !== registration.email.toLowerCase()
      ) {
        const dummyHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
        createdHr = await tx.tenantUser.create({
          data: {
            tenantId: createdTenant.id,
            email: registration.hrEmail,
            passwordHash: dummyHash,
            name: registration.hrName || 'HR Head',
            role: 'HR',
            status: 'ACTIVE',
            mustChangePassword: true,
            designation: 'HR Head',
          },
        });
      }

      // 6. Create Finance User (if required and distinct email)
      let createdFinance = null;
      const hrEmailClean = (!registration.hrNotRequired && registration.hrEmail)
        ? registration.hrEmail.trim().toLowerCase()
        : null;
      const finEmailClean = (!registration.financeNotRequired && registration.financeEmail)
        ? registration.financeEmail.trim().toLowerCase()
        : null;

      if (
        finEmailClean &&
        finEmailClean !== registration.email.toLowerCase() &&
        (!hrEmailClean || finEmailClean !== hrEmailClean)
      ) {
        const dummyHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
        createdFinance = await tx.tenantUser.create({
          data: {
            tenantId: createdTenant.id,
            email: registration.financeEmail,
            passwordHash: dummyHash,
            name: registration.financeName || 'Finance Head',
            role: 'FINANCE',
            status: 'ACTIVE',
            mustChangePassword: true,
            designation: 'Finance Head',
          },
        });
      } else if (
        finEmailClean &&
        hrEmailClean &&
        finEmailClean === hrEmailClean &&
        createdHr
      ) {
        // One employee manages both HR and Finance! Consume 1 licence and designate both responsibilities.
        await tx.tenantUser.update({
          where: { id: createdHr.id },
          data: {
            designation: 'HR & Finance Head',
          },
        });
      }

      // 7. Consume Coupon if applied
      if (registration.coupon) {
        await commitCouponUsage(
          tx,
          registration.coupon,
          registration.id,
          createdTenant.id,
          createdInvoice.id,
          Number(registration.discountAmount || 0)
        );
      }

      // 8. Record Platform Audit Log
      await tx.platformAuditLog.create({
        data: {
          actorId: performedBy,
          action: 'AUTOMATIC_TENANT_ACTIVATION',
          targetType: 'TENANT',
          targetId: createdTenant.id,
          tenantId: createdTenant.id,
          reason: `Automatic activation after verified ${paymentMethod} payment for ${licenseLimit} licenses.`,
          afterValue: {
            companyName: registration.companyName,
            domainName: registration.domainName,
            licenseLimit,
            paymentMethod,
            transactionId: transactionId || registration.transactionId,
            totalAmount: Number(registration.totalAmount || 0),
          },
        },
      });

      return {
        tenant: createdTenant,
        updatedRegistration: updatedReg,
        hrUser: createdHr,
        financeUser: createdFinance,
      };
    },
    { timeout: 30000 }
  );

  // Issue independent password setup links for HR and Finance
  let hrSetupUrl = null;
  let financeSetupUrl = null;

  try {
    if (hrUser) {
      const res = await issuePasswordResetLink(hrUser.id, { expiresMinutes: 1440 }); // 24 hours
      hrSetupUrl = res.resetUrl;
    }
  } catch (err) {
    console.error('[ACTIVATION] Failed to issue HR password reset link:', err);
  }

  try {
    if (financeUser) {
      const res = await issuePasswordResetLink(financeUser.id, { expiresMinutes: 1440 });
      financeSetupUrl = res.resetUrl;
    }
  } catch (err) {
    console.error('[ACTIVATION] Failed to issue Finance password reset link:', err);
  }

  // Send stakeholder notifications
  try {
    const paymentAmountStr = registration.totalAmount
      ? `₹${Number(registration.totalAmount).toLocaleString('en-IN')}`
      : 'Paid';
    const gstinDisplay = registration.gstin || 'Not Provided';
    const couponDisplay = registration.coupon ? `${registration.coupon.code} (₹${Number(registration.discountAmount || 0).toLocaleString('en-IN')} discount)` : 'None';

    // 1. General stakeholder notification
    await notifyStakeholders({
      registration: updatedRegistration,
      event: 'HR_ACTIVATED',
      subject: `Account Activated: ${registration.companyName} is now live on Karyam!`,
      message: `Tenant ${registration.companyName} has been automatically activated following verified payment of ${paymentAmountStr} for ${licenseLimit} licenses.`,
    });

    // 2. Customized invitations with password-setup links for HR & Finance
    if (hrUser && hrSetupUrl) {
      await sendMail({
        to: hrUser.email,
        subject: `Welcome to Karyam — Set up your HR account for ${registration.companyName}`,
        text: `Your HR account for ${registration.companyName} is ready. Set your password here: ${hrSetupUrl}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
            <h2>Welcome to Karyam, ${hrUser.name}!</h2>
            <p>Your organization account for <strong>${registration.companyName}</strong> has been activated.</p>
            <p>Purchased Licenses: <strong>${licenseLimit}</strong></p>
            <p style="margin: 24px 0;">
              <a href="${hrSetupUrl}" style="background: #4f46e5; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700;">
                Set Your Password &rarr;
              </a>
            </p>
            <p style="font-size: 13px; color: #64748b;">This secure setup link is valid for 24 hours.</p>
          </div>
        `,
        event: 'HR_INVITATION',
      });
    }

    if (financeUser && financeSetupUrl) {
      await sendMail({
        to: financeUser.email,
        subject: `Payment Confirmed & Account Activated — ${registration.companyName}`,
        text: `Payment of ${paymentAmountStr} confirmed. Set your Finance account password here: ${financeSetupUrl}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
            <h2>Payment Confirmed — ${registration.companyName}</h2>
            <p>Payment of <strong>${paymentAmountStr}</strong> has been verified. Transaction ID: <code>${transactionId || registration.transactionId || 'N/A'}</code>.</p>
            <p>GSTIN: <strong>${gstinDisplay}</strong> | Applied Coupon: <strong>${couponDisplay}</strong></p>
            <p style="margin: 24px 0;">
              <a href="${financeSetupUrl}" style="background: #4f46e5; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700;">
                Set Your Password &rarr;
              </a>
            </p>
            <p style="font-size: 13px; color: #64748b;">This secure setup link is valid for 24 hours.</p>
          </div>
        `,
        event: 'FINANCE_INVITATION',
      });
    }
  } catch (err) {
    console.error('[ACTIVATION] Error sending activation emails:', err);
  }

  return {
    tenant,
    status: 'ACTIVE',
    licenseLimit,
  };
}

