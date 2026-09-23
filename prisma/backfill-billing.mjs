/**
 * backfill-billing.mjs — give the companies that predate billing a billing record.
 *
 * Every paying customer signed up before Package/Subscription/Invoice existed.
 * Their money lives on CompanyRegistration and nowhere else, so without this
 * the Revenue page reads zero and Subscriptions is empty for real customers.
 *
 * For each registration that was actually priced, this creates:
 *   - a Subscription  — the term they bought, dated from their activation
 *   - an Invoice      — every money field COPIED, never recomputed
 *   - a Payment       — what they paid, dated from finance approval
 *
 * On the payments it writes: the 8 online registrations carry `STUB-…`
 * references and no transactionId. They were written by a stub path that no
 * longer exists, and the Razorpay keys have never been configured, so no money
 * was ever collected through the gateway. Finance DID approve them, which in the
 * flow of the day meant "payment confirmed", so they are carried forward as paid
 * — but with `method: LEGACY` and the original reference preserved, so the
 * UNVERIFIED_PAYMENT alert can surface every one of them for reconciliation
 * against your bank. Nothing here asserts a payment was verified when it wasn't.
 *
 * Idempotent: an invoice already linked to a registration is skipped, so this is
 * safe to re-run. Nothing is ever updated or deleted.
 *
 *   node -r dotenv/config prisma/backfill-billing.mjs           # report only
 *   node -r dotenv/config prisma/backfill-billing.mjs --apply   # write
 */
import { prisma } from '../src/lib/prisma.js';
import { nextInvoiceNumber, addMonths, subscriptionStateOf, num } from '../src/services/billing.service.js';

const APPLY = process.argv.includes('--apply');

/**
 * These companies bought PERPETUAL one-time licences — terms did not exist when
 * they signed up. So by default they are backfilled as perpetual (no end date),
 * because that is what they actually agreed to.
 *
 * Giving them an invented 12-month expiry would raise renewal alerts and could
 * have you asking a customer to renew something they own outright. That is not a
 * mistake worth risking silently, so converting them to terms is opt-in:
 *
 *   --term-months=12
 */
const termArg = process.argv.find((a) => a.startsWith('--term-months='));
const TERM_MONTHS = termArg ? parseInt(termArg.split('=')[1], 10) : null;

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

async function main() {
  console.log(APPLY ? '\n── APPLYING ──\n' : '\n── DRY RUN (pass --apply to write) ──\n');

  const registrations = await prisma.companyRegistration.findMany({
    where: { totalAmount: { not: null } },
    select: {
      id: true, companyName: true, email: true, gstin: true,
      licenseQuantity: true, unitPrice: true, subtotalAmount: true,
      discountAmount: true, couponId: true, gstRate: true, gstAmount: true,
      totalAmount: true, paymentMethod: true, paymentReference: true,
      transactionId: true, chequeNumber: true,
      financeApprovedAt: true, activatedAt: true, createdAt: true, status: true,
      tenant: { select: { id: true, companyName: true } },
      coupon: { select: { code: true } },
    },
    // Chronological, so the invoice numbers ascend with their dates rather than
    // with whatever order the database happened to return.
    orderBy: { createdAt: 'asc' },
  });

  console.log(`${registrations.length} registration(s) were priced.\n`);

  let created = 0;
  let skipped = 0;
  let noTenant = 0;
  let legacy = 0;

  for (const reg of registrations) {
    const label = reg.companyName.slice(0, 30).padEnd(31);

    if (!reg.tenant) {
      // Nothing was activated, so there is no company to bill. These are
      // half-finished signups, not customers.
      console.log(`  SKIP  ${label} not activated — no tenant exists`);
      noTenant += 1;
      continue;
    }

    const existing = await prisma.invoice.findFirst({
      where: { registrationId: reg.id },
      select: { id: true, invoiceNumber: true },
    });
    if (existing) {
      console.log(`  SKIP  ${label} already has ${existing.invoiceNumber}`);
      skipped += 1;
      continue;
    }

    // Dates: fall back through what is actually recorded rather than inventing.
    const startsAt = reg.activatedAt || reg.financeApprovedAt || reg.createdAt;
    // Null means perpetual, which is what a one-time licence is.
    const endsAt = TERM_MONTHS ? addMonths(startsAt, TERM_MONTHS) : null;
    const receivedAt = reg.financeApprovedAt || reg.activatedAt || reg.createdAt;
    const quantity = reg.licenseQuantity || 1;

    // A STUB reference means the old stub payment path, which never touched a
    // gateway. Mark it so, rather than dressing it up as a verified transaction.
    const isUnverified = !reg.transactionId
      && String(reg.paymentReference || '').startsWith('STUB-');
    const method = isUnverified ? 'LEGACY' : (reg.paymentMethod || 'BANK_TRANSFER');
    const reference = reg.transactionId || reg.paymentReference || reg.chequeNumber || null;

    const state = subscriptionStateOf({ startsAt, endsAt, cancelledAt: null });

    console.log(
      `  ${APPLY ? 'WRITE' : 'WOULD'} ${label} ${inr(reg.totalAmount).padStart(12)}  `
      + `${String(quantity).padStart(3)} seats  `
      + `${new Date(startsAt).toISOString().slice(0, 10)} → ${endsAt ? endsAt.toISOString().slice(0, 10) : 'perpetual '}  `
      + `${state.padEnd(9)} ${method}${isUnverified ? '  ⚠ unverified' : ''}`,
    );
    if (isUnverified) legacy += 1;

    if (!APPLY) { created += 1; continue; }

    await prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.create({
        data: {
          tenantId: reg.tenant.id,
          packageId: null,               // predates packages entirely
          packageName: `${quantity} licences (pre-billing${TERM_MONTHS ? '' : ', perpetual'})`,
          seatCount: quantity,
          state,
          startsAt,
          endsAt,
          registrationId: reg.id,
        },
      });

      const invoiceNumber = await nextInvoiceNumber(tx, receivedAt);

      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          tenantId: reg.tenant.id,
          subscriptionId: subscription.id,
          registrationId: reg.id,
          state: 'PAID',
          billToName: reg.companyName,
          billToGstin: reg.gstin,
          billToEmail: reg.email,
          issuedAt: receivedAt,
          // Copied, never recomputed — whatever they were actually charged is
          // what the invoice must say, even if the pricing rules have moved on.
          currency: 'INR',
          quantity,
          unitPrice: reg.unitPrice ?? 0,
          subtotalAmount: reg.subtotalAmount ?? reg.totalAmount,
          couponId: reg.couponId,
          couponCode: reg.coupon?.code ?? null,
          discountAmount: reg.discountAmount ?? 0,
          gstRate: reg.gstRate ?? 0,
          gstAmount: reg.gstAmount ?? 0,
          totalAmount: reg.totalAmount,
          amountPaid: reg.totalAmount,
          amountRefunded: 0,
          notes: isUnverified
            ? 'Backfilled from the pre-billing signup flow. The payment reference predates gateway verification and has not been reconciled against a bank statement.'
            : 'Backfilled from the pre-billing signup flow.',
        },
      });

      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          tenantId: reg.tenant.id,
          amount: reg.totalAmount,
          method,
          reference,
          receivedAt,
          // Not a real operator: this was a migration, and saying so is more
          // honest than attributing it to whoever happens to run the script.
          recordedById: 'system-backfill',
          notes: isUnverified
            ? `Carried forward from registration ${reg.id}. Finance approved this, but the reference ${reference} came from the stub payment path and was never verified by a gateway.`
            : `Carried forward from registration ${reg.id}.`,
        },
      });

      if (reg.couponId) {
        await tx.couponRedemption.create({
          data: {
            couponId: reg.couponId,
            invoiceId: invoice.id,
            tenantId: reg.tenant.id,
            registrationId: reg.id,
            discountAmount: reg.discountAmount ?? 0,
            redeemedAt: receivedAt,
          },
        });
      }
    });
    created += 1;
  }

  const total = registrations.reduce((a, r) => a + num(r.totalAmount), 0);
  console.log(`\n  ${APPLY ? 'created' : 'would create'}: ${created}`);
  console.log(`  skipped (already done): ${skipped}`);
  console.log(`  skipped (never activated): ${noTenant}`);
  console.log(`  unverified legacy payments: ${legacy}`);
  console.log(`  total carried forward: ${inr(total)}`);
  console.log(
    TERM_MONTHS
      ? `  term applied: ${TERM_MONTHS} months — these will raise renewal alerts`
      : '  term: perpetual (what they actually bought). Pass --term-months=N to convert them.',
  );
  if (legacy > 0) {
    console.log(
      `\n  ⚠ ${legacy} payment(s) carry an unverifiable reference. They appear on`
      + '\n    Platform Overview as UNVERIFIED_PAYMENT alerts until reconciled.',
    );
  }
  if (!APPLY) console.log('\n  Nothing was written. Re-run with --apply.');
  console.log();
}

main()
  .catch((err) => { console.error('\nFAILED:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
