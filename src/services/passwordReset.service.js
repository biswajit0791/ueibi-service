import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { generateRawToken, hashToken } from '../lib/tokens.js';
import { env } from '../config/env.js';

/**
 * Issues a single-use password reset token for `userId`, invalidating any
 * earlier unused ones, and returns the link to send. Used by Forgot Password
 * and by invitations (a new account sets its first password through the same
 * one-time link).
 *
 * @param {string} userId
 * @param {{ expiresMinutes?: number }} [opts]
 * @returns {Promise<{ resetUrl: string, expiresMinutes: number }>}
 */
export async function issuePasswordResetLink(userId, { expiresMinutes } = {}) {
  const minutes = expiresMinutes || env.passwordResetTokenExpiresMinutes || 30;
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  const tokenId = `prt_${crypto.randomBytes(12).toString('hex')}`;

  // Atomically invalidate old tokens for this user and store the new token hash.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE "password_reset_tokens"
       SET "usedAt" = CURRENT_TIMESTAMP
       WHERE "userId" = $1 AND "usedAt" IS NULL`,
      userId
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "password_reset_tokens" ("id", "userId", "tokenHash", "expiresAt", "usedAt", "createdAt")
       VALUES ($1, $2, $3, $4, NULL, CURRENT_TIMESTAMP)`,
      tokenId,
      userId,
      tokenHash,
      expiresAt
    );
  });

  return { resetUrl: `${env.frontendOrigin}/reset-password?token=${rawToken}`, expiresMinutes: minutes };
}
