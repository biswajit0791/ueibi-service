-- =============================================================================
-- CLEAR ALL DUMMY DATA FROM UEIBI DATABASE (CASCADE TRUNCATE)
-- =============================================================================
-- This query clears all dummy tenants, users, goals, tasks, policies,
-- leaves, appraisals, and company registrations while preserving database
-- schema and Prisma migration history.
-- =============================================================================

TRUNCATE TABLE
  "gallery_comments",
  "gallery_likes",
  "gallery_posts",
  "password_reset_tokens",
  "hub_events",
  "policy_audit_logs",
  "policy_acceptances",
  "policy_assignments",
  "policies",
  "non_joiner_records",
  "ex_employee_records",
  "ex_employer_reviews",
  "peer_feedbacks",
  "peer_nominations",
  "review_scores",
  "performance_reviews",
  "appraisal_parameters",
  "appraisal_cycles",
  "leave_balance_adjustments",
  "leave_audit_logs",
  "wfh_balances",
  "wfh_policies",
  "leave_balances",
  "leave_requests",
  "leave_types",
  "notifications",
  "notification_logs",
  "goal_audit_logs",
  "goal_comments",
  "task_audit_logs",
  "task_comments",
  "tasks",
  "goal_assignments",
  "goals",
  "coupons",
  "registration_action_tokens",
  "email_verifications",
  "exit_details",
  "work_histories",
  "bank_details",
  "departments",
  "tenant_users",
  "tenants",
  "company_registrations"
CASCADE;

-- Optional: Verify that tables are empty
SELECT 'tenants' AS table_name, count(*) AS remaining_rows FROM "tenants"
UNION ALL
SELECT 'tenant_users', count(*) FROM "tenant_users"
UNION ALL
SELECT 'company_registrations', count(*) FROM "company_registrations";
