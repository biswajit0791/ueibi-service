import { z } from 'zod';

export const registrySearchQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  name: z.string().trim().max(200).optional(),
  designation: z.string().trim().max(200).optional(),
  birthYear: z.string().trim().regex(/^\d{4}$/, 'birthYear must be a 4-digit year').optional(),
  phone: z.string().trim().max(50).optional(),
  linkedin: z.string().trim().max(200).optional(),
  minTech: z.coerce.number().int().min(0).max(10).optional(),
  minAttitude: z.coerce.number().int().min(0).max(10).optional(),
});
