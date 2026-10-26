ALTER TABLE "tenant_settings"
  ADD COLUMN "milestoneAlertEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "milestoneAlertDaysBefore" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "milestoneAlertFrequencyDays" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "milestoneAlertOnlyNoProgress" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "milestoneAlertSubject" TEXT NOT NULL DEFAULT 'Milestone reminder: {{milestoneTitle}} due {{dueDate}}',
  ADD COLUMN "milestoneAlertBody" TEXT NOT NULL DEFAULT 'Milestone "{{milestoneTitle}}" on task "{{taskTitle}}" is due {{dueDate}} and is still at {{progress}}% progress.';
