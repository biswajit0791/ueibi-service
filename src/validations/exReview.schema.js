import { z } from 'zod';

export const requestExReviewSchema = z.object({
  exCompany: z
    .string({ required_error: 'Ex-company details are required' })
    .trim()
    .min(1, 'Ex-company cannot be empty')
    .max(150, 'Ex-company name must not exceed 150 characters'),
  exManagerName: z
    .string({ required_error: 'Ex-manager name is required' })
    .trim()
    .min(1, 'Ex-manager name cannot be empty')
    .max(100, 'Ex-manager name must not exceed 100 characters'),
  exManagerEmail: z
    .string({ required_error: 'Ex-manager email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid ex-manager email address'),
});

export const submitExReviewSchema = z.object({
  rating: z.coerce
    .number({ required_error: 'Rating is required' })
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating cannot exceed 5'),
  feedback: z
    .string({ required_error: 'Feedback is required' })
    .trim()
    .min(1, 'Feedback cannot be empty')
    .max(2000, 'Feedback cannot exceed 2000 characters'),
});
