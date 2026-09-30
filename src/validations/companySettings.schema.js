import { z } from 'zod';

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(?!@)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Enter a plain domain, e.g. client.com or eu.client.com');

export const updateCompanySettingsSchema = z.object({
  milestoneWatcherDomains: z.array(domainSchema).max(25, 'At most 25 domains').optional(),
  milestoneRequireApproval: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});
