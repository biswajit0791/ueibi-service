-- Sub-logins / Invite Recruiter.
--
-- "Recruiter" and "Viewer" are NOT UserRole values, and a recruiter must be able
-- to search the registry WITHOUT being made an admin. So the granular
-- credentials on the invite modal are capabilities layered on top of the normal
-- role, reusing the mechanism already built for LEADERSHIP.
--
-- Purely additive: no existing row changes, and every role that can reach the
-- registry today still can.

ALTER TYPE "Capability" ADD VALUE IF NOT EXISTS 'REGISTRY_SEARCH';
ALTER TYPE "Capability" ADD VALUE IF NOT EXISTS 'REGISTRY_WRITE';
ALTER TYPE "Capability" ADD VALUE IF NOT EXISTS 'REGISTRY_ANALYTICS';
ALTER TYPE "Capability" ADD VALUE IF NOT EXISTS 'REGISTRY_EXPORT';
