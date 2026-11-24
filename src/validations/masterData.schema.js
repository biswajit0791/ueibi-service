import { z } from 'zod';

export const cityCreateSchema = z.object({
  name: z.string().trim().min(1, 'City name is required').max(100),
  state: z.string().trim().min(1, 'State is required').max(100),
  country: z.string().trim().min(1).max(100).optional().default('India'),
  isActive: z.boolean().optional().default(true),
});

export const cityUpdateSchema = z.object({
  name: z.string().trim().min(1, 'City name is required').max(100).optional(),
  state: z.string().trim().min(1, 'State is required').max(100).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const industryCreateSchema = z.object({
  name: z.string().trim().min(1, 'Industry name is required').max(100),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional().default(true),
});

export const industryUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Industry name is required').max(100).optional(),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
});

export const subscriptionDurationCreateSchema = z.object({
  name: z.string().trim().min(1, 'Duration name is required').max(50),
  years: z.coerce.number().int().min(1, 'Duration must be a positive integer in years').max(10),
  months: z.coerce.number().int().optional(),
  displayOrder: z.coerce.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const subscriptionDurationUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Duration name is required').max(50).optional(),
  years: z.coerce.number().int().min(1, 'Duration must be a positive integer in years').max(10).optional(),
  months: z.coerce.number().int().optional(),
  displayOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const toggleStatusSchema = z.object({
  isActive: z.boolean(),
});
