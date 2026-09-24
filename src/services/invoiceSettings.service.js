/**
 * invoiceSettings.service.js — platform-wide invoicing configuration.
 *
 * These values used to live in `.env`, which meant changing the tax rate or the
 * registered address needed a deploy. They are read from a single row now, with
 * the env values as fallback, so a system with no settings row behaves exactly
 * as it did before this existed.
 *
 * The numbering fields are the sensitive part and are documented where they are
 * used, in billing.service.js.
 */
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

const SINGLETON = 'singleton';

/** What the system uses when no settings row has been saved yet. */
export function fallbackSettings() {
  return {
    id: SINGLETON,
    numberPrefix: 'UEIBI',
    includeFinancialYear: true,
    nextNumber: 1,
    currencyCode: 'INR',
    currencySymbol: '₹',
    symbolPosition: 'BEFORE',
    dateFormat: 'DD MMM YYYY',
    defaultPaymentTerms: null,
    taxName: 'GST',
    // The env rate is a fraction (0.18); settings hold a percentage (18),
    // because that is what an operator types.
    taxPercent: Number(env.gstRate ?? 0.18) * 100,
    issuerName: env.invoiceIssuerName || 'UEIBI',
    issuerGstin: env.invoiceIssuerGstin || null,
    issuerAddress: env.invoiceIssuerAddress || null,
    signatureUrl: null,
    sealUrl: null,
    updatedById: null,
    updatedAt: null,
    /// True when nothing has been saved, so the UI can say the values shown are
    /// defaults rather than choices somebody made.
    isDefault: true,
  };
}

const toPlain = (row) => ({
  ...row,
  taxPercent: Number(row.taxPercent),
  isDefault: false,
});

/**
 * The current settings, falling back field by field.
 *
 * A saved row wins entirely: once an operator has chosen a GSTIN, an empty env
 * var must not creep back in underneath them.
 */
export async function getInvoiceSettings(client = prisma) {
  const row = await client.invoiceSetting.findUnique({ where: { id: SINGLETON } });
  return row ? toPlain(row) : fallbackSettings();
}

/** Creates the row on first save, updates it afterwards. */
export async function saveInvoiceSettings(data, updatedById, client = prisma) {
  const row = await client.invoiceSetting.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, ...data, updatedById },
    update: { ...data, updatedById },
  });
  return toPlain(row);
}

/**
 * The tax rate as the FRACTION that lib/pricing.js expects.
 *
 * Settings store 18; pricing wants 0.18. Converting in one place stops the two
 * representations being confused at a call site, which would be a hundredfold
 * error on a tax figure.
 */
export async function currentGstRate(client = prisma) {
  const s = await getInvoiceSettings(client);
  return Number(s.taxPercent) / 100;
}

/** The issuer block used on invoices and in the printed document. */
export async function currentIssuer(client = prisma) {
  const s = await getInvoiceSettings(client);
  return {
    name: s.issuerName,
    gstin: s.issuerGstin,
    address: s.issuerAddress,
    signatureUrl: s.signatureUrl,
    sealUrl: s.sealUrl,
  };
}
