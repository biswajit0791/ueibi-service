/**
 * billing.service.js
 *
 * The rules that must hold wherever money is touched, kept in one place so a
 * controller cannot quietly disagree with another one.
 *
 * Two principles run through all of it:
 *
 *   1. An invoice's money is a SNAPSHOT. It is computed once, on creation, and
 *      never recomputed on read. Repricing a package tomorrow must not move an
 *      invoice issued today.
 *   2. `amountPaid` and `amountRefunded` are derived from the Payment and Refund
 *      rows and are only ever written in the same transaction that writes those
 *      rows, so the summary cannot drift from the detail.
 */
import { prisma } from '../lib/prisma.js';
import { computePricing } from '../lib/pricing.js';
import { getInvoiceSettings } from './invoiceSettings.service.js';

/** Decimal columns come back as Prisma Decimal; money maths needs plain numbers. */
export const num = (v) => (v == null ? 0 : Number(v));

/** Money rounded the same way lib/pricing.js rounds it. */
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The Indian financial year a date falls in, as "2026-27".
 *
 * April to March, so anything before April belongs to the year that started the
 * previous April. Invoice series are per financial year, which is why this is
 * not simply getFullYear().
 */
export function financialYearOf(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  // getMonth() is zero-based, so March is 2 and April is 3.
  const startYear = d.getMonth() < 3 ? year - 1 : year;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Allocates the next invoice number in the current financial year.
 *
 * `UEIBI/2026-27/0001`, sequential and global rather than per tenant, because a
 * GST invoice series must be unbroken per issuer.
 *
 * This is a read-then-write and so can lose a race; the @unique index on
 * invoiceNumber is what actually guarantees uniqueness, and the caller retries
 * on P2002 via `withInvoiceNumber` below. A number is never reused, including
 * after a void — a voided invoice keeps its number and is marked VOID, which is
 * exactly what an auditor expects to find.
 */
export async function nextInvoiceNumber(client = prisma, at = new Date()) {
  const settings = await getInvoiceSettings(client);
  const prefix = invoiceNumberPrefix(settings, at);

  const issued = await client.invoice.findMany({
    where: { invoiceNumber: { startsWith: prefix } },
    select: { invoiceNumber: true },
  });

  const highest = issued.reduce((max, row) => {
    const n = parseInt(row.invoiceNumber.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  // `nextNumber` is a FLOOR, never an override. Taking the larger of the two
  // means an operator who types a number lower than what is already issued
  // cannot cause a number to be reissued — the worst they can do is skip
  // forward, which leaves an explainable gap rather than a duplicate.
  const next = Math.max(highest + 1, Number(settings.nextNumber) || 1);

  return `${prefix}${String(next).padStart(4, '0')}`;
}

/**
 * The part of an invoice number before the sequence.
 *
 * Exported so the settings screen can show exactly what the next number will
 * look like without duplicating the rule.
 */
export function invoiceNumberPrefix(settings, at = new Date()) {
  const p = String(settings?.numberPrefix || 'UEIBI').trim();
  return settings?.includeFinancialYear === false
    ? `${p}-`
    : `${p}/${financialYearOf(at)}/`;
}

/**
 * Runs `create(invoiceNumber)` and retries when the number was taken between
 * the read above and the insert. Four attempts is far beyond what concurrent
 * operator activity can produce, and failing loudly beats issuing a duplicate.
 */
export async function withInvoiceNumber(create, { client = prisma, at = new Date() } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const number = await nextInvoiceNumber(client, at);
    try {
      return await create(number);
    } catch (err) {
      const duplicate = err?.code === 'P2002'
        && (err?.meta?.target || []).some((t) => String(t).includes('invoiceNumber'));
      if (!duplicate) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Turns a quantity and unit price into the full set of invoice money fields.
 *
 * Deliberately delegates to computePricing() in lib/pricing.js — the same
 * function the signup flow has always used — so a quote, an invoice and a
 * renewal cannot arrive at three different totals for the same inputs.
 */
export function priceInvoice({ quantity, unitPrice, coupon, gstRate }) {
  const p = computePricing({ quantity, unitPrice, coupon, gstRate });
  return {
    quantity,
    unitPrice: p.unitPrice,
    subtotalAmount: p.subtotal,
    discountAmount: p.discountAmount,
    couponId: coupon?.id ?? null,
    couponCode: coupon?.code ?? null,
    gstRate: p.gstRate,
    gstAmount: p.gstAmount,
    totalAmount: p.total,
  };
}

/**
 * What an invoice still expects to receive, and what could still be refunded.
 * Both are clamped at zero so a rounding artefact can never present as a
 * negative amount owing.
 */
export function invoiceBalances(invoice) {
  const total = num(invoice.totalAmount);
  const paid = num(invoice.amountPaid);
  const refunded = num(invoice.amountRefunded);
  return {
    total,
    paid,
    refunded,
    outstanding: round2(Math.max(0, total - paid)),
    refundable: round2(Math.max(0, paid - refunded)),
    net: round2(paid - refunded),
  };
}

/**
 * The state an invoice should be in given what has been received.
 *
 * VOID and DRAFT are terminal for this purpose: a void never becomes paid, and
 * a draft has not been issued so it cannot be. Everything else follows the
 * money, which is why payment state is never set by hand.
 */
export function stateForPayment(invoice, paidAfter) {
  if (invoice.state === 'VOID' || invoice.state === 'DRAFT') return invoice.state;
  const total = num(invoice.totalAmount);
  if (paidAfter <= 0) return 'ISSUED';
  // A fraction of a rupee under the total is a rounding artefact, not a debt.
  if (paidAfter + 0.005 >= total) return 'PAID';
  return 'PARTIALLY_PAID';
}

/**
 * Recomputes an invoice's paid/refunded totals FROM its rows and writes them.
 *
 * Called inside the same transaction as any payment or refund write. Summing
 * the rows rather than incrementing a counter means the invoice can always be
 * reconciled against its own detail, and a half-applied write cannot leave the
 * two disagreeing.
 */
export async function syncInvoiceTotals(tx, invoiceId) {
  const [invoice, paidAgg, refundAgg] = await Promise.all([
    tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, state: true, totalAmount: true },
    }),
    tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } }),
    tx.refund.aggregate({ where: { invoiceId, state: 'RECORDED' }, _sum: { amount: true } }),
  ]);
  if (!invoice) return null;

  const amountPaid = round2(num(paidAgg._sum.amount));
  const amountRefunded = round2(num(refundAgg._sum.amount));

  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid,
      amountRefunded,
      state: stateForPayment(invoice, amountPaid),
    },
    select: {
      id: true, invoiceNumber: true, state: true,
      totalAmount: true, amountPaid: true, amountRefunded: true,
    },
  });
}

/** Adds whole months without letting the 31st silently roll into the next month. */
export function addMonths(date, months) {
  const d = new Date(date);
  const targetDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < targetDay) d.setDate(0);   // clamp to the last day of the month
  return d;
}

/**
 * The state a term is in, derived from its dates rather than stored and left to
 * rot. Cancellation is the one thing that is not derivable, so it wins.
 */
export function subscriptionStateOf({ startsAt, endsAt, cancelledAt }, now = new Date()) {
  if (cancelledAt) return 'CANCELLED';
  if (new Date(startsAt) > now) return 'PENDING';
  if (endsAt && new Date(endsAt) < now) return 'EXPIRED';
  return 'ACTIVE';
}
