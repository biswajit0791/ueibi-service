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
    .string({ required_error: 'Title is required' })
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
    .string({ required_error: 'Comment text is required' })
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
  id: z.string({ required_error: 'ID is required' }).trim().min(1, 'ID cannot be empty'),
});

