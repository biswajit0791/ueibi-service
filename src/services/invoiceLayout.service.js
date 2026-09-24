/**
 * invoiceLayout.service.js — turning designer settings into an invoice template.
 *
 * The designer is a settings form, not a markup editor, so this is where those
 * settings become the Mustache template that the existing renderer already
 * consumes. Everything downstream — renderInvoiceTemplate, buildInvoiceView,
 * sanitisation, version pinning, the print page — is unchanged.
 *
 * That is the point: the designer is a new front end onto the existing
 * pipeline, not a second pipeline.
 *
 * Some sections are LOCKED ON. A tax invoice must identify the supplier and
 * their GSTIN, carry its number and date, identify the recipient, and show the
 * taxable value and tax separately. Those cannot be switched off, which is what
 * replaces the old "required token missing" check — the mistake is now
 * unmakeable rather than merely caught.
 */

/** Sections a GST invoice cannot legally omit, with why, shown in the designer. */
export const LOCKED_SECTIONS = {
  showCompanyDetails: 'the supplier must be identified on a tax invoice',
  showInvoiceNumber: 'every tax invoice needs its serial number',
  showInvoiceDate: 'a tax invoice must be dated',
  showCustomerDetails: 'the recipient must be identified',
  showProductTable: 'the goods or services supplied must be described',
  showTaxBreakdown: 'the taxable value and tax must be shown separately',
  showTotal: 'the invoice total must be stated',
};

/** Everything the designer can switch, and what it defaults to. */
export const DEFAULT_SETTINGS = {
  layoutStyle: 'CLASSIC',          // CLASSIC | MODERN | COMPACT

  logoUrl: null,
  watermarkUrl: null,

  headerBackground: '#ffffff',
  footerBackground: '#ffffff',
  primaryBrand: '#0f172a',
  secondaryText: '#64748b',
  fontFamily: 'Helvetica',         // Helvetica | Georgia | Courier
  baseFontSize: 13,
  borderStyle: 'SOLID',            // SOLID | DASHED | NONE

  paperSize: 'A4',                 // A4 | LETTER | LEGAL
  orientation: 'PORTRAIT',
  pageMargin: 16,                  // mm
  showPageNumbers: true,

  showCompanyLogo: true,
  showCompanyDetails: true,
  showInvoiceNumber: true,
  showInvoiceDate: true,
  showDueDate: true,
  showCustomerDetails: true,
  showCustomerGstin: true,
  showProductTable: true,
  showTermPeriod: true,
  showDiscount: true,
  showCoupon: true,
  showTaxBreakdown: true,
  showTotal: true,
  showPaymentHistory: true,
  showAmountPaid: true,
  showNotes: true,
  showSignature: false,
  showSeal: false,
  showFooter: true,

  footerMessage: '',
  termsText: '',
};

const FONT_STACK = {
  Helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  Georgia: "Georgia, 'Times New Roman', serif",
  Courier: "'Courier New', Courier, monospace",
};

const PAPER = {
  A4: '210mm 297mm',
  LETTER: '8.5in 11in',
  LEGAL: '8.5in 14in',
};

/** Merges saved settings over the defaults and forces the locked sections on. */
export function normaliseSettings(input) {
  const s = { ...DEFAULT_SETTINGS, ...(input || {}) };
  // Belt and braces: the designer renders these as locked, the API validates
  // them, and they are forced here too. A tax invoice missing its GSTIN is the
  // kind of thing that should take three independent failures to produce.
  for (const key of Object.keys(LOCKED_SECTIONS)) s[key] = true;
  return s;
}

/** Which locked sections a submitted settings object tried to switch off. */
export function disabledLockedSections(input) {
  return Object.entries(LOCKED_SECTIONS)
    .filter(([key]) => input && input[key] === false)
    .map(([key, why]) => ({ section: key, why }));
}

/** Escapes a value for safe inclusion in generated markup. */
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** A colour we are willing to put in a stylesheet. */
const colour = (v, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(v || '')) ? v : fallback);

/** An image URL we are willing to render. Same-origin uploads or https only. */
const imageUrl = (v) => {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.startsWith('/uploads/')) return s;
  if (/^https:\/\//i.test(s)) return s;
  return null;
};

/**
 * Generates the Mustache template body for a settings object.
 *
 * Mustache sections ({{#flag}}) are only emitted for things that vary per
 * invoice. A section the operator has switched OFF is omitted from the markup
 * entirely rather than emitted and hidden, so the printed document carries no
 * trace of it.
 */
export function buildTemplateHtml(rawSettings) {
  const s = normaliseSettings(rawSettings);
  const out = [];
  const logo = imageUrl(s.logoUrl);
  const signature = imageUrl(s.signatureUrl);
  const seal = imageUrl(s.sealUrl);

  // ── Header ──
  out.push('<table class="inv-head"><tr><td>');
  if (s.showCompanyLogo && logo) {
    out.push(`<img class="logo" src="${esc(logo)}" alt="{{issuerName}}" />`);
  }
  // Locked on: the supplier and their GSTIN.
  out.push('<h1>{{issuerName}}</h1>');
  out.push('<p class="muted">GSTIN {{issuerGstin}}</p>');
  out.push('{{#issuerAddress}}<p class="muted addr">{{issuerAddress}}</p>{{/issuerAddress}}');
  out.push('</td><td class="right">');
  out.push('<p class="doclabel">{{#isVoid}}VOID{{/isVoid}}{{^isVoid}}TAX INVOICE{{/isVoid}}</p>');
  out.push('<h2 class="number">{{invoiceNumber}}</h2>');          // locked
  out.push('<p class="muted">Issued {{issuedAt}}</p>');            // locked
  if (s.showDueDate) out.push('{{#dueAt}}<p class="muted">Due {{dueAt}}</p>{{/dueAt}}');
  out.push('</td></tr></table>');

  out.push('{{#isVoid}}<p class="void">This invoice was voided on {{voidedAt}}. {{voidReason}} It is not payable.</p>{{/isVoid}}');

  // ── Bill to (locked) ──
  out.push('<p class="label">BILLED TO</p>');
  out.push('<p class="billto">{{billToName}}</p>');
  if (s.showCustomerGstin) out.push('{{#billToGstin}}<p class="muted">GSTIN {{billToGstin}}</p>{{/billToGstin}}');
  out.push('<p class="muted">{{billToEmail}}</p>');

  // ── Line items (locked) ──
  out.push('<table class="lines"><thead><tr>'
    + '<th>Description</th><th class="right">Qty</th>'
    + '<th class="right">Rate</th><th class="right">Amount</th>'
    + '</tr></thead><tbody><tr><td>{{packageName}}');
  if (s.showTermPeriod) {
    out.push('<span class="muted term">{{termStart}}'
      + '{{#isPerpetual}} onwards (perpetual){{/isPerpetual}}'
      + '{{^isPerpetual}} &ndash; {{termEnd}}{{/isPerpetual}}</span>');
  }
  out.push('</td><td class="right">{{quantity}}</td>'
    + '<td class="right">{{unitPrice}}</td>'
    + '<td class="right">{{subtotal}}</td></tr></tbody></table>');

  // ── Totals (tax breakdown and total are locked) ──
  out.push('<table class="totals">');
  out.push('<tr><td>Subtotal</td><td class="right">{{subtotal}}</td></tr>');
  if (s.showDiscount) {
    const couponBit = s.showCoupon ? ' {{couponCode}}' : '';
    out.push(`{{#hasDiscount}}<tr><td>Discount${couponBit}</td><td class="right">&minus; {{discountAmount}}</td></tr>{{/hasDiscount}}`);
  }
  out.push('<tr><td>GST ({{gstRatePercent}}%)</td><td class="right">{{gstAmount}}</td></tr>');
  out.push('<tr class="grand"><td>Total</td><td class="right">{{total}}</td></tr>');
  if (s.showAmountPaid) {
    out.push('{{#hasPayments}}<tr class="paid"><td>Received</td><td class="right">{{amountPaid}}</td></tr>{{/hasPayments}}');
    out.push('{{#hasOutstanding}}<tr class="due"><td>Balance due</td><td class="right">{{outstanding}}</td></tr>{{/hasOutstanding}}');
  }
  out.push('</table>');

  // ── Payments ──
  if (s.showPaymentHistory) {
    out.push('{{#hasPayments}}<p class="label">PAYMENTS RECEIVED</p><table class="payments">'
      + '{{#payments}}<tr><td class="muted">{{date}} &middot; {{method}}'
      + '{{#reference}} &middot; {{reference}}{{/reference}}</td>'
      + '<td class="right">{{amount}}</td></tr>{{/payments}}</table>{{/hasPayments}}');
    // Carried forward from the pre-billing flow and never reconciled; the
    // caveat travels with the document rather than only living in the console.
    out.push('{{#hasUnverifiedPayment}}<p class="warn">One or more payments shown were carried '
      + 'forward from the pre-billing signup flow. Their references predate gateway '
      + 'verification and have not been reconciled against a bank statement.</p>'
      + '{{/hasUnverifiedPayment}}');
  }

  if (s.showNotes) out.push('{{#notes}}<p class="notes">{{notes}}</p>{{/notes}}');

  if (s.termsText) out.push(`<div class="terms">${esc(s.termsText)}</div>`);

  // ── Signature and seal ──
  if ((s.showSignature && signature) || (s.showSeal && seal)) {
    out.push('<table class="marks"><tr>');
    out.push('<td>' + (s.showSignature && signature
      ? `<img class="mark" src="${esc(signature)}" alt="Authorised signature" /><p class="muted">Authorised signature</p>`
      : '') + '</td>');
    out.push('<td class="right">' + (s.showSeal && seal
      ? `<img class="mark" src="${esc(seal)}" alt="Company seal" />`
      : '') + '</td>');
    out.push('</tr></table>');
  }

  if (s.showFooter) {
    const msg = s.footerMessage
      ? esc(s.footerMessage)
      : '{{#hasOutstanding}}Please quote the invoice number with your payment.{{/hasOutstanding}}'
        + '{{#isPaid}}This invoice has been settled in full. No payment is due.{{/isPaid}}';
    out.push(`<p class="footer">${msg}</p>`);
  }

  return out.join('\n');
}

/**
 * The print stylesheet for a settings object.
 *
 * Scoped by the caller to the invoice container, so a template cannot restyle
 * the surrounding page.
 */
export function buildTemplateCss(rawSettings) {
  const s = normaliseSettings(rawSettings);
  const brand = colour(s.primaryBrand, '#0f172a');
  const muted = colour(s.secondaryText, '#64748b');
  const headerBg = colour(s.headerBackground, '#ffffff');
  const footerBg = colour(s.footerBackground, '#ffffff');
  const font = FONT_STACK[s.fontFamily] || FONT_STACK.Helvetica;
  const size = Math.min(Math.max(Number(s.baseFontSize) || 13, 8), 20);
  const border = s.borderStyle === 'NONE' ? 'none'
    : s.borderStyle === 'DASHED' ? `1px dashed ${muted}`
      : `1px solid #e2e8f0`;
  const watermark = imageUrl(s.watermarkUrl);
  const compact = s.layoutStyle === 'COMPACT';
  const modern = s.layoutStyle === 'MODERN';

  return `
:root { color-scheme: light; }
* { font-family: ${font}; }
body, .doc { font-size: ${size}px; color: ${brand}; line-height: ${compact ? 1.45 : 1.65}; }
${watermark ? `.doc { background-image: url("${watermark}"); background-repeat: no-repeat; background-position: center; background-size: 60%; }` : ''}
.logo { max-height: ${compact ? 34 : 48}px; margin-bottom: 8px; }
.inv-head { width: 100%; margin-bottom: ${compact ? 18 : 30}px; background: ${headerBg}; }
.inv-head td { vertical-align: top; ${headerBg !== '#ffffff' ? 'padding: 14px;' : ''} }
h1 { font-size: ${size + 8}px; font-weight: 800; margin: 0; letter-spacing: -0.01em; color: ${brand}; }
h2.number { font-size: ${size + 4}px; font-weight: 700; font-family: monospace; margin: 4px 0; }
.doclabel { font-size: ${size - 2}px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${muted}; margin: 0; }
.label { font-size: ${size - 2}px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${muted}; margin: ${compact ? 14 : 22}px 0 6px; }
.muted { color: ${muted}; font-size: ${size - 1}px; margin: 2px 0; }
.addr { white-space: pre-line; }
.right { text-align: right; }
.billto { font-size: ${size + 2}px; font-weight: 700; margin: 0; }
.void { border: 2px solid #dc2626; color: #dc2626; border-radius: 8px; padding: 11px 15px; margin: 0 0 22px; font-weight: 600; }
.lines { width: 100%; border-collapse: collapse; margin: ${compact ? 16 : 26}px 0 ${compact ? 14 : 22}px; }
.lines th { text-align: left; padding: 8px 0; font-size: ${size - 2}px; letter-spacing: 0.06em; text-transform: uppercase; color: ${muted}; border-bottom: ${modern ? `2px solid ${brand}` : '2px solid #0f172a'}; }
.lines th.right, .lines td.right { text-align: right; }
.lines td { padding: ${compact ? 8 : 13}px 0; border-bottom: ${border}; }
.term { display: block; font-size: ${size - 2}px; margin-top: 2px; }
.totals { margin-left: auto; width: 320px; border-collapse: collapse; }
.totals td { padding: 5px 0; color: ${muted}; }
.totals td.right { color: ${brand}; }
.totals tr.grand td { border-top: 2px solid ${modern ? brand : '#0f172a'}; padding-top: 10px; font-size: ${size + 3}px; font-weight: 800; color: ${brand}; }
.totals tr.paid td { color: #059669; }
.totals tr.due td { font-weight: 700; color: #b45309; }
.payments { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
.payments td { padding: 5px 0; font-size: ${size - 1}px; border-bottom: 1px solid #f1f5f9; }
.warn { font-size: ${size - 2}px; color: #b45309; line-height: 1.6; margin: 16px 0 0; }
.notes { color: ${muted}; line-height: 1.6; margin: 22px 0 0; white-space: pre-line; }
.terms { color: ${muted}; font-size: ${size - 1}px; line-height: 1.6; margin: 22px 0 0; white-space: pre-line; }
.marks { width: 100%; margin-top: 34px; }
.mark { max-height: 60px; }
.footer { margin-top: ${compact ? 24 : 36}px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: ${size - 2}px; color: ${muted}; background: ${footerBg}; }
@page { size: ${PAPER[s.paperSize] || PAPER.A4} ${s.orientation === 'LANDSCAPE' ? 'landscape' : 'portrait'}; margin: ${Math.min(Math.max(Number(s.pageMargin) || 16, 5), 40)}mm; }
`.trim();
}
