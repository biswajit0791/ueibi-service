import { z } from 'zod';

// GET /hub/team — no body schema needed

// PATCH /hub/me
export const updateHubProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(80, 'Name cannot exceed 80 characters')
    .optional(),
  hubBio: z
    .string()
    .max(500, 'Bio cannot exceed 500 characters')
    .optional(),
  hubBirthday: z
    .string()
    .max(50, 'Birthday cannot exceed 50 characters')
    .nullable()
    .optional(),
  profileSnaps: z
    .array(
      z.string().refine(
        (url) => url.startsWith('/uploads/') || url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:'),
        'Each snap must be a valid URL or a /uploads/ path'
      )
    )
    .max(10, 'Cannot store more than 10 profile snaps')
    .optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field (name, hubBio, hubBirthday, profileSnaps) must be provided' }
);

// POST /hub/events
export const createHubEventSchema = z.object({
  title: z
    .string({ required_error: 'Event title is required' })
    .trim()
    .min(3, 'Event title must be at least 3 characters')
    .max(120, 'Event title cannot exceed 120 characters'),
  date: z
    .string({ required_error: 'Event date is required' })
    .trim()
    .min(1, 'Event date is required')
    .max(60, 'Date string cannot exceed 60 characters'),
  time: z
    .string()
    .trim()
    .max(40, 'Time string cannot exceed 40 characters')
    .optional()
    .nullable(),
  location: z
    .string()
    .trim()
    .max(150, 'Location cannot exceed 150 characters')
    .optional()
    .nullable(),
  description: z
    .string({ required_error: 'Description & details are required' })
    .trim()
    .min(5, 'Description must be at least 5 characters')
    .max(2000, 'Description cannot exceed 2000 characters'),
  isFeatured: z
    .boolean()
    .optional(),
  postedBy: z
    .string()
    .trim()
    .max(100, 'Posted By cannot exceed 100 characters')
    .optional(),
});

// PATCH /hub/events/:id
export const updateHubEventSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Event title must be at least 3 characters')
    .max(120, 'Event title cannot exceed 120 characters')
    .optional(),
  date: z
    .string()
    .trim()
    .min(1, 'Event date cannot be empty')
    .max(60, 'Date string cannot exceed 60 characters')
    .optional(),
  time: z
    .string()
    .trim()
    .max(40, 'Time string cannot exceed 40 characters')
    .optional()
    .nullable(),
  location: z
    .string()
    .trim()
    .max(150, 'Location cannot exceed 150 characters')
    .optional()
    .nullable(),
  description: z
    .string()
    .trim()
    .min(5, 'Description must be at least 5 characters')
    .max(2000, 'Description cannot exceed 2000 characters')
    .optional(),
  isFeatured: z
    .boolean()
    .optional(),
  postedBy: z
    .string()
    .trim()
    .max(100, 'Posted By cannot exceed 100 characters')
    .optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field to update must be provided' }
);

// GET /hub/events query schema
export const getHubEventsQuerySchema = z.object({
  search: z.string().trim().optional(),
  filter: z.enum(['all', 'featured', 'mine']).optional().default('all'),
  sortBy: z.enum(['newest', 'oldest', 'title_asc', 'title_desc']).optional().default('newest'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(6),
});

// Event ID path param schema (used for /hub/events/:id)
export const eventIdParamSchema = z.object({
  id: z
    .string({ required_error: 'Event ID parameter is required' })
    .trim()
    .min(1, 'Event ID parameter cannot be empty')
    .max(100, 'Event ID parameter is too long'),
});

// GET /hub/team query schema
export const getTeamQuerySchema = z.object({
  search: z.string().trim().optional(),
  department: z.string().trim().optional(),
});


