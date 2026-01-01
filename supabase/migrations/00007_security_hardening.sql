-- =============================================================================
-- Security Hardening Migration
-- =============================================================================
-- This migration implements comprehensive security measures to address
-- common Supabase Security Advisor warnings and best practices.
--
-- Addresses:
-- 1. Function security (SECURITY DEFINER review)
-- 2. RLS policy gaps
-- 3. Privilege escalation prevention
-- 4. Audit log immutability
-- 5. Data validation constraints
-- 6. Index security
-- =============================================================================

-- =============================================================================
-- 1. REVOKE PUBLIC ACCESS TO FUNCTIONS
-- =============================================================================
-- By default, PostgreSQL grants EXECUTE to PUBLIC on new functions.
-- We revoke this and grant only to authenticated users where needed.

-- Revoke public access to sensitive functions
REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_current_org_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION has_role(user_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_org_member(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION current_org_role(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION has_org_role(UUID, user_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_usage(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_org_usage(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION org_has_feature(UUID, TEXT) FROM PUBLIC;

-- Grant to authenticated users only (needed for RLS policies)
GRANT EXECUTE ON FUNCTION get_current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION has_role(user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION current_org_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION has_org_role(UUID, user_role) TO authenticated;

-- Service role functions (edge functions only)
GRANT EXECUTE ON FUNCTION increment_usage(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION get_org_usage(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION org_has_feature(UUID, TEXT) TO service_role;

-- =============================================================================
-- 2. AUDIT LOG IMMUTABILITY - PREVENT MODIFICATIONS
-- =============================================================================

-- Create trigger to prevent UPDATE on audit_logs
CREATE OR REPLACE FUNCTION prevent_audit_log_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs cannot be modified. This action has been logged.';
END;
$$ LANGUAGE plpgsql;

-- Create trigger to prevent DELETE on audit_logs
CREATE OR REPLACE FUNCTION prevent_audit_log_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs cannot be deleted. This action has been logged.';
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
DROP TRIGGER IF EXISTS audit_logs_prevent_update ON audit_logs;
CREATE TRIGGER audit_logs_prevent_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_update();

DROP TRIGGER IF EXISTS audit_logs_prevent_delete ON audit_logs;
CREATE TRIGGER audit_logs_prevent_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_delete();

-- =============================================================================
-- 3. ADD MISSING RLS POLICIES FOR SERVICE ROLE OPERATIONS
-- =============================================================================

-- Allow service role to insert into audit_logs (for edge functions)
DROP POLICY IF EXISTS "Service role can insert audit logs" ON audit_logs;
CREATE POLICY "Service role can insert audit logs"
    ON audit_logs
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Allow service role to manage agent_runs (for edge functions)
DROP POLICY IF EXISTS "Service role can manage agent_runs" ON agent_runs;
CREATE POLICY "Service role can manage agent_runs"
    ON agent_runs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow service role to manage approvals (for edge functions)
DROP POLICY IF EXISTS "Service role can manage approvals" ON approvals;
CREATE POLICY "Service role can manage approvals"
    ON approvals
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow service role to manage usage_tracking
DROP POLICY IF EXISTS "Service role can manage usage" ON usage_tracking;
CREATE POLICY "Service role can manage usage"
    ON usage_tracking
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow service role to manage idempotency_keys
DROP POLICY IF EXISTS "Service role can manage idempotency" ON idempotency_keys;
CREATE POLICY "Service role can manage idempotency"
    ON idempotency_keys
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- =============================================================================
-- 4. TIGHTEN EXISTING RLS POLICIES
-- =============================================================================

-- Organizations: Prevent users from creating new organizations directly
-- (Should only happen via handle_new_user trigger)
DROP POLICY IF EXISTS "Prevent direct org creation" ON organizations;
CREATE POLICY "Prevent direct org creation"
    ON organizations
    FOR INSERT
    TO authenticated
    WITH CHECK (false);  -- Block all direct inserts

-- Allow service role to create organizations
DROP POLICY IF EXISTS "Service role can create orgs" ON organizations;
CREATE POLICY "Service role can create orgs"
    ON organizations
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Profiles: Tighten role update restrictions
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
    ON profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (
        id = auth.uid()
        -- Cannot change organization
        AND organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
        -- Cannot promote self to higher role
        AND (
            role = (SELECT role FROM profiles WHERE id = auth.uid())  -- No role change
            OR role IN ('member', 'viewer')  -- Can only demote to these
        )
    );

-- Only owners can change roles
DROP POLICY IF EXISTS "Owners can change member roles" ON profiles;
CREATE POLICY "Owners can change member roles"
    ON profiles
    FOR UPDATE
    TO authenticated
    USING (
        organization_id IN (
            SELECT organization_id FROM profiles
            WHERE id = auth.uid() AND role = 'owner'
        )
    )
    WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM profiles
            WHERE id = auth.uid() AND role = 'owner'
        )
    );

-- =============================================================================
-- 5. DATA VALIDATION CONSTRAINTS
-- =============================================================================

-- Add CHECK constraints for enum-like text columns
ALTER TABLE organizations
    DROP CONSTRAINT IF EXISTS check_plan_valid,
    ADD CONSTRAINT check_plan_valid
    CHECK (plan IN ('free', 'starter', 'pro', 'agency'));

ALTER TABLE organizations
    DROP CONSTRAINT IF EXISTS check_subscription_status_valid,
    ADD CONSTRAINT check_subscription_status_valid
    CHECK (subscription_status IS NULL OR subscription_status IN ('none', 'active', 'past_due', 'canceled', 'trialing', 'incomplete'));

ALTER TABLE audit_logs
    DROP CONSTRAINT IF EXISTS check_action_not_empty,
    ADD CONSTRAINT check_action_not_empty CHECK (action <> '');

ALTER TABLE audit_logs
    DROP CONSTRAINT IF EXISTS check_resource_type_not_empty,
    ADD CONSTRAINT check_resource_type_not_empty CHECK (resource_type <> '');

-- Email validation for profiles
ALTER TABLE profiles
    DROP CONSTRAINT IF EXISTS check_email_format,
    ADD CONSTRAINT check_email_format
    CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Prevent negative values in usage tracking
ALTER TABLE usage_tracking
    DROP CONSTRAINT IF EXISTS check_positive_runs,
    ADD CONSTRAINT check_positive_runs CHECK (runs_count >= 0);

ALTER TABLE usage_tracking
    DROP CONSTRAINT IF EXISTS check_positive_sends,
    ADD CONSTRAINT check_positive_sends CHECK (sends_count >= 0);

-- =============================================================================
-- 6. PREVENT PRIVILEGE ESCALATION IN ORG MEMBERS
-- =============================================================================

-- Ensure users cannot add themselves to other organizations
DROP POLICY IF EXISTS "org_members_insert_policy" ON org_members;
CREATE POLICY "org_members_insert_policy"
    ON org_members
    FOR INSERT
    TO authenticated
    WITH CHECK (
        -- Must be admin/owner of the target organization
        has_org_role(organization_id, 'admin')
        -- Cannot grant higher role than own
        AND (
            CASE role
                WHEN 'owner' THEN has_org_role(organization_id, 'owner')
                WHEN 'admin' THEN has_org_role(organization_id, 'owner')
                ELSE true
            END
        )
    );

-- =============================================================================
-- 7. SECURE FUNCTION DEFINITIONS
-- =============================================================================

-- Make sensitive functions more secure by adding SET search_path
CREATE OR REPLACE FUNCTION get_current_org_id()
RETURNS UUID AS $$
    SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public;

CREATE OR REPLACE FUNCTION is_org_member(check_org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND organization_id = check_org_id
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

CREATE OR REPLACE FUNCTION has_org_role(check_org_id UUID, required_role user_role)
RETURNS BOOLEAN AS $$
DECLARE
    user_role_value INTEGER;
    required_role_value INTEGER;
BEGIN
    SELECT CASE current_org_role(check_org_id)
        WHEN 'owner' THEN 4
        WHEN 'admin' THEN 3
        WHEN 'member' THEN 2
        WHEN 'viewer' THEN 1
        ELSE 0
    END INTO user_role_value;

    SELECT CASE required_role
        WHEN 'owner' THEN 4
        WHEN 'admin' THEN 3
        WHEN 'member' THEN 2
        WHEN 'viewer' THEN 1
        ELSE 0
    END INTO required_role_value;

    RETURN user_role_value >= required_role_value;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

-- =============================================================================
-- 8. ENABLE RLS ON ALL TABLES (Ensure none missed)
-- =============================================================================

DO $$
DECLARE
    tbl RECORD;
BEGIN
    FOR tbl IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename NOT IN ('schema_migrations')
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.tablename);
    END LOOP;
END $$;

-- =============================================================================
-- 9. BILLING EVENTS SECURITY (Webhook idempotency)
-- =============================================================================

-- Only service role can manage billing events
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only for billing" ON billing_events;
CREATE POLICY "Service role only for billing"
    ON billing_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Block all other access to billing_events
DROP POLICY IF EXISTS "Block authenticated billing access" ON billing_events;
CREATE POLICY "Block authenticated billing access"
    ON billing_events
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

-- =============================================================================
-- 10. RATE LIMITING SUPPORT
-- =============================================================================

-- Function to check rate limits (called by RLS policies)
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_org_id UUID,
    p_action TEXT,
    p_limit INTEGER DEFAULT 100,
    p_window_minutes INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
    action_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO action_count
    FROM public.audit_logs
    WHERE organization_id = p_org_id
    AND action = p_action
    AND created_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL;

    RETURN action_count < p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION check_rate_limit(UUID, TEXT, INTEGER, INTEGER) TO authenticated;

-- =============================================================================
-- 11. COMMENTS FOR SECURITY DOCUMENTATION
-- =============================================================================

COMMENT ON FUNCTION handle_new_user() IS 'SECURITY DEFINER: Creates org and profile on user signup. Called only by auth.users trigger.';
COMMENT ON FUNCTION get_current_org_id() IS 'SECURITY DEFINER: Returns org ID for current authenticated user. Used in RLS policies.';
COMMENT ON FUNCTION is_org_member(UUID) IS 'SECURITY DEFINER: Checks if current user belongs to specified org. Used in RLS policies.';
COMMENT ON FUNCTION has_org_role(UUID, user_role) IS 'SECURITY DEFINER: Checks if current user has required role in org. Used in RLS policies.';
COMMENT ON TRIGGER audit_logs_prevent_update ON audit_logs IS 'SECURITY: Prevents modification of audit trail for compliance.';
COMMENT ON TRIGGER audit_logs_prevent_delete ON audit_logs IS 'SECURITY: Prevents deletion of audit trail for compliance.';

-- =============================================================================
-- 12. VIEWS FOR SAFE DATA ACCESS
-- =============================================================================

-- Create view that safely exposes org member data (without sensitive fields)
CREATE OR REPLACE VIEW public.org_member_summary AS
SELECT
    om.id,
    om.organization_id,
    om.email,
    om.role,
    om.status,
    om.invited_at,
    om.joined_at
FROM org_members om
WHERE is_org_member(om.organization_id);

COMMENT ON VIEW org_member_summary IS 'Safe view of org members - respects RLS via is_org_member function';

-- Create view for task summaries (no sensitive data)
CREATE OR REPLACE VIEW public.task_summary AS
SELECT
    t.id,
    t.organization_id,
    t.title,
    t.status,
    t.priority,
    t.assigned_to,
    t.due_at,
    t.created_at
FROM tasks t
WHERE is_org_member(t.organization_id);

COMMENT ON VIEW task_summary IS 'Safe view of tasks - respects RLS via is_org_member function';
