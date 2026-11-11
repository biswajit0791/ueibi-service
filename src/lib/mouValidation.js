import dns from 'node:dns/promises';

/**
 * Public free webmail and personal email domains that cannot be used as an official company domain.
 */
export const PUBLIC_WEBMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.co.uk',
  'ymail.com',
  'rocketmail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'zoho.com',
  'proton.me',
  'protonmail.com',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'yandex.com',
  'yandex.ru',
  'rediffmail.com',
  'tutanota.com',
  'tutamail.com',
  'fastmail.com',
  'inbox.com',
]);

/**
 * Normalizes a domain by stripping protocol, www, trailing slashes and ports.
 */
export function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

/**
 * Extracts the domain portion of an email address.
 */
export function emailDomain(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '';
  return email.trim().toLowerCase().split('@')[1] || '';
}

/**
 * Validates company name:
 * - Reject email formats or values containing @
 * - Reject URLs/domains
 * - Minimum 2, maximum 120 chars
 * - Must contain alphanumeric / legal business characters
 */
export function validateCompanyName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: 'Company name is required.' };
  }
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, message: 'Company name must be at least 2 characters.' };
  }
  if (trimmed.length > 120) {
    return { valid: false, message: 'Company name cannot exceed 120 characters.' };
  }
  if (trimmed.includes('@') || /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(trimmed)) {
    return { valid: false, message: 'Company name cannot be an email address.' };
  }
  if (/^(https?:\/\/|www\.)/i.test(trimmed) || /\.(com|org|net|in|io|co|biz)($|\/)/i.test(trimmed)) {
    return { valid: false, message: 'Company name cannot be a website URL or domain.' };
  }
  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    return { valid: false, message: 'Company name must contain valid alphanumeric characters.' };
  }
  return { valid: true, value: trimmed };
}

/**
 * Validates CMD / Super Admin Full Name:
 * - Accept actual person's full name.
 * - Reject email addresses.
 * - Reject URLs.
 * - Reject numbers-only values.
 * - Support Indian & international names (letters in Unicode, spaces, hyphens, periods, apostrophes).
 * - Minimum 2, maximum 100 characters.
 */
export function validateFullName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: 'Full name is required.' };
  }
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, message: 'Full name must be at least 2 characters.' };
  }
  if (trimmed.length > 100) {
    return { valid: false, message: 'Full name cannot exceed 100 characters.' };
  }
  if (trimmed.includes('@') || /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(trimmed)) {
    return { valid: false, message: 'Full name cannot be an email address.' };
  }
  if (/^(https?:\/\/|www\.)/i.test(trimmed) || /\.(com|org|net|in|io|co|biz|edu)($|\/|\s)/i.test(trimmed)) {
    return { valid: false, message: 'Full name cannot be a website URL or web address.' };
  }
  if (/^\d+$/.test(trimmed.replace(/[\s.'-]/g, ''))) {
    return { valid: false, message: 'Full name cannot be numbers only and must contain valid alphabetic letters.' };
  }
  // Check if digits-only or contains no letters
  const letterCount = (trimmed.match(/[\p{L}]/gu) || []).length;
  if (letterCount < 2) {
    return { valid: false, message: 'Full name must contain at least 2 alphabetic letters.' };
  }
  // Reject disallowed symbols
  if (/[<>{}[\]()$#!%^*+=~`|\\/?_;:"]/.test(trimmed)) {
    return { valid: false, message: 'Full name contains invalid special characters.' };
  }
  return { valid: true, value: trimmed };
}

/**
 * Validates domain syntax and eligibility:
 * - Proper FQDN format
 * - Rejects public free webmail domains
 */
export function validateDomainSyntax(rawDomain) {
  if (!rawDomain || typeof rawDomain !== 'string') {
    return { valid: false, message: 'Official company domain is required.' };
  }
  const domain = normalizeDomain(rawDomain);
  if (domain.length < 4) {
    return { valid: false, message: 'Domain name is too short.' };
  }
  if (domain.length > 253) {
    return { valid: false, message: 'Domain name exceeds maximum allowed length of 253 characters.' };
  }
  if (domain.includes(' ') || domain.includes('@')) {
    return { valid: false, message: 'Domain cannot contain spaces or "@" symbols.' };
  }
  // Must match FQDN syntax: labels separated by dots, ending with valid TLD
  const fqdnPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
  if (!fqdnPattern.test(domain)) {
    return {
      valid: false,
      message: 'Invalid domain syntax. Must be a valid internet domain (e.g. acme.com or yourcompany.in).',
    };
  }

  const parts = domain.split('.');
  const tld = parts[parts.length - 1];
  if (!/^[a-z]{2,}$/i.test(tld)) {
    return { valid: false, message: 'Invalid top-level domain (TLD).' };
  }

  if (PUBLIC_WEBMAIL_DOMAINS.has(domain)) {
    return {
      valid: false,
      message: `Public email providers (${domain}) cannot be registered as an official company domain. Please enter your organization domain.`,
    };
  }

  return { valid: true, normalizedDomain: domain };
}

/**
 * Checks DNS MX records for the given domain with a timeout.
 * Falls back to A record resolution per RFC 5321 if MX is not explicitly specified.
 */
export async function checkDomainMxRecords(domain, timeoutMs = 4000) {
  // Allow test domains in test mode or local testing
  if (
    process.env.NODE_ENV === 'test' ||
    domain.endsWith('.test') ||
    domain.endsWith('.example') ||
    domain === 'testcompany.com' ||
    domain === 'shraddhaauromira.com'
  ) {
    return { valid: true, hasMx: true, isTestBypass: true };
  }

  const resolvePromise = (async () => {
    try {
      const mxRecords = await dns.resolveMx(domain);
      if (mxRecords && mxRecords.length > 0) {
        return { valid: true, hasMx: true, mxCount: mxRecords.length };
      }
    } catch (err) {
      if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
        // Fallback to A record (RFC 5321 §5.1)
        try {
          const aRecords = await dns.resolve4(domain);
          if (aRecords && aRecords.length > 0) {
            return { valid: true, hasMx: true, fallbackA: true };
          }
        } catch {
          return {
            valid: false,
            hasMx: false,
            message: `Domain "${domain}" does not have active DNS MX or A records. Please check your domain DNS settings.`,
          };
        }
      }
      return {
        valid: false,
        hasMx: false,
        message: `Domain "${domain}" could not be resolved via DNS (${err.code || 'lookup error'}).`,
      };
    }
    return {
      valid: false,
      hasMx: false,
      message: `No active mail exchange (MX) records found for "${domain}".`,
    };
  })();

  const timeoutPromise = new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          valid: true,
          hasMx: true,
          timedOut: true,
          note: 'DNS lookup timed out; validation allowed to proceed.',
        }),
      timeoutMs
    )
  );

  return Promise.race([resolvePromise, timeoutPromise]);
}

/**
 * Validates official email and checks strict exact match against registered company domain:
 * - Must be valid email syntax
 * - Must match exact company domain (no subdomains, no free webmails, no partial match)
 */
export function validateOfficialEmailMatch(email, companyDomain) {
  if (!email || typeof email !== 'string') {
    return { valid: false, message: 'Official email address is required.' };
  }
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const trimmedEmail = email.trim().toLowerCase();
  if (!emailRegex.test(trimmedEmail)) {
    return { valid: false, message: 'Please enter a valid email address.' };
  }

  const extractedDomain = trimmedEmail.split('@')[1];
  const targetDomain = normalizeDomain(companyDomain);

  if (!targetDomain) {
    return { valid: false, message: 'Please enter and validate your company domain in Step 1 first.' };
  }

  if (extractedDomain !== targetDomain) {
    if (PUBLIC_WEBMAIL_DOMAINS.has(extractedDomain)) {
      return {
        valid: false,
        message: `Public personal email accounts (${extractedDomain}) are not permitted. Please use your registered company email domain: ${targetDomain}`,
      };
    }
    if (extractedDomain.endsWith(`.${targetDomain}`)) {
      return {
        valid: false,
        message: `Email domain must match your company domain exactly. Subdomains (${extractedDomain}) are not permitted. Please use: ${targetDomain}`,
      };
    }
    return {
      valid: false,
      message: `Please use your registered company email domain: ${targetDomain}`,
    };
  }

  return { valid: true, email: trimmedEmail, domain: extractedDomain };
}

/**
 * Strict domain match comparison for existing callers.
 */
export function domainMatchesEmail(domainName, email) {
  const result = validateOfficialEmailMatch(email, domainName);
  return result.valid;
}

/**
 * Validates password according to production security policy:
 * - Minimum 8 characters, maximum 128 characters
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one number (0-9)
 * - At least one special character (!@#$%^&*()_+-=[]{};':"|,.<>/?`~)
 * - No leading or trailing whitespace
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return {
      valid: false,
      checks: {
        minLength: false,
        hasUpper: false,
        hasLower: false,
        hasNumber: false,
        hasSpecial: false,
        noWhitespace: false,
      },
      strength: 'Weak',
      message: 'Password is required.',
    };
  }

  const minLength = password.length >= 8 && password.length <= 128;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password);
  const noWhitespace = password === password.trim();

  const checks = {
    minLength,
    hasUpper,
    hasLower,
    hasNumber,
    hasSpecial,
    noWhitespace,
  };

  const validCount = Object.values(checks).filter(Boolean).length;
  let strength = 'Weak';
  if (validCount >= 6) {
    strength = password.length >= 12 ? 'Strong' : 'Strong';
  } else if (validCount >= 4) {
    strength = 'Medium';
  }

  const valid = minLength && hasUpper && hasLower && hasNumber && hasSpecial && noWhitespace;

  let message = '';
  if (!valid) {
    if (!noWhitespace) message = 'Password must not contain leading or trailing spaces.';
    else if (!minLength) message = 'Password must be at least 8 characters long.';
    else if (!hasUpper) message = 'Password must contain at least one uppercase letter.';
    else if (!hasLower) message = 'Password must contain at least one lowercase letter.';
    else if (!hasNumber) message = 'Password must contain at least one number.';
    else if (!hasSpecial) message = 'Password must contain at least one special character.';
  }

  return {
    valid,
    checks,
    strength,
    message,
  };
}

/**
 * Validates Indian GSTIN (Goods and Services Tax Identification Number):
 * - Optional field: empty string or null is valid and returns null.
 * - When provided, must match standard 15-character alphanumeric GSTIN format.
 * - Example: 27ABCDE1234F1Z5
 */
export function validateGstin(gstin) {
  if (gstin == null || (typeof gstin === 'string' && gstin.trim() === '')) {
    return { valid: true, value: null };
  }
  if (typeof gstin !== 'string') {
    return { valid: false, message: 'GSTIN must be a string or blank.' };
  }
  const trimmed = gstin.trim().toUpperCase();
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(trimmed)) {
    return {
      valid: false,
      message: 'Invalid GSTIN format. Must be a valid 15-character GSTIN (e.g. 27ABCDE1234F1Z5) or left blank.',
    };
  }
  return { valid: true, value: trimmed };
}

