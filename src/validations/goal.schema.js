import { z } from 'zod';

export const createGoalSchema = z.object({
  title: z.string().min(1, "Goal title is required"),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  goalType: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  financialYear: z.string().nullable().optional(),
  quarter: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  attachments: z.array(z.string()).optional(),
  specialNotes: z.string().nullable().optional(),
  employeeId: z.string().min(1, "Employee ID is required").optional(),
}).passthrough();
