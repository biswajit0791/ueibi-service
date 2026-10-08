import { z } from 'zod';

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(?!@)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Enter a plain domain, e.g. client.com or eu.client.com');

// ── Company appearance ──────────────────────────────────────────────────────

export const THEME_PRESETS = ['indigo', 'ocean', 'emerald', 'sunset', 'midnight', 'slate', 'rose', 'custom'];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour, e.g. #4f46e5');
const weight = z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]);

// WCAG 2.x relative luminance / contrast ratio.
function luminance(hexColour) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hexColour.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Menu text needs AA for normal text; the accent carries bold button labels
// and UI chrome, so AA-large (3:1) — the long-standing #6366f1 default is 4.47.
const MIN_TEXT_CONTRAST = 4.5;
const MIN_ACCENT_CONTRAST = 3;

export const themeSchema = z.object({
  version: z.literal(1).default(1),
  preset: z.enum(THEME_PRESETS).default('custom'),
  accent: hex.optional(),
  sidebar: z.object({
    background: hex.optional(),
    text: hex.optional(),
    hoverBackground: hex.optional(),
    activeBackground: hex.optional(),
    activeText: hex.optional(),
    indicator: z.enum(['bar', 'pill', 'none']).optional(),
  }).strict().optional(),
  menu: z.object({
    fontSize: z.number().int().min(13).max(16).optional(),
    fontWeight: weight.optional(),
    activeFontWeight: weight.optional(),
    iconSize: z.number().int().min(16).max(20).optional(),
    density: z.enum(['compact', 'comfortable']).optional(),
  }).strict().optional(),
  appFontScale: z.number().int().min(90).max(112).optional(),
  radius: z.enum(['sharp', 'default', 'rounded']).optional(),
  // Stamped by the server on save; accepted (and replaced) so a client can
  // send back the theme it loaded.
  updatedBy: z.unknown().optional(),
  updatedAt: z.unknown().optional(),
}).strict().superRefine((theme, ctx) => {
  const sb = theme.sidebar || {};
  const fail = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

  // A custom background needs a text colour chosen against it.
  if (sb.background && !sb.text) {
    fail(['sidebar', 'text'], 'Choose a sidebar text colour to go with the custom background.');
  }
  const pairs = [
    [['sidebar', 'text'], sb.text, sb.background, 'Sidebar text'],
    [['sidebar', 'text'], sb.text, sb.hoverBackground, 'Sidebar text on hover'],
    [['sidebar', 'activeText'], sb.activeText, sb.activeBackground || sb.background, 'Active menu text'],
  ];
  for (const [path, fg, bg, label] of pairs) {
    if (fg && bg && contrastRatio(fg, bg) < MIN_TEXT_CONTRAST) {
      fail(path, `${label} is hard to read (contrast ${contrastRatio(fg, bg).toFixed(2)}:1, needs ${MIN_TEXT_CONTRAST}:1).`);
    }
  }
  if (theme.accent && contrastRatio(theme.accent, '#ffffff') < MIN_ACCENT_CONTRAST) {
    fail(['accent'], `White text on this accent is hard to read (contrast ${contrastRatio(theme.accent, '#ffffff').toFixed(2)}:1, needs ${MIN_ACCENT_CONTRAST}:1). Pick a darker colour.`);
  }
});

export const updateCompanySettingsSchema = z.object({
  milestoneWatcherDomains: z.array(domainSchema).max(25, 'At most 25 domains').optional(),
  milestoneRequireApproval: z.boolean().optional(),
  // null resets to the default look.
  theme: themeSchema.nullable().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
