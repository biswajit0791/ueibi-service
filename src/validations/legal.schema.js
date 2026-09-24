import { z } from 'zod';

/**
 * Legal document validation.
 *
 * Zod 4: custom messages go in `{ error: '…' }`. v3's `required_error` is
 * silently ignored by Zod 4 and must not be used.
 */

/** Lowercase, hyphenated, URL-safe — it is the primary key and the public URL. */
const slug = z.string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only');

export const legalSlugParamSchema = z.object({ slug });

export const legalVersionParamSchema = z.object({
  slug,
  versionId: z.string().min(1),
});

export const legalDocumentCreateSchema = z.object({
  slug,
  title: z.string({ error: 'A document needs a title' }).trim().min(2).max(160),
  description: z.string().trim().max(300).nullish(),
});

export const legalDocumentUpdateSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(300).nullish(),
});

export const legalVersionWriteSchema = z.object({
  title: z.string({ error: 'A version needs a title' }).trim().min(2).max(160),
  // Sanitised server-side before it is stored, so the editor's output is never
  // trusted. 400k characters is a generous ceiling for a legal document and
  // stops an accidental paste filling the column.
  bodyHtml: z.string({ error: 'The document body cannot be empty' }).min(1).max(400000),
  changeNote: z.string().trim().max(1000).nullish(),
});

export const legalAcceptanceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
