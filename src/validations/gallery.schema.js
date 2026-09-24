import { z } from 'zod';

export const ALLOWED_GALLERY_CATEGORIES = [
  'Socials',
  'Hackathon',
  'Retreat',
  'Awards',
  'Townhall',
  'Onboarding',
  'Other',
];

export const createGalleryPostSchema = z.object({
  title: z
    .string({ error: 'Title is required' })
    .trim()
    .min(2, 'Title must be between 2 and 120 characters')
    .max(120, 'Title must be between 2 and 120 characters'),
  category: z
    .enum(ALLOWED_GALLERY_CATEGORIES, {
      errorMap: () => ({ message: `Category must be one of: ${ALLOWED_GALLERY_CATEGORIES.join(', ')}` }),
    })
    .default('Socials'),
});

export const addGalleryCommentSchema = z.object({
  text: z
    .string({ error: 'Comment text is required' })
    .trim()
    .min(1, 'Comment text cannot be empty')
    .max(1000, 'Comment text must be between 1 and 1000 characters'),
});

/**
 * Editing a comment. Same limits as creating one: an edit must not be able to
 * put text into the record that the create endpoint would have rejected.
 *
 * Note this uses Zod 4's `error` key, not v3's `required_error`, which Zod 4
 * silently ignores.
 */
export const galleryCommentUpdateSchema = z.object({
  text: z
    .string({ error: 'Comment text is required' })
    .trim()
    .min(1, 'Comment text cannot be empty')
    .max(1000, 'Comment text must be between 1 and 1000 characters'),
});

export const updateGalleryPostSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Title must be between 2 and 120 characters')
    .max(120, 'Title must be between 2 and 120 characters')
    .optional(),
  category: z
    .enum(ALLOWED_GALLERY_CATEGORIES, {
      errorMap: () => ({ message: `Category must be one of: ${ALLOWED_GALLERY_CATEGORIES.join(', ')}` }),
    })
    .optional(),
});

export const galleryIdParamSchema = z.object({
  id: z.string({ error: 'ID is required' }).trim().min(1, 'ID cannot be empty'),
});

