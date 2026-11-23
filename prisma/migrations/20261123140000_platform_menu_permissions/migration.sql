-- CreateTable
CREATE TABLE IF NOT EXISTS "platform_menu_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "menuKey" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_menu_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "platform_menu_permissions_userId_idx" ON "platform_menu_permissions"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "platform_menu_permissions_menuKey_idx" ON "platform_menu_permissions"("menuKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "platform_menu_permissions_userId_menuKey_key" ON "platform_menu_permissions"("userId", "menuKey");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'platform_menu_permissions_userId_fkey'
    ) THEN
        ALTER TABLE "platform_menu_permissions" ADD CONSTRAINT "platform_menu_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
