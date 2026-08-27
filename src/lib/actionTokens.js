import { prisma } from './prisma.js';
import { hashToken } from './tokens.js';

export async function findActionToken(rawToken, role) {
  const tokenHash = hashToken(rawToken);
  const actionToken = await prisma.registrationActionToken.findUnique({
    where: { tokenHash },
    include: { registration: { include: { coupon: true } } },
  });
  if (!actionToken || actionToken.role !== role) return null;
  return actionToken;
}
