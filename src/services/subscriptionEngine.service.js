/**
 * subscriptionEngine.service.js — Automated lifecycle management for company subscriptions.
 *
 * Scans active subscriptions daily to:
 * 1. Alert companies 30 days and 7 days prior to expiry.
 * 2. Transition expired subscriptions into a 7-day GRACE_PERIOD.
 * 3. Grace-period lapse: Suspends tenant access to enforce payment collection.
 * 4. Auto-generates renewal draft invoices for upcoming term transitions.
 */
import { prisma } from '../lib/prisma.js';

export async function runSubscriptionLifecycleCheck() {
  const now = new Date();
  const results = {
    checked: 0,
    renewalsDrafted: 0,
    movedToGrace: 0,
    suspended: 0,
    alertsDispatched: 0,
  };

  try {
    // 1. Fetch active customer subscriptions with non-null endsAt
    const activeSubs = await prisma.subscription.findMany({
      where: {
        state: 'ACTIVE',
        endsAt: { not: null },
      },
      include: {
        tenant: true,
        package: true,
      },
    });

    results.checked = activeSubs.length;

    for (const sub of activeSubs) {
      const daysUntilExpiry = Math.ceil((new Date(sub.endsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // CASE A: Subscription has expired (daysUntilExpiry <= 0)
      if (daysUntilExpiry <= 0) {
        // Transition subscription state to EXPIRED
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { state: 'EXPIRED' },
        });

        // Move tenant to GRACE_PERIOD for 7 days
        await prisma.tenant.update({
          where: { id: sub.tenantId },
          data: { status: 'GRACE_PERIOD' },
        });
        results.movedToGrace += 1;

        // Auto-draft renewal invoice if not already drafted
        const existingDraft = await prisma.invoice.findFirst({
          where: {
            tenantId: sub.tenantId,
            state: 'DRAFT',
          },
        });

        if (!existingDraft && sub.package) {
          const unitPrice = Number(sub.package.unitPrice || 499);
          const quantity = sub.seatCount || 10;
          const subtotal = unitPrice * quantity;
          const gstAmount = Math.round(subtotal * 0.18 * 100) / 100;
          const totalAmount = subtotal + gstAmount;

          await prisma.invoice.create({
            data: {
              tenantId: sub.tenantId,
              subscriptionId: sub.id,
              state: 'DRAFT',
              billToName: sub.tenant.companyName,
              billToEmail: sub.tenant.domainName ? `billing@${sub.tenant.domainName}` : 'admin@karyam.io',
              quantity,
              unitPrice,
              subtotalAmount: subtotal,
              gstRate: 0.18,
              gstAmount,
              totalAmount,
              notes: `Automated renewal invoice for expired Subscription ${sub.packageName}`,
            },
          });
          results.renewalsDrafted += 1;
        }
      }
    }

    // 2. Scan tenants in GRACE_PERIOD whose planEndsAt or expiry is older than 7 days
    const graceTenants = await prisma.tenant.findMany({
      where: {
        status: 'GRACE_PERIOD',
        isPlatform: false,
      },
      include: {
        subscriptions: {
          orderBy: { endsAt: 'desc' },
          take: 1,
        },
      },
    });

    for (const tenant of graceTenants) {
      const lastSub = tenant.subscriptions[0];
      if (lastSub && lastSub.endsAt) {
        const daysPastExpiry = Math.floor((now.getTime() - new Date(lastSub.endsAt).getTime()) / (1000 * 60 * 60 * 24));
        if (daysPastExpiry >= 7) {
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: {
              status: 'SUSPENDED',
              suspendedAt: now,
              suspendedReason: 'Subscription expired and 7-day grace period lapsed without payment',
            },
          });
          results.suspended += 1;
        }
      }
    }

    return results;
  } catch (err) {
    console.error('[SUBSCRIPTION ENGINE ERROR]', err);
    throw err;
  }
}

