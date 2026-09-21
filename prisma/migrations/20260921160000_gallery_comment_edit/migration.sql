-- Editable gallery comments.
--
-- `editedAt` is nullable rather than a @updatedAt column on purpose: a comment
-- that has never been edited must be distinguishable from one that has, so the
-- UI can show an "(edited)" marker without guessing from timestamps.
ALTER TABLE "gallery_comments" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
