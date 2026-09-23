-- Tenant Management: lifecycle states, registration verification, last login.
-- Additive only. No existing column is altered or dropped.

-- 1. Two more lifecycle states. GRACE_PERIOD sits between a lapsed TRIAL and
--    EXPIRED; CANCELLED is a deliberate end, distinct from a lapse.
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'GRACE_PERIOD';
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- 2. "Last login" for global user management. Nullable: every existing user
--    has never been stamped, and null reads honestly as "never recorded"
--    rather than pretending they last signed in at migration time.
ALTER TABLE "tenant_users" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

-- 3. Company verification review.
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- One row per decision rather than a status column on the registration, so the
-- history is inherent: a decision can never be silently overwritten, and the
-- newest row is the current status.
CREATE TABLE "registration_verifications" (
    "id"             TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "status"         "VerificationStatus" NOT NULL,
    "notes"          TEXT,
    "reviewerId"     TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "registration_verifications_registrationId_createdAt_idx"
    ON "registration_verifications"("registrationId", "createdAt");

ALTER TABLE "registration_verifications" ADD CONSTRAINT "registration_verifications_registrationId_fkey"
    FOREIGN KEY ("registrationId") REFERENCES "company_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- reviewerId is deliberately NOT a foreign key: a verification decision must
-- survive the reviewer's account being removed, or the record can be erased by
-- deleting a user.
