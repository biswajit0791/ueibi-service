/**
 * seed-invoice-template.mjs — the default printed invoice.
 *
 * Reproduces the built-in layout as an editable template, so the platform owner
 * starts from what they already have rather than a blank page.
 *
 * Idempotent: an existing template is left alone.
 *
 *   node -r dotenv/config prisma/seed-invoice-template.mjs
 *   node -r dotenv/config prisma/seed-invoice-template.mjs --publish
 */
import { prisma } from '../src/lib/prisma.js';
import { missingRequiredTokens } from '../src/services/invoiceTemplate.service.js';

const PUBLISH = process.argv.includes('--publish');
const SLUG = 'default-invoice';

const BODY = `
<table class="inv-head">
  <tr>
    <td>
      <h1>{{issuerName}}</h1>
      <p class="muted">GSTIN {{issuerGstin}}</p>
      <p class="muted">{{issuerAddress}}</p>
    </td>
    <td class="right">
      <p class="label">{{#isVoid}}VOID{{/isVoid}}{{^isVoid}}TAX INVOICE{{/isVoid}}</p>
      <h2 class="number">{{invoiceNumber}}</h2>
      <p class="muted">Issued {{issuedAt}}</p>
      {{#dueAt}}<p class="muted">Due {{dueAt}}</p>{{/dueAt}}
    </td>
  </tr>
</table>

{{#isVoid}}
<p class="void-notice">This invoice was voided on {{voidedAt}}. {{voidReason}} It is not payable.</p>
{{/isVoid}}

<p class="label">BILLED TO</p>
<p class="bill-to">{{billToName}}</p>
{{#billToGstin}}<p class="muted">GSTIN {{billToGstin}}</p>{{/billToGstin}}
<p class="muted">{{billToEmail}}</p>

<table class="lines">
  <thead>
    <tr>
      <th>Description</th>
      <th class="right">Qty</th>
      <th class="right">Rate</th>
      <th class="right">Amount</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        {{packageName}}
        <span class="muted term">{{termStart}}{{#isPerpetual}} onwards (perpetual){{/isPerpetual}}{{^isPerpetual}} &ndash; {{termEnd}}{{/isPerpetual}}</span>
      </td>
      <td class="right">{{quantity}}</td>
      <td class="right">{{unitPrice}}</td>
      <td class="right">{{subtotal}}</td>
    </tr>
  </tbody>
</table>

<table class="totals">
  <tr><td>Subtotal</td><td class="right">{{subtotal}}</td></tr>
  {{#hasDiscount}}
  <tr><td>Discount {{couponCode}}</td><td class="right">&minus; {{discountAmount}}</td></tr>
  {{/hasDiscount}}
  <tr><td>GST ({{gstRatePercent}}%)</td><td class="right">{{gstAmount}}</td></tr>
  <tr class="grand"><td>Total</td><td class="right">{{total}}</td></tr>
  {{#hasPayments}}
  <tr class="paid"><td>Received</td><td class="right">{{amountPaid}}</td></tr>
  {{/hasPayments}}
  {{#hasOutstanding}}
  <tr class="due"><td>Balance due</td><td class="right">{{outstanding}}</td></tr>
  {{/hasOutstanding}}
</table>

{{#hasPayments}}
<p class="label">PAYMENTS RECEIVED</p>
<table class="payments">
  {{#payments}}
  <tr>
    <td class="muted">{{date}} &middot; {{method}}{{#reference}} &middot; {{reference}}{{/reference}}</td>
    <td class="right">{{amount}}</td>
  </tr>
  {{/payments}}
</table>
{{/hasPayments}}

{{#hasUnverifiedPayment}}
<p class="warn">One or more payments were carried forward from the pre-billing signup flow. Their references predate gateway verification and have not been reconciled against a bank statement.</p>
{{/hasUnverifiedPayment}}

{{#notes}}<p class="notes">{{notes}}</p>{{/notes}}

<p class="footer">{{#hasOutstanding}}Please quote the invoice number with your payment.{{/hasOutstanding}}{{#isPaid}}This invoice has been settled in full. No payment is due.{{/isPaid}}</p>
`;

const CSS = `
.inv-head { width: 100%; margin-bottom: 30px; }
.inv-head td { vertical-align: top; }
h1 { font-size: 21px; font-weight: 800; margin: 0; letter-spacing: -0.01em; }
h2.number { font-size: 17px; font-weight: 700; font-family: monospace; margin: 4px 0; }
.label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; margin: 0 0 6px; }
.muted { color: #64748b; font-size: 12px; margin: 2px 0; }
.right { text-align: right; }
.bill-to { font-size: 15px; font-weight: 700; margin: 0; }
.void-notice { border: 2px solid #dc2626; color: #dc2626; border-radius: 8px; padding: 11px 15px; margin: 0 0 24px; font-size: 13px; font-weight: 600; }
.lines { width: 100%; border-collapse: collapse; margin: 26px 0 22px; }
.lines th { text-align: left; padding: 8px 0; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #0f172a; }
.lines th.right, .lines td.right { text-align: right; }
.lines td { padding: 13px 0; font-size: 13px; border-bottom: 1px solid #e2e8f0; }
.term { display: block; font-size: 11px; margin-top: 2px; }
.totals { margin-left: auto; width: 320px; border-collapse: collapse; }
.totals td { padding: 6px 0; font-size: 13px; color: #64748b; }
.totals td.right { color: #0f172a; }
.totals tr.grand td { border-top: 2px solid #0f172a; padding-top: 11px; font-size: 16px; font-weight: 800; color: #0f172a; }
.totals tr.paid td { color: #059669; }
.totals tr.due td { font-weight: 700; color: #b45309; }
.payments { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
.payments td { padding: 5px 0; font-size: 12px; border-bottom: 1px solid #f1f5f9; }
.warn { font-size: 11.5px; color: #b45309; line-height: 1.6; margin: 18px 0 0; }
.notes { font-size: 12px; color: #64748b; line-height: 1.6; margin: 26px 0 0; white-space: pre-line; }
.footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; }
`;

async function main() {
  const owner = await prisma.tenantUser.findFirst({
    where: { role: 'PLATFORM_OWNER' },
    select: { id: true, name: true },
  });
  if (!owner) {
    console.error('\nNo PLATFORM_OWNER exists. Seed one first.\n');
    process.exitCode = 1;
    return;
  }

  const missing = missingRequiredTokens(BODY);
  if (missing.length > 0) {
    console.error(`\nThe seed template is missing required tokens: ${missing.map((m) => m.token).join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.invoiceTemplate.findUnique({
    where: { slug: SLUG },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  if (existing) {
    const v = existing.versions[0];
    console.log(`\n  SKIP  ${SLUG} already exists`
      + (v ? ` (v${v.version}${v.publishedAt ? ', live' : ', draft'})` : '') + '\n');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoiceTemplate.create({
      data: {
        slug: SLUG,
        title: 'Default Invoice',
        description: 'The standard tax invoice sent to customers.',
        isDefault: PUBLISH,
      },
    });
    await tx.invoiceTemplateVersion.create({
      data: {
        templateSlug: SLUG,
        version: 1,
        title: 'Default Invoice',
        bodyHtml: BODY.trim(),
        css: CSS.trim(),
        changeNote: 'The built-in layout, now editable.',
        authorId: owner.id,
        publishedAt: PUBLISH ? new Date() : null,
      },
    });
  });

  console.log(`\n  ${PUBLISH ? 'LIVE ' : 'DRAFT'} ${SLUG} — created by ${owner.name}`);
  console.log(PUBLISH
    ? '  It is the default and renders every new invoice.\n'
    : '  Created as a draft. Publish it in the console to start using it.\n');
}

main()
  .catch((err) => { console.error('\nFAILED:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
