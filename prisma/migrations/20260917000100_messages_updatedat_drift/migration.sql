-- Prisma manages @updatedAt from the client, so the column should carry no
-- database-side default. Dropping it keeps `prisma migrate diff` clean.
ALTER TABLE "messages" ALTER COLUMN "updatedAt" DROP DEFAULT;
