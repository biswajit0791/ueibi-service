/**
 * invoiceTemplate.service.js — turning an invoice into a printable document.
 *
 * Templates are Mustache, which is logic-less on purpose: a template can insert
 * a value, loop a list or test a flag, and nothing else. There is no expression
 * evaluation, so an authored template cannot compute, branch arbitrarily or
 * reach anything the view object does not hand it.
 *
 * Two safeguards apply to every template:
 *
 *   1. **Required tokens.** An invoice is a tax document. Publishing is refused
 *      unless the fields a GST invoice must legally carry are present, so
 *      deleting {{issuerGstin}} by accident cannot produce invoices that fail
 *      an audit.
 *   2. **Sanitisation on write**, with the Mustache delimiters preserved. The
 *      rendered output is sanitised again before it is served.
 */
import Mustache from 'mustache';
import { env } from '../config/env.js';
import { num, invoiceBalances } from './billing.service.js';

/**
 * Tokens a GST invoice cannot legally do without.
 *
 * Each entry is [token, what it is, why it is required]. The `why` is shown to
 * the operator when publishing is refused, because "INVOICE_MISSING_TOKEN" on
 * its own does not tell anybody what to put back.
 */
export const REQUIRED_TOKENS = [
  ['issuerName', 'your registered name', 'the supplier must be identified on a tax invoice'],
  ['issuerGstin', 'your GSTIN', 'a tax invoice must carry the supplier GSTIN'],
  ['invoiceNumber', 'the invoice number', 'every tax invoice needs its serial number'],
  ['issuedAt', 'the issue date', 'a tax invoice must be dated'],
  ['billToName', 'the customer name', 'the recipient must be identified'],
  ['subtotal', 'the taxable value', 'the value before tax must be shown separately'],
  ['gstAmount', 'the tax amount', 'the tax charged must be shown separately'],
  ['total', 'the total payable', 'the invoice total must be stated'],
];

/** Every token a template may use, for the editor's reference panel. */
export const TOKEN_REFERENCE = [
  { group: 'Your details', tokens: [
    ['issuerName', 'Your registered name'],
    ['issuerGstin', 'Your GSTIN'],
    ['issuerAddress', 'Your registered address'],
  ] },
  { group: 'Invoice', tokens: [
    ['invoiceNumber', 'e.g. UEIBI/2026-27/0008'],
    ['issuedAt', 'Issue date'],
    ['dueAt', 'Due date, blank if none'],
    ['state', 'DRAFT, ISSUED, PAID, VOID…'],
    ['notes', 'Notes recorded on the invoice'],
    ['currency', 'INR'],
  ] },
  { group: 'Customer', tokens: [
    ['billToName', 'Company name'],
    ['billToGstin', 'Their GSTIN, blank if none'],
    ['billToEmail', 'Billing email'],
  ] },
  { group: 'Amounts', tokens: [
    ['quantity', 'Number of licences'],
    ['unitPrice', 'Price per licence'],
    ['subtotal', 'Before discount and tax'],
    ['discountAmount', 'Discount given'],
    ['couponCode', 'Coupon used, blank if none'],
    ['gstRatePercent', 'e.g. 18'],
    ['gstAmount', 'Tax charged'],
    ['total', 'Total payable'],
    ['amountPaid', 'Received so far'],
    ['amountRefunded', 'Refunded'],
    ['outstanding', 'Still owed'],
  ] },
  { group: 'Subscription', tokens: [
    ['packageName', 'What was sold'],
    ['termStart', 'Term start date'],
    ['termEnd', 'Term end date, or blank if perpetual'],
    ['isPerpetual', 'Flag: a licence with no end date'],
  ] },
  { group: 'Lists and flags', tokens: [
    ['#payments', 'Loop: date, method, reference, amount'],
    ['#refunds', 'Loop: date, reason, amount'],
    ['#hasDiscount', 'Only shown when a discount applies'],
    ['#isPaid', 'Only shown when nothing is outstanding'],
    ['#hasOutstanding', 'Only shown when money is still owed'],
    ['#isVoid', 'Only shown on a voided invoice'],
    ['#hasUnverifiedPayment', 'Only shown when a payment predates gateway verification'],
  ] },
];

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  : '');

/**
 * Builds the view a template renders against.
 *
 * Money arrives pre-formatted: a template must not be able to present ₹47,188.20
 * as 47188.2 by forgetting to format it, and Mustache cannot format anything
 * itself. Raw numeric values are offered alongside as `*Raw` for arithmetic-free
 * uses like sorting or data attributes.
 */
export function buildInvoiceView(invoice) {
  const bal = invoiceBalances(invoice);
  const payments = (invoice.payments || []).map((p) => ({
    date: date(p.receivedAt),
    method: String(p.method || '').replace(/_/g, ' ').toLowerCase(),
    reference: p.reference || '',
    amount: inr(num(p.amount)),
    amountRaw: num(p.amount),
    // Carried forward from the pre-billing flow and never reconciled.
    unverified: p.method === 'LEGACY',
  }));
  const refunds = (invoice.refunds || []).map((r) => ({
    date: date(r.refundedAt),
    reason: r.reason || '',
    method: String(r.method || '').replace(/_/g, ' ').toLowerCase(),
    amount: inr(num(r.amount)),
    amountRaw: num(r.amount),
  }));

  const sub = invoice.subscription;

  return {
    issuerName: env.invoiceIssuerName || 'UEIBI',
    issuerGstin: env.invoiceIssuerGstin || '',
    issuerAddress: env.invoiceIssuerAddress || '',

    invoiceNumber: invoice.invoiceNumber || 'DRAFT',
    issuedAt: date(invoice.issuedAt),
    dueAt: date(invoice.dueAt),
    state: invoice.state,
    notes: invoice.notes || '',
    currency: invoice.currency || 'INR',

    billToName: invoice.billToName,
    billToGstin: invoice.billToGstin || '',
    billToEmail: invoice.billToEmail,

    quantity: invoice.quantity,
    unitPrice: inr(num(invoice.unitPrice)),
    subtotal: inr(num(invoice.subtotalAmount)),
    discountAmount: inr(num(invoice.discountAmount)),
    couponCode: invoice.couponCode || '',
    gstRatePercent: (num(invoice.gstRate) * 100).toFixed(0),
    gstAmount: inr(num(invoice.gstAmount)),
    total: inr(bal.total),
    amountPaid: inr(bal.paid),
    amountRefunded: inr(bal.refunded),
    outstanding: inr(bal.outstanding),

    totalRaw: bal.total,
    outstandingRaw: bal.outstanding,

    packageName: sub?.packageName || 'Software licences',
    termStart: date(sub?.startsAt),
    termEnd: date(sub?.endsAt),
    isPerpetual: Boolean(sub && !sub.endsAt),

    payments,
    refunds,
    hasPayments: payments.length > 0,
    hasRefunds: refunds.length > 0,
    hasDiscount: num(invoice.discountAmount) > 0,
    isPaid: bal.outstanding <= 0.005 && bal.paid > 0,
    hasOutstanding: bal.outstanding > 0.005,
    isVoid: invoice.state === 'VOID',
    isDraft: invoice.state === 'DRAFT',
    hasUnverifiedPayment: payments.some((p) => p.unverified),
    voidReason: invoice.voidReason || '',
    voidedAt: date(invoice.voidedAt),
  };
}

/**
 * Which required tokens a template body is missing.
 *
 * Deliberately a plain scan rather than a Mustache parse: a token inside a
 * section, a comment or an unusual amount of whitespace still counts as
 * present, and the check should never reject a template for a formatting
 * reason it cannot explain.
 */
export function missingRequiredTokens(bodyHtml) {
  const html = String(bodyHtml || '');
  return REQUIRED_TOKENS
    .filter(([token]) => {
      // Matches {{token}}, {{ token }} and the unescaped {{{token}}}.
      const re = new RegExp(`\\{\\{\\{?\\s*&?\\s*${token}\\s*\\}?\\}\\}`);
      return !re.test(html);
    })
    .map(([token, what, why]) => ({ token, what, why }));
}

/**
 * Renders a template against an invoice.
 *
 * Mustache escapes by default, so a company named `<script>` is printed as
 * text rather than executed. The caller sanitises the result as well.
 */
export function renderInvoiceTemplate(bodyHtml, invoice) {
  return renderWithView(bodyHtml, buildInvoiceView(invoice));
}

/**
 * Renders against a view that has already been built — used by preview, which
 * may be working from sample data rather than a real invoice.
 */
export function renderWithView(bodyHtml, view) {
  try {
    return { html: Mustache.render(String(bodyHtml || ''), view), error: null };
  } catch (err) {
    // A malformed template is the author's mistake, not a server fault, so the
    // message is returned for display rather than thrown.
    return { html: null, error: err.message };
  }
}

/** Sample data for previewing a template with no invoice selected. */
export function sampleInvoiceView() {
  return buildInvoiceView({
    invoiceNumber: 'UEIBI/2026-27/0001',
    issuedAt: new Date(),
    dueAt: new Date(Date.now() + 14 * 86400000),
    state: 'PAID',
    billToName: 'Sample Company Private Limited',
    billToGstin: '29ABCDE1234F1Z5',
    billToEmail: 'accounts@sample.test',
    currency: 'INR',
    quantity: 10,
    unitPrice: 3999,
    subtotalAmount: 39990,
    discountAmount: 0,
    gstRate: env.gstRate ?? 0.18,
    gstAmount: 7198.2,
    totalAmount: 47188.2,
    amountPaid: 47188.2,
    amountRefunded: 0,
    notes: '',
    subscription: { packageName: '10 licences', startsAt: new Date(), endsAt: null },
    payments: [{
      receivedAt: new Date(), method: 'BANK_TRANSFER',
      reference: 'UTR123456789', amount: 47188.2,
    }],
    refunds: [],
  });
}
