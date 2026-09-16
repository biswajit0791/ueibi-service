import { z } from 'zod';
import { COMPANY_TYPES, DESIGNATIONS } from '../lib/constants.js';
import { domainMatchesEmail } from '../lib/domain.js';

export const otpRequestSchema = z.object({
  email: z.string().email(),
  domainName: z.string().min(1),
});

export const otpVerifySchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

export const registrationSchema = z
  .object({
    companyName: z.string().min(1),
    companyType: z.enum(COMPANY_TYPES),
    domainName: z.string().min(1),
    fullName: z.string().min(1),
    designation: z.enum(DESIGNATIONS),
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
    financeEmail: z.string().email(),
    hrEmail: z.string().email(),
    acceptedTerms: z.literal(true),
    verificationToken: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => domainMatchesEmail(data.domainName, data.email), {
    message: 'Domain name must match your email domain',
    path: ['domainName'],
  });
