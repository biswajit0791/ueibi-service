-- =============================================================================
-- COMPLETELY REMOVE "usifdn.org" TENANT, USERS, & REGISTRATION
-- =============================================================================
-- This script safely and cleanly removes ONLY "usifdn.org" and its related
-- data without affecting any other companies in the database.
-- =============================================================================

DO $$
DECLARE
  v_tenant_id TEXT;
  v_reg_id TEXT;
BEGIN
  -- 1. Find tenant id
  SELECT id INTO v_tenant_id FROM "tenants" 
  WHERE lower("domainName") = 'usifdn.org' OR lower("tenantCode") = 'usi' 
  LIMIT 1;

  -- 2. Find registration id
  SELECT id INTO v_reg_id FROM "company_registrations" 
  WHERE lower("domainName") = 'usifdn.org' OR lower("tenantCode") = 'usi' OR lower("email") LIKE '%@usifdn.org' 
  LIMIT 1;

  -- 3. Delete tenant-scoped data if tenant exists
  IF v_tenant_id IS NOT NULL THEN
    DELETE FROM "gallery_comments" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "gallery_likes" WHERE "postId" IN (SELECT id FROM "gallery_posts" WHERE "tenantId" = v_tenant_id);
    DELETE FROM "gallery_posts" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "hub_events" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "policy_audit_logs" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "policy_acceptances" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "policy_assignments" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "policies" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "non_joiner_records" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "ex_employer_reviews" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "ex_employee_records" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "peer_feedbacks" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "peer_nominations" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "review_scores" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "performance_reviews" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "appraisal_parameters" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "appraisal_cycles" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "leave_balance_adjustments" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "leave_audit_logs" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "wfh_balances" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "wfh_policies" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "leave_balances" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "leave_requests" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "leave_types" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "notifications" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "goal_audit_logs" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "goal_comments" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "task_audit_logs" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "task_comments" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "tasks" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "goal_assignments" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "goals" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "departments" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "exit_details" WHERE "userId" IN (SELECT id FROM "tenant_users" WHERE "tenantId" = v_tenant_id);
    DELETE FROM "work_histories" WHERE "userId" IN (SELECT id FROM "tenant_users" WHERE "tenantId" = v_tenant_id);
    DELETE FROM "bank_details" WHERE "userId" IN (SELECT id FROM "tenant_users" WHERE "tenantId" = v_tenant_id);
    DELETE FROM "password_reset_tokens" WHERE "userId" IN (SELECT id FROM "tenant_users" WHERE "tenantId" = v_tenant_id);
    DELETE FROM "tenant_users" WHERE "tenantId" = v_tenant_id;
    DELETE FROM "tenants" WHERE "id" = v_tenant_id;
  END IF;

  -- 4. Delete any remaining users with domain @usifdn.org
  DELETE FROM "tenant_users" WHERE lower("email") LIKE '%@usifdn.org';

  -- 5. Delete registration and tokens
  IF v_reg_id IS NOT NULL THEN
    DELETE FROM "registration_action_tokens" WHERE "registrationId" = v_reg_id;
    DELETE FROM "company_registrations" WHERE "id" = v_reg_id;
  END IF;

  DELETE FROM "company_registrations" 
  WHERE lower("domainName") = 'usifdn.org' OR lower("email") LIKE '%@usifdn.org';

  RAISE NOTICE 'Finished cleaning usifdn.org. Database is ready for clean manual entry.';
END $$;
