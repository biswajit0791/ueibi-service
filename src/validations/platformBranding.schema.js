import { z } from 'zod';

const isAllowedUrl = (val) => {
  if (!val) return true;
  return val.startsWith('/uploads/') || val.startsWith('/api/uploads/') || /^https?:\/\//i.test(val);
};

export const platformBrandingSchema = z.object({
  platformName: z.string().trim().min(1, 'Platform name is required').max(80, 'Platform name too long'),
  tagline: z.string().trim().max(160, 'Tagline too long').optional().default('Enterprise Operations & Governance'),
  badgeText: z.string().trim().max(60, 'Badge text too long').optional().default('ENTERPRISE HUB'),
  logoUrl: z.string().nullable().optional().refine(isAllowedUrl, 'Logo URL must be an uploaded path or valid URL'),
  logoDarkUrl: z.string().nullable().optional().refine(isAllowedUrl, 'Logo Dark URL must be an uploaded path or valid URL'),
  iconUrl: z.string().nullable().optional().refine(isAllowedUrl, 'Icon URL must be an uploaded path or valid URL'),
  faviconUrl: z.string().nullable().optional().refine(isAllowedUrl, 'Favicon URL must be an uploaded path or valid URL'),
  primaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a valid hex color code').optional().default('#4f46e5'),
  gradientStart: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a valid hex color code').optional().default('#4f46e5'),
  gradientEnd: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a valid hex color code').optional().default('#3b82f6'),
  copyrightText: z.string().trim().max(200, 'Copyright text too long').optional().default('UEIBI Platform Inc. All rights reserved.'),
});
