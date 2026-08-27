export function normalizeDomain(input) {
  if (!input) return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export function emailDomain(email) {
  if (!email || !email.includes('@')) return '';
  return email.trim().toLowerCase().split('@')[1] || '';
}

export function domainMatchesEmail(domainName, email) {
  return normalizeDomain(domainName) === emailDomain(email);
}
