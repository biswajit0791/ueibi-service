/**
 * @file documentTemplate.schema.js
 * @description Zod validation schemas for Document Template CRUD, Preview, and Generation endpoints.
 */

import { z } from 'zod';

export const DOCUMENT_TYPES = [
  'TERMINATION_LETTER',
  'RELIEVING_LETTER',
  'SERVICE_CERTIFICATE',
  'REFERENCE_CHECK',
  'OFFER_LETTER',
  'EXPERIENCE_LETTER',
  'APPOINTMENT_LETTER',
  'SALARY_REVISION',
  'WARNING_LETTER',
  'APPRECIATION_LETTER',
  'INTERNSHIP_CERTIFICATE',
  'CUSTOM',
];

export const documentTypeEnum = z.enum(DOCUMENT_TYPES);

export const createTemplateSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(120),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
  documentType: documentTypeEnum,
  description: z.string().max(500).optional().nullable(),
  htmlTemplate: z.string().min(10, 'HTML template content is required'),
  cssStyles: z.string().optional().nullable(),
  headerHtml: z.string().optional().nullable(),
  footerHtml: z.string().optional().nullable(),
  layoutSettings: z.any().optional().default({}),
  logoUrl: z.string().url().optional().nullable().or(z.literal('')),
  watermarkUrl: z.string().optional().nullable(),
  signatureUrl: z.string().optional().nullable(),
  isDefault: z.boolean().optional().default(false),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(500).optional().nullable(),
  htmlTemplate: z.string().min(10).optional(),
  cssStyles: z.string().optional().nullable(),
  headerHtml: z.string().optional().nullable(),
  footerHtml: z.string().optional().nullable(),
  layoutSettings: z.any().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  watermarkUrl: z.string().optional().nullable(),
  signatureUrl: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const publishTemplateSchema = z.object({
  changeNote: z.string().max(250).optional(),
});

export const cloneTemplateSchema = z.object({
  newName: z.string().min(2).max(120).optional(),
});

export const previewTemplateSchema = z.object({
  templateId: z.string().nullish(),
  htmlTemplate: z.string().nullish(),
  headerHtml: z.string().nullish(),
  footerHtml: z.string().nullish(),
  cssStyles: z.string().nullish(),
  layoutSettings: z.any().nullish(),
  documentType: z.string().nullish(),
  employeeId: z.string().nullish(),
  exitDetailsId: z.string().nullish(),
  manualOverrides: z.any().nullish().default({}),
});

export const generateDocumentSchema = z.object({
  templateId: z.string().nullish(),
  documentType: z.string(),
  employeeId: z.string().nullish(),
  exitDetailsId: z.string().nullish(),
  manualOverrides: z.any().nullish().default({}),
  sendEmail: z.boolean().nullish().default(false),
});

export const resolveTokensSchema = z.object({
  documentType: z.string().nullish(),
  employeeId: z.string().nullish(),
  exitDetailsId: z.string().nullish(),
});

export const customTokenSchema = z.object({
  token: z.string().regex(/^[a-zA-Z0-9_]+$/, 'Token must be alphanumeric'),
  label: z.string().min(2).max(60),
  group: z.string().min(2).max(40).optional().default('Custom'),
  description: z.string().max(200).optional(),
  dataSource: z.string().min(1).max(100),
  formatter: z.enum(['date', 'shortDate', 'currency', 'maskedPan', 'tenure', 'uppercase', 'lowercase', 'capitalize']).optional().nullable(),
  sampleValue: z.string().max(200).optional(),
  isRequired: z.boolean().optional().default(false),
});
