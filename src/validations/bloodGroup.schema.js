import { z } from 'zod';

// Zod 4: the v3 `required_error` option is ignored, so custom messages use
// `{ error: '...' }`.

// Deliberately permissive on characters: as well as "O+" / "AB-" this has to
// accept named rare phenotypes such as "Bombay (hh)" and "Rh-null".
const name = z
  .string({ error: 'Blood group name is required' })
  .trim()
  .min(1, 'Blood group name cannot be empty')
  .max(30, 'Blood group name cannot exceed 30 characters')
  .regex(
    /^[A-Za-z0-9+\-() /]+$/,
    'Blood group may only contain letters, numbers, spaces and + - ( ) /',
  );

export const listBloodGroupsQuerySchema = z.object({
  // Admin UI passes this to see archived rows too; the dropdown never does.
  includeArchived: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(50).optional(),
});

export const createBloodGroupSchema = z.object({
  name,
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

export const updateBloodGroupSchema = z
  .object({
    name: name.optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Provide at least one field to update',
  });

export const bloodGroupIdParamSchema = z.object({
  id: z
    .string({ error: 'Blood group ID is required' })
    .trim()
    .min(1, 'Blood group ID cannot be empty')
    .max(100, 'Blood group ID is too long'),
});
