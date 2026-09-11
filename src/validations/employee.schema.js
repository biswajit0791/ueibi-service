import { z } from 'zod';

// Optional PAN validation: if provided, must match format.
const panSchema = z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "PAN must be in format: 5 uppercase letters, 4 digits, 1 uppercase letter").optional().or(z.literal(''));

const ratingSchema = z.coerce.number().int().min(1, "Rating must be between 1 and 10").max(10, "Rating must be between 1 and 10");

export const inviteEmployeeSchema = z.object({
  email: z.string().email("A valid email address is required"),
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  role: z.string().optional(),
  designation: z.string().optional(),
  department: z.string().optional(),
  band: z.string().optional(),
  managerId: z.string().min(1).optional(),
  joinDate: z.string().optional(),
  phone: z.string().optional(),
  pan: panSchema,
  dob: z.string().optional(),
  feedbackRemarks: z.string().optional(),
}).passthrough();

// Explicit allow-list of fields an HR/Admin edit may change on an active employee.
// Anything not listed here (passwordHash, status, role, isDeleted, tenantId, …) is ignored.
export const updateEmployeeSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  designation: z.string().min(2, "Designation is required").optional(),
  department: z.string().optional(),
  band: z.string().optional().nullable(),
  officeLocation: z.string().optional().nullable(),
  empType: z.enum(['PERMANENT', 'CONTRACT', 'PROBATION', 'INTERN']).optional(),
  managerId: z.string().min(1).optional().nullable(),
  joinDate: z.string().optional().nullable(),
  confirmationDate: z.string().optional().nullable(),
  phone: z.string().min(10, "Phone must be at least 10 characters").optional().or(z.literal('')),
  personalEmail: z.string().email().optional().or(z.literal('')),
  gender: z.string().optional().nullable(),
  dob: z.string().optional().nullable(),
  bloodGroup: z.string().optional().nullable(),
  emergencyContact: z.string().optional().nullable(),
  pan: panSchema,
  aadhaar: z.string().optional().or(z.literal('')),
  uan: z.string().optional().nullable(),
  esic: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  docs: z.any().optional(),
});

const workHistoryEntrySchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  designation: z.string().min(1, "Designation is required"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional().nullable(),
  isCurrent: z.boolean().optional(),
  reasonForExit: z.string().optional().nullable(),
});

export const onboardEmployeeSchema = z.object({
  newPassword: z.string().min(1, "New password is required to complete onboarding"),
  phone: z.string().optional(),
  pan: panSchema,
  aadhaar: z.string().optional(),
  dob: z.string().optional(),
  joinDate: z.string().optional(),
  gender: z.string().optional(),
  bloodGroup: z.string().optional(),
  personalEmail: z.string().email().optional().or(z.literal('')),
  emergencyContact: z.string().optional(),
  uan: z.string().optional(),
  esic: z.string().optional(),
  bankDetails: z.object({
    bankName: z.string().min(1),
    accountNumber: z.string().min(1),
    ifscCode: z.string().min(1),
    branchName: z.string().min(1),
  }).partial().optional(),
  workHistory: z.array(workHistoryEntrySchema).optional(),
  docs: z.any().optional(),
}).passthrough();

export const createExEmployeeSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("A valid email address is required"),
  phone: z.string().min(6, "Phone number is required"),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i, "PAN must be in format: ABCDE1234F"),
  dob: z.union([z.string(), z.number()]).optional(),
  designation: z.string().min(1, "Designation is required"),
  department: z.string().min(1, "Department is required"),
  serviceStart: z.string().min(1, "Service start date is required"),
  serviceEnd: z.string().min(1, "Service end date is required"),
  exitReason: z.string().optional(),
  techRating: ratingSchema.optional(),
  attitudeRating: ratingSchema.optional(),
  conductValue: z.enum(['Excellent', 'Good', 'Average', 'Poor']).optional(),
  feedback: z.string().optional(),
  docs: z.any().optional(),
}).passthrough();

export const createNonJoinerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("A valid email address is required"),
  phone: z.string().min(6, "Phone number is required"),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i, "PAN must be in format: ABCDE1234F"),
  dob: z.union([z.string(), z.number()]).optional(),
  designation: z.string().min(1, "Designation is required"),
  department: z.string().min(1, "Department is required"),
  offerReleaseDate: z.string().min(1, "Offer release date is required"),
  dateOfJoining: z.string().min(1, "Proposed joining date is required"),
  salary: z.union([z.string(), z.number()]).optional(),
  offerAccepted: z.enum(['Yes', 'No', 'Sent']).optional(),
  feedback: z.string().optional(),
  docs: z.any().optional(),
}).passthrough();

export const updateActiveEmployeeSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  designation: z.string().min(2, "Designation is required").optional(),
  phone: z.string().min(10, "Phone must be at least 10 characters").optional().or(z.literal('')),
  pan: panSchema,
}).passthrough(); // Allow other fields to pass through without erroring

export const updateExEmployeeSchema = z.object({
  serviceStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Service start date must be YYYY-MM-DD").optional().or(z.literal('')),
  serviceEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Service end date must be YYYY-MM-DD").optional().or(z.literal('')),
  conductValue: z.enum(['Excellent', 'Good', 'Average', 'Poor']).optional(),
  techRating: z.number().min(1).max(10).optional(),
  attitudeRating: z.number().min(1).max(10).optional(),
  feedback: z.string().optional(),
}).passthrough();

export const updateNonJoinerSchema = z.object({
  offerReleaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Offer release date must be YYYY-MM-DD").optional().or(z.literal('')),
  dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Proposed joining date must be YYYY-MM-DD").optional().or(z.literal('')),
  feedback: z.string().optional(),
}).passthrough();
