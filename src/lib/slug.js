import crypto from 'node:crypto';

export function slugify(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function generateTenantCode(companyName) {
  const base = slugify(companyName) || 'company';
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${base}-${suffix}`;
}
