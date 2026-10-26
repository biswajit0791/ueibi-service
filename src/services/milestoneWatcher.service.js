import { prisma } from '../lib/prisma.js';

export function defaultManagerWatcherEmail(manager) {
  if (!manager?.email
    || String(manager.role || '').toUpperCase() === 'CMD'
    || (manager.status && manager.status !== 'ACTIVE')
    || manager.isDeleted) return null;
  return manager.email.trim().toLowerCase();
}

export async function defaultMilestoneWatcherEmails(tenantId, taskOwnerId) {
  if (!tenantId || !taskOwnerId) return [];
  const owner = await prisma.tenantUser.findFirst({
    where: { id: taskOwnerId, tenantId, isDeleted: false },
    select: { managerId: true },
  });
  if (!owner?.managerId) return [];

  const manager = await prisma.tenantUser.findFirst({
    where: {
      id: owner.managerId,
      tenantId,
      isDeleted: false,
      status: 'ACTIVE',
    },
    select: { email: true, role: true, status: true, isDeleted: true },
  });
  const email = defaultManagerWatcherEmail(manager);
  return email ? [email] : [];
}

export async function withDefaultMilestoneWatcher(tenantId, taskOwnerId, watcherEmails = []) {
  const emails = [...new Set((watcherEmails || [])
    .map((email) => String(email || '').trim().toLowerCase())
    .filter(Boolean))];
  return emails.length > 0 ? emails : defaultMilestoneWatcherEmails(tenantId, taskOwnerId);
}
