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
  otp: z.string().trim().length(6, 'OTP must be exactly 6 digits'),
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
    hrName: z
      .string()
      .trim()
      .min(2, 'HR full name must be at least 2 characters')
      .max(100, 'HR full name cannot exceed 100 characters')
      .refine((val) => validateFullName(val).valid, {
        message: 'HR full name cannot be an email address, URL, or numbers-only',
      })
      .optional()
      .nullable(),
    hrEmail: z.string().trim().email('Invalid HR Head email address'),

    financeName: z
      .string()
      .trim()
      .min(2, 'Finance full name must be at least 2 characters')
      .max(100, 'Finance full name cannot exceed 100 characters')
      .refine((val) => validateFullName(val).valid, {
        message: 'Finance full name cannot be an email address, URL, or numbers-only',
      })
      .optional()
      .nullable(),
    financeEmail: z.string().trim().email('Invalid Finance Head email address'),

    // Purchase Configuration (CMD Controlled)
    licenseQuantity: z.coerce.number().int().min(1, 'License quantity must be at least 1').default(10),
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
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => domainMatchesEmail(data.domainName, data.email), {
    message: 'CMD email domain must match registered company domain exactly',
    path: ['email'],
  })
  .refine((data) => domainMatchesEmail(data.domainName, data.hrEmail), {
    message: 'HR email domain must match registered company domain exactly',
    path: ['hrEmail'],
  })
  .refine((data) => domainMatchesEmail(data.domainName, data.financeEmail), {
    message: 'Finance email domain must match registered company domain exactly',
    path: ['financeEmail'],
  })
  .refine((data) => data.email.toLowerCase() !== data.hrEmail.toLowerCase(), {
    message: 'HR email must be different from CMD official email',
    path: ['hrEmail'],
  })
  .refine((data) => data.email.toLowerCase() !== data.financeEmail.toLowerCase(), {
    message: 'Finance email must be different from CMD official email',
    path: ['financeEmail'],
  })
  .refine((data) => data.hrEmail.toLowerCase() !== data.financeEmail.toLowerCase(), {
    message: 'Finance email must be different from HR official email',
    path: ['financeEmail'],
  });
