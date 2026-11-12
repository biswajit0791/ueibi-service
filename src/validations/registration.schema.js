import { z } from 'zod';
import { DESIGNATIONS } from '../lib/constants.js';
import {
  domainMatchesEmail,
  validateCompanyName,
  validateFullName,
  validateDomainSyntax,
  validateOfficialEmailMatch,
  validatePassword,
  validateGstin,
} from '../lib/mouValidation.js';

export const validateDomainSchema = z.object({
  domainName: z.string().trim().min(1, 'Domain name is required'),
  companyName: z.string().trim().optional(),
});

export const validateOfficialEmailSchema = z.object({
  email: z.string().trim().min(1, 'Email is required'),
  domainName: z.string().trim().min(1, 'Company domain is required'),
});

export const publicPricingPreviewSchema = z.object({
  cmdEmail: z.string().trim().optional(),
  hrEmail: z.string().trim().optional(),
  hrNotRequired: z.coerce.boolean().optional().default(false),
  financeEmail: z.string().trim().optional(),
  financeNotRequired: z.coerce.boolean().optional().default(false),
  additionalLicenses: z.coerce.number().int().min(0).optional().default(0),
  licenseQuantity: z.coerce.number().int().min(1, 'License quantity must be at least 1').default(10),
  couponCode: z.string().trim().optional().nullable(),
});

export const otpRequestSchema = z
  .object({
    email: z.string().trim().email('Invalid email address format'),
    domainName: z.string().trim().min(1, 'Company domain is required'),
  })
  .refine((data) => {
    const res = validateOfficialEmailMatch(data.email, data.domainName);
    return res.valid;
  }, {
    message: 'Email domain must match registered company domain exactly',
    path: ['email'],
  });

export const otpVerifySchema = z.object({
  email: z.string().trim().email('Invalid email address format'),
  otp: z.string().trim().min(4, 'OTP must be at least 4 digits').max(10, 'OTP cannot exceed 10 digits'),
});

export const registrationSchema = z
  .object({
    companyName: z
      .string()
      .trim()
      .min(2, 'Company name must be at least 2 characters')
      .max(120, 'Company name cannot exceed 120 characters')
      .refine((val) => validateCompanyName(val).valid, {
        message: 'Company name cannot be an email address, URL, or invalid format',
      }),
    companyType: z.string().trim().min(1, 'Company type is required'),
    organizationStructureId: z.string().trim().optional(),
    domainName: z
      .string()
      .trim()
      .min(1, 'Domain name is required')
      .refine((val) => validateDomainSyntax(val).valid, {
        message: 'Invalid domain syntax or public email provider domain used',
      }),
    fullName: z
      .string()
      .trim()
      .min(2, 'Full name must be at least 2 characters')
      .max(100, 'Full name cannot exceed 100 characters')
      .refine((val) => validateFullName(val).valid, {
        message: 'Full name cannot be an email address, URL, or numbers-only',
      }),
    designation: z.enum(DESIGNATIONS),
    email: z.string().trim().email('Invalid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password cannot exceed 128 characters')
      .refine((val) => validatePassword(val).valid, {
        message:
          'Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, 1 special character, and no leading/trailing spaces',
      }),
    confirmPassword: z.string().min(8, 'Confirm password must be at least 8 characters'),

    // Stakeholders (HR and Finance)
    hrNotRequired: z.boolean().default(false),
    hrName: z
      .string()
      .trim()
      .max(100, 'HR full name cannot exceed 100 characters')
      .optional()
      .nullable()
      .or(z.literal('')),
    hrEmail: z.string().trim().optional().nullable().or(z.literal('')),

    financeNotRequired: z.boolean().default(false),
    financeName: z
      .string()
      .trim()
      .max(100, 'Finance full name cannot exceed 100 characters')
      .optional()
      .nullable()
      .or(z.literal('')),
    financeEmail: z.string().trim().optional().nullable().or(z.literal('')),

    // Purchase Configuration (CMD Controlled)
    additionalLicenses: z.coerce.number().int().min(0, 'Additional licenses cannot be negative').default(0),
    licenseQuantity: z.coerce.number().int().min(1, 'License quantity must be at least 1').optional(),
    gstin: z
      .string()
      .trim()
      .optional()
      .nullable()
      .refine((val) => validateGstin(val).valid, {
        message: 'Invalid 15-character GSTIN format (e.g. 27ABCDE1234F1Z5)',
      }),
    couponCode: z.string().trim().optional().nullable(),

    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms to proceed' }),
    }),
    verificationToken: z.string().min(1, 'Valid email verification token is required'),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Passwords do not match',
        path: ['confirmPassword'],
      });
    }

    if (!domainMatchesEmail(data.domainName, data.email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CMD email domain must match registered company domain exactly',
        path: ['email'],
      });
    }

    // HR validation when not marked 'Not Required'
    if (!data.hrNotRequired) {
      const hr = (data.hrEmail || '').trim();
      if (!hr) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'HR Head official email is required (or check "HR Department Not Required")',
          path: ['hrEmail'],
        });
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hr)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid HR Head email address',
          path: ['hrEmail'],
        });
      } else if (!domainMatchesEmail(data.domainName, hr)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'HR email domain must match registered company domain exactly',
          path: ['hrEmail'],
        });
      }
    }

    // Finance validation when not marked 'Not Required'
    if (!data.financeNotRequired) {
      const fin = (data.financeEmail || '').trim();
      if (!fin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Finance Head official email is required (or check "Finance Department Not Required")',
          path: ['financeEmail'],
        });
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid Finance Head email address',
          path: ['financeEmail'],
        });
      } else if (!domainMatchesEmail(data.domainName, fin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Finance email domain must match registered company domain exactly',
          path: ['financeEmail'],
        });
      }
    }

    if (!data.hrNotRequired && data.hrEmail && data.hrEmail.trim().toLowerCase() === data.email.trim().toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'HR email must be different from CMD official email (or select "HR Department Not Required")',
        path: ['hrEmail'],
      });
    }
    if (!data.financeNotRequired && data.financeEmail && data.financeEmail.trim().toLowerCase() === data.email.trim().toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Finance email must be different from CMD official email (or select "Finance Department Not Required")',
        path: ['financeEmail'],
      });
    }
  });
