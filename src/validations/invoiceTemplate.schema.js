import { z } from 'zod';

/** Zod 4: custom messages go in `{ error: '…' }`, never v3's `required_error`. */

const slug = z.string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only');

export const templateSlugParamSchema = z.object({ slug });

export const templateVersionParamSchema = z.object({
  slug,
  versionId: z.string().min(1),
});

export const templateCreateSchema = z.object({
  slug,
  title: z.string({ error: 'A template needs a name' }).trim().min(2).max(160),
  description: z.string().trim().max(300).nullish(),
});

export const templateUpdateSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(300).nullish(),
  isDefault: z.boolean().optional(),
});

export const templateVersionWriteSchema = z.object({
  title: z.string({ error: 'A version needs a name' }).trim().min(2).max(160),
  // Sanitised server-side with the Mustache delimiters preserved, so the
  // editor's output is never trusted but the template language survives.
  bodyHtml: z.string({ error: 'The template cannot be empty' }).min(1).max(200000),
  // Print CSS, kept apart from the markup. Not sanitised as HTML because it is
  // not HTML; it is scoped to the invoice container when rendered.
  css: z.string().max(40000).nullish(),
  changeNote: z.string().trim().max(1000).nullish(),
});

export const templatePreviewSchema = z.object({
  bodyHtml: z.string({ error: 'Nothing to preview' }).min(1).max(200000),
  css: z.string().max(40000).nullish(),
  // Preview against a real invoice; omitted means sample data.
  invoiceId: z.string().min(1).nullish(),
});

// ── Invoice settings ────────────────────────────────────────────────────────

const hexColour = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'Use a hex colour like #154468');
/// Same-origin uploads or https only — never javascript: or data:.
const assetUrl = z.string()
  .refine((v) => !v || v.startsWith('/uploads/') || /^https:\/\//i.test(v),
    'Upload the file, or give an https address')
  .nullish();

export const invoiceSettingsSchema = z.object({
  numberPrefix: z.string().trim().min(1).max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and hyphens only — the prefix appears in a tax invoice number'),
  includeFinancialYear: z.boolean().default(true),
  // A floor, not an override: allocation takes the higher of this and one past
  // the highest already issued.
  nextNumber: z.coerce.number().int().min(1).max(999999),

  currencyCode: z.string().trim().length(3).toUpperCase(),
  currencySymbol: z.string().trim().min(1).max(4),
  symbolPosition: z.enum(['BEFORE', 'AFTER']).default('BEFORE'),
  dateFormat: z.enum(['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'MMM DD, YYYY']).default('DD MMM YYYY'),
  defaultPaymentTerms: z.string().trim().max(200).nullish(),

  taxName: z.string().trim().min(1).max(30),
  taxPercent: z.coerce.number().min(0).max(100),

  issuerName: z.string().trim().min(1).max(160),
  issuerGstin: z.string().trim().max(20).nullish(),
  issuerAddress: z.string().trim().max(500).nullish(),

  signatureUrl: assetUrl,
  sealUrl: assetUrl,
});

export const templateSettingsSchema = z.object({
  layoutStyle: z.enum(['CLASSIC', 'MODERN', 'COMPACT']).default('CLASSIC'),
  logoUrl: assetUrl,
  watermarkUrl: assetUrl,
  headerBackground: hexColour.default('#ffffff'),
  footerBackground: hexColour.default('#ffffff'),
  primaryBrand: hexColour.default('#0f172a'),
  secondaryText: hexColour.default('#64748b'),
  fontFamily: z.enum(['Helvetica', 'Georgia', 'Courier']).default('Helvetica'),
  baseFontSize: z.coerce.number().int().min(8).max(20).default(13),
  borderStyle: z.enum(['SOLID', 'DASHED', 'NONE']).default('SOLID'),
  paperSize: z.enum(['A4', 'LETTER', 'LEGAL']).default('A4'),
  orientation: z.enum(['PORTRAIT', 'LANDSCAPE']).default('PORTRAIT'),
  pageMargin: z.coerce.number().int().min(5).max(40).default(16),
  showPageNumbers: z.boolean().default(true),
  footerMessage: z.string().trim().max(600).nullish(),
  termsText: z.string().trim().max(4000).nullish(),
  signatureUrl: assetUrl,
  sealUrl: assetUrl,
// Section toggles are booleans with sane defaults; the locked ones are forced
// true server-side whatever arrives, so this stays permissive on purpose.
}).catchall(z.boolean().or(z.string()).or(z.number()).nullish());
