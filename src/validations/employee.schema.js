import { z } from 'zod';

// Optional PAN validation: if provided, must match format.
const panSchema = z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "PAN must be in format: 5 uppercase letters, 4 digits, 1 uppercase letter").optional().or(z.literal(''));

export const updateActiveEmployeeSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  designation: z.string().min(2, "Designation is required").optional(),
  phone: z.string().min(10, "Phone must be at least 10 characters").optional().or(z.literal('')),
  pan: panSchema,
}).passthrough(); // Allow other fields to pass through without erroring

export const updateExEmployeeSchema = z.object({
  serviceStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Service start date must be YYYY-MM-DD").optional().or(z.literal('')),
  serviceEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Service end date must be YYYY-MM-DD").optional().or(z.literal('')),
  conductValue: z.enum(['Excellent', 'Good', 'Average', 'Poor']).optional(),
  techRating: z.number().min(1).max(10).optional(),
  attitudeRating: z.number().min(1).max(10).optional(),
  feedback: z.string().optional(),
}).passthrough();

export const updateNonJoinerSchema = z.object({
  offerReleaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Offer release date must be YYYY-MM-DD").optional().or(z.literal('')),
  dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Proposed joining date must be YYYY-MM-DD").optional().or(z.literal('')),
  feedback: z.string().optional(),
}).passthrough();
