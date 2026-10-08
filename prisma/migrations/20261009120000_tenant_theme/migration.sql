-- Company appearance settings. Additive; null keeps the default look.
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "theme" JSONB;
