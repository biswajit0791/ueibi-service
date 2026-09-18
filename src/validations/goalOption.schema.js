import { z } from 'zod';

// Zod 4: `required_error` is ignored; custom messages use `{ error: '...' }`.

export const GOAL_OPTION_KINDS = ['CATEGORY', 'TYPE', 'PRIORITY'];

const label = z
  .string({ error: 'Label is required' })
  .trim()
  .min(1, 'Label cannot be empty')
  .max(100, 'Label cannot exceed 100 characters');

export const listGoalOptionsQuerySchema = z.object({
  kind: z.enum(GOAL_OPTION_KINDS).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

export const createGoalOptionSchema = z.object({
  kind: z.enum(GOAL_OPTION_KINDS, { error: `kind must be one of: ${GOAL_OPTION_KINDS.join(', ')}` }),
  label,
  // Defaults to the label. Priority values are lowercased by the service so
  // they match what the goal schema stores.
  value: z.string().trim().max(100).optional(),
  color: z.string().trim().max(20).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

export const updateGoalOptionSchema = z
  .object({
    label: label.optional(),
    value: z.string().trim().max(100).optional(),
    color: z.string().trim().max(20).nullish(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update' });

export const goalOptionIdParamSchema = z.object({
  id: z.string({ error: 'Option ID is required' }).trim().min(1).max(100),
});
