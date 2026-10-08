/**
 * companySettings.service.js
 *
 * The one place that reads/writes TenantSettings — the "Company Settings"
 * page's backing row. Lazily created on first read, one row per tenant, same
 * pattern as an appraisal cycle (ensureActiveCycle) or a WfhPolicy.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export async function getCompanySettings(tenantId) {
  const existing = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  if (existing) return existing;

  // Two requests racing to create the first row both pass the check above;
  // whichever loses the unique constraint just re-reads what the other wrote.
  try {
    return await prisma.tenantSettings.create({ data: { tenantId } });
  } catch (err) {
    if (err.code === 'P2002') {
      return prisma.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
    }
    throw err;
  }
}

export async function updateCompanySettings(tenantId, { milestoneWatcherDomains, milestoneRequireApproval, theme }) {
  await getCompanySettings(tenantId); // ensure the row exists before updating it
  return prisma.tenantSettings.update({
    where: { tenantId },
    data: {
      ...(milestoneWatcherDomains !== undefined && { milestoneWatcherDomains }),
      ...(milestoneRequireApproval !== undefined && { milestoneRequireApproval }),
      // Prisma needs DbNull (not JS null) to store SQL NULL in a Json column.
      ...(theme !== undefined && { theme: theme === null ? Prisma.DbNull : theme }),
    },
  });
}

/** Normalises a domain the way it's stored: lowercase, no leading '@', no
 *  leading/trailing dot or whitespace. */
export function normaliseDomain(raw) {
  return String(raw || '').trim().toLowerCase().replace(/^@/, '').replace(/^\.+|\.+$/g, '');
}

/**
 * True when `emailDomain` equals one of `allowedDomains`, or is a sub-domain
 * of one of them (e.g. allowed "client.com" matches "eu.client.com" but not
 * "notclient.com").
 */
export function domainIsAllowed(emailDomain, allowedDomains) {
  const d = normaliseDomain(emailDomain);
  if (!d) return false;
  return allowedDomains.some((allowed) => {
    const a = normaliseDomain(allowed);
    if (!a) return false;
    return d === a || d.endsWith(`.${a}`);
  });
}

/**
 * Validates a list of watcher emails against the tenant's allowed domains:
 * its own registered domain, plus whatever is configured in Company Settings.
 * @returns {string[]} the emails that are NOT allowed (empty = all valid)
 */
export async function findDisallowedWatcherEmails(tenantId, emails) {
  if (!emails || emails.length === 0) return [];

  const [tenant, settings] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { domainName: true } }),
    getCompanySettings(tenantId),
  ]);

  const allowedDomains = [tenant?.domainName, ...(settings.milestoneWatcherDomains || [])].filter(Boolean);

  return emails.filter((email) => {
    const domain = String(email).split('@')[1];
    return !domainIsAllowed(domain, allowedDomains);
  });
}
