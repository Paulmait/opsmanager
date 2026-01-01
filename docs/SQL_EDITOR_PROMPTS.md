# SQL Editor Prompts for Supabase

Copy-paste these SQL statements into Supabase SQL Editor in order.

---

## Migration 1: Core Schema

```sql
-- =============================================================================
-- Ops Manager Initial Schema
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ENUM: User roles
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member');

-- TABLE: Organizations
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their organization"
    ON organizations FOR SELECT
    USING (id IN (SELECT organization_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Owners can update organization"
    ON organizations FOR UPDATE
    USING (id IN (SELECT organization_id FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'owner'));

-- TABLE: Profiles
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    role user_role NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org profiles"
    ON profiles FOR SELECT
    USING (organization_id IN (SELECT organization_id FROM profiles AS p WHERE p.id = auth.uid()));

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid() AND organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Service role can insert profiles"
    ON profiles FOR INSERT
    WITH CHECK (true);

-- TABLE: Audit Logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org audit logs"
    ON audit_logs FOR SELECT
    USING (organization_id IN (SELECT organization_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Admins can insert audit logs"
    ON audit_logs FOR INSERT
    WITH CHECK (organization_id IN (SELECT organization_id FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('owner', 'admin')));

-- Indexes
CREATE INDEX idx_profiles_organization_id ON profiles(organization_id);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_audit_logs_organization_id ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Handle New User Signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_org_id UUID;
BEGIN
    INSERT INTO organizations (name)
    VALUES (COALESCE(NEW.raw_user_meta_data->>'company', NEW.email || '''s Organization'))
    RETURNING id INTO new_org_id;

    INSERT INTO profiles (id, organization_id, email, full_name, role)
    VALUES (
        NEW.id,
        new_org_id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NULL),
        'owner'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Helper Functions
CREATE OR REPLACE FUNCTION get_current_org_id()
RETURNS UUID AS $$
    SELECT organization_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_role(required_role user_role)
RETURNS BOOLEAN AS $$
DECLARE
    user_role_value INTEGER;
    required_role_value INTEGER;
BEGIN
    SELECT CASE role
        WHEN 'owner' THEN 3
        WHEN 'admin' THEN 2
        WHEN 'member' THEN 1
        ELSE 0
    END INTO user_role_value
    FROM profiles
    WHERE id = auth.uid();

    SELECT CASE required_role
        WHEN 'owner' THEN 3
        WHEN 'admin' THEN 2
        WHEN 'member' THEN 1
        ELSE 0
    END INTO required_role_value;

    RETURN user_role_value >= required_role_value;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

---

## Migration 2: Extended Schema

```sql
-- =============================================================================
-- Extended Schema - Contacts, Tasks, Approvals, Agent Runs
-- =============================================================================

-- ENUM Types
CREATE TYPE membership_status AS ENUM ('pending', 'active', 'suspended', 'removed');
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'waiting_approval', 'completed', 'failed', 'cancelled');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE agent_run_status AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE integration_provider AS ENUM ('google_workspace', 'microsoft_365', 'slack', 'quickbooks', 'stripe', 'hubspot', 'custom_webhook');
CREATE TYPE integration_status AS ENUM ('pending_auth', 'active', 'expired', 'revoked', 'error');

-- Add viewer to user_role
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'viewer' AND enumtypid = 'user_role'::regtype) THEN
        ALTER TYPE user_role ADD VALUE 'viewer';
    END IF;
END $$;

-- Helper Functions
CREATE OR REPLACE FUNCTION is_org_member(check_org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
        AND organization_id = check_org_id
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_org_role(check_org_id UUID)
RETURNS user_role AS $$
DECLARE
    user_role_result user_role;
BEGIN
    SELECT role INTO user_role_result
    FROM profiles
    WHERE id = auth.uid()
    AND organization_id = check_org_id;
    RETURN user_role_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- TABLE: Org Members
CREATE TABLE org_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'member',
    status membership_status NOT NULL DEFAULT 'pending',
    invited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    joined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_org_email UNIQUE (organization_id, email)
);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_org_members_org_id ON org_members(organization_id);
CREATE INDEX idx_org_members_user_id ON org_members(user_id);
CREATE INDEX idx_org_members_email ON org_members(email);
CREATE INDEX idx_org_members_status ON org_members(status);

CREATE TRIGGER org_members_updated_at
    BEFORE UPDATE ON org_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE POLICY "org_members_select_policy" ON org_members FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "org_members_insert_policy" ON org_members FOR INSERT WITH CHECK (has_org_role(organization_id, 'admin'));
CREATE POLICY "org_members_update_policy" ON org_members FOR UPDATE
    USING (has_org_role(organization_id, 'admin'))
    WITH CHECK (has_org_role(organization_id, 'admin') AND (
        CASE role WHEN 'owner' THEN has_org_role(organization_id, 'owner') WHEN 'admin' THEN has_org_role(organization_id, 'owner') ELSE true END
    ));
CREATE POLICY "org_members_delete_policy" ON org_members FOR DELETE USING (has_org_role(organization_id, 'owner'));

-- TABLE: Contacts
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    company TEXT,
    job_title TEXT,
    phone TEXT,
    tags TEXT[] DEFAULT '{}',
    source TEXT,
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
    last_contacted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_contacts_org_id ON contacts(organization_id);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_assigned_to ON contacts(assigned_to);
CREATE INDEX idx_contacts_tags ON contacts USING GIN(tags);
CREATE INDEX idx_contacts_created_at ON contacts(created_at DESC);

CREATE TRIGGER contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE POLICY "contacts_select_policy" ON contacts FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "contacts_insert_policy" ON contacts FOR INSERT WITH CHECK (has_org_role(organization_id, 'member') AND organization_id = get_current_org_id());
CREATE POLICY "contacts_update_policy" ON contacts FOR UPDATE USING (has_org_role(organization_id, 'member'));
CREATE POLICY "contacts_delete_policy" ON contacts FOR DELETE USING (has_org_role(organization_id, 'admin'));

-- TABLE: Tasks
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status task_status NOT NULL DEFAULT 'pending',
    priority task_priority NOT NULL DEFAULT 'medium',
    parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
    due_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    agent_run_id UUID,
    requires_approval BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tasks_org_id ON tasks(organization_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_due_at ON tasks(due_at);
CREATE INDEX idx_tasks_parent_id ON tasks(parent_task_id);
CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);

CREATE TRIGGER tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE POLICY "tasks_select_policy" ON tasks FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "tasks_insert_policy" ON tasks FOR INSERT WITH CHECK (has_org_role(organization_id, 'member') AND organization_id = get_current_org_id());
CREATE POLICY "tasks_update_policy" ON tasks FOR UPDATE USING (has_org_role(organization_id, 'member') AND (created_by = auth.uid() OR assigned_to = auth.uid() OR has_org_role(organization_id, 'admin')));
CREATE POLICY "tasks_delete_policy" ON tasks FOR DELETE USING (has_org_role(organization_id, 'admin'));

-- TABLE: Agent Runs
CREATE TABLE agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL,
    status agent_run_status NOT NULL DEFAULT 'queued',
    input_data JSONB NOT NULL DEFAULT '{}',
    output_data JSONB,
    error_message TEXT,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    triggered_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    requires_approval BOOLEAN NOT NULL DEFAULT true,
    approval_id UUID,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    tokens_used INTEGER,
    cost_cents INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_agent_runs_org_id ON agent_runs(organization_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_agent_runs_agent_type ON agent_runs(agent_type);
CREATE INDEX idx_agent_runs_task_id ON agent_runs(task_id);
CREATE INDEX idx_agent_runs_triggered_by ON agent_runs(triggered_by);
CREATE INDEX idx_agent_runs_created_at ON agent_runs(created_at DESC);

CREATE TRIGGER agent_runs_updated_at
    BEFORE UPDATE ON agent_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE POLICY "agent_runs_select_policy" ON agent_runs FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "agent_runs_insert_policy" ON agent_runs FOR INSERT WITH CHECK (has_org_role(organization_id, 'member') AND organization_id = get_current_org_id());
CREATE POLICY "agent_runs_update_policy" ON agent_runs FOR UPDATE USING (has_org_role(organization_id, 'member') AND (triggered_by = auth.uid() OR has_org_role(organization_id, 'admin')));
CREATE POLICY "agent_runs_delete_policy" ON agent_runs FOR DELETE USING (has_org_role(organization_id, 'owner'));

ALTER TABLE tasks ADD CONSTRAINT tasks_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;

-- TABLE: Approvals
CREATE TABLE approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    action_summary TEXT NOT NULL,
    action_details JSONB NOT NULL DEFAULT '{}',
    status approval_status NOT NULL DEFAULT 'pending',
    requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    responded_at TIMESTAMPTZ,
    response_note TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_approvals_org_id ON approvals(organization_id);
CREATE INDEX idx_approvals_agent_run_id ON approvals(agent_run_id);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_requested_by ON approvals(requested_by);
CREATE INDEX idx_approvals_expires_at ON approvals(expires_at);
CREATE INDEX idx_approvals_created_at ON approvals(created_at DESC);

CREATE TRIGGER approvals_updated_at
    BEFORE UPDATE ON approvals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE POLICY "approvals_select_policy" ON approvals FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "approvals_insert_policy" ON approvals FOR INSERT WITH CHECK (has_org_role(organization_id, 'member') AND organization_id = get_current_org_id());
CREATE POLICY "approvals_update_policy" ON approvals FOR UPDATE USING (has_org_role(organization_id, 'admin'));
CREATE POLICY "approvals_delete_policy" ON approvals FOR DELETE USING (has_org_role(organization_id, 'owner'));

ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE SET NULL;

-- TABLE: Integrations
CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider integration_provider NOT NULL,
    name TEXT NOT NULL,
    status integration_status NOT NULL DEFAULT 'pending_auth',
    access_token_id TEXT,
    refresh_token_id TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT[] DEFAULT '{}',
    account_email TEXT,
    account_id TEXT,
    config JSONB DEFAULT '{}',
    webhook_secret_id TEXT,
    last_sync_at TIMESTAMPTZ,
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_active_provider UNIQUE (organization_id, provider)
);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_integrations_org_id ON integrations(organization_id);
CREATE INDEX idx_integrations_provider ON integrations(provider);
CREATE INDEX idx_integrations_status ON integrations(status);

CREATE TRIGGER integrations_updated_at
    BEFORE UPDATE ON integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE POLICY "integrations_select_policy" ON integrations FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "integrations_insert_policy" ON integrations FOR INSERT WITH CHECK (has_org_role(organization_id, 'admin'));
CREATE POLICY "integrations_update_policy" ON integrations FOR UPDATE USING (has_org_role(organization_id, 'admin'));
CREATE POLICY "integrations_delete_policy" ON integrations FOR DELETE USING (has_org_role(organization_id, 'owner'));
```

---

## Migration 3: Idempotency Keys

```sql
-- =============================================================================
-- Idempotency Keys for Edge Functions
-- =============================================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT idempotency_keys_key_idx UNIQUE (key)
);

CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx ON idempotency_keys (created_at);

CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys(retention_hours INT DEFAULT 24)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    deleted_count INT;
BEGIN
    DELETE FROM idempotency_keys
    WHERE created_at < NOW() - (retention_hours || ' hours')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

CREATE INDEX IF NOT EXISTS agent_runs_org_created_idx ON agent_runs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS approvals_org_status_created_idx ON approvals (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS approvals_pending_idx ON approvals (organization_id, status) WHERE status = 'pending';

-- Add decision_reason column
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS decision_reason TEXT;

CREATE INDEX IF NOT EXISTS approvals_expires_at_idx ON approvals (expires_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION expire_pending_approvals()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    expired_count INT;
BEGIN
    UPDATE approvals SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW();
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$;
```

---

## Migration 4: Organization Settings

```sql
-- =============================================================================
-- Organization Settings
-- =============================================================================

CREATE TABLE IF NOT EXISTS org_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    auto_draft_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    auto_send_enabled BOOLEAN DEFAULT FALSE NOT NULL,
    auto_send_risk_threshold TEXT DEFAULT 'none' CHECK (auto_send_risk_threshold IN ('none', 'low', 'medium')),
    auto_send_allowed_domains TEXT[] DEFAULT ARRAY[]::TEXT[],
    auto_send_allowed_recipients TEXT[] DEFAULT ARRAY[]::TEXT[],
    daily_send_limit INTEGER DEFAULT 50 NOT NULL CHECK (daily_send_limit >= 0 AND daily_send_limit <= 1000),
    daily_run_limit INTEGER DEFAULT 100 NOT NULL CHECK (daily_run_limit >= 0 AND daily_run_limit <= 10000),
    require_approval_tools TEXT[] DEFAULT ARRAY['send_email']::TEXT[],
    min_confidence_threshold TEXT DEFAULT 'medium' CHECK (min_confidence_threshold IN ('very_low', 'low', 'medium', 'high', 'very_high')),
    default_tone TEXT DEFAULT 'professional' CHECK (default_tone IN ('formal', 'casual', 'professional', 'friendly')),
    signature_template TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT org_settings_org_unique UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS org_settings_org_id_idx ON org_settings(organization_id);
ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_settings_select_policy" ON org_settings FOR SELECT USING (is_org_member(organization_id));
CREATE POLICY "org_settings_insert_policy" ON org_settings FOR INSERT WITH CHECK (has_org_role(organization_id, 'admin'));
CREATE POLICY "org_settings_update_policy" ON org_settings FOR UPDATE USING (has_org_role(organization_id, 'admin')) WITH CHECK (has_org_role(organization_id, 'admin'));
CREATE POLICY "org_settings_delete_policy" ON org_settings FOR DELETE USING (has_org_role(organization_id, 'owner'));

CREATE OR REPLACE FUNCTION update_org_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_settings_updated_at_trigger
    BEFORE UPDATE ON org_settings
    FOR EACH ROW EXECUTE FUNCTION update_org_settings_updated_at();
```

---

## Migration 5: Billing

```sql
-- =============================================================================
-- Billing & Subscription Management
-- =============================================================================

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free' NOT NULL,
ADD COLUMN IF NOT EXISTS plan_limits JSONB DEFAULT '{}'::JSONB NOT NULL,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none' CHECK (subscription_status IN ('none', 'active', 'past_due', 'canceled', 'trialing', 'incomplete')),
ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS billing_email TEXT;

CREATE INDEX IF NOT EXISTS organizations_stripe_customer_id_idx ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS organizations_stripe_subscription_id_idx ON organizations(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Usage Tracking
CREATE TABLE IF NOT EXISTS usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    runs_count INTEGER DEFAULT 0 NOT NULL CHECK (runs_count >= 0),
    sends_count INTEGER DEFAULT 0 NOT NULL CHECK (sends_count >= 0),
    actions_count INTEGER DEFAULT 0 NOT NULL CHECK (actions_count >= 0),
    month_start DATE NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::DATE,
    monthly_runs INTEGER DEFAULT 0 NOT NULL CHECK (monthly_runs >= 0),
    monthly_sends INTEGER DEFAULT 0 NOT NULL CHECK (monthly_sends >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT usage_tracking_org_date_unique UNIQUE (organization_id, usage_date)
);

CREATE INDEX IF NOT EXISTS usage_tracking_org_date_idx ON usage_tracking(organization_id, usage_date DESC);
CREATE INDEX IF NOT EXISTS usage_tracking_month_idx ON usage_tracking(organization_id, month_start);
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_tracking_select_policy" ON usage_tracking FOR SELECT USING (is_org_member(organization_id));

-- Billing Events
CREATE TABLE IF NOT EXISTS billing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    stripe_event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT billing_events_stripe_event_unique UNIQUE (stripe_event_id)
);

CREATE INDEX IF NOT EXISTS billing_events_org_id_idx ON billing_events(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_events_type_idx ON billing_events(event_type);

-- Usage Functions
CREATE OR REPLACE FUNCTION increment_usage(p_org_id UUID, p_usage_type TEXT, p_amount INTEGER DEFAULT 1)
RETURNS TABLE (success BOOLEAN, current_count INTEGER, limit_value INTEGER, remaining INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_plan TEXT;
    v_limits JSONB;
    v_limit_key TEXT;
    v_limit INTEGER;
    v_new_count INTEGER;
BEGIN
    SELECT plan, plan_limits INTO v_plan, v_limits FROM organizations WHERE id = p_org_id;
    IF v_plan IS NULL THEN RETURN QUERY SELECT FALSE, 0, 0, 0; RETURN; END IF;

    v_limit_key := CASE p_usage_type WHEN 'runs' THEN 'runs_per_day' WHEN 'sends' THEN 'sends_per_day' WHEN 'actions' THEN 'max_actions_per_run' ELSE NULL END;
    IF v_limit_key IS NULL THEN RETURN QUERY SELECT FALSE, 0, 0, 0; RETURN; END IF;

    v_limit := COALESCE((v_limits->>v_limit_key)::INTEGER, 0);

    INSERT INTO usage_tracking (organization_id, usage_date, runs_count, sends_count, actions_count, updated_at)
    VALUES (p_org_id, CURRENT_DATE,
        CASE WHEN p_usage_type = 'runs' THEN p_amount ELSE 0 END,
        CASE WHEN p_usage_type = 'sends' THEN p_amount ELSE 0 END,
        CASE WHEN p_usage_type = 'actions' THEN p_amount ELSE 0 END,
        NOW()
    )
    ON CONFLICT (organization_id, usage_date) DO UPDATE SET
        runs_count = CASE WHEN p_usage_type = 'runs' THEN usage_tracking.runs_count + p_amount ELSE usage_tracking.runs_count END,
        sends_count = CASE WHEN p_usage_type = 'sends' THEN usage_tracking.sends_count + p_amount ELSE usage_tracking.sends_count END,
        actions_count = CASE WHEN p_usage_type = 'actions' THEN usage_tracking.actions_count + p_amount ELSE usage_tracking.actions_count END,
        updated_at = NOW()
    RETURNING CASE p_usage_type WHEN 'runs' THEN runs_count WHEN 'sends' THEN sends_count WHEN 'actions' THEN actions_count END INTO v_new_count;

    RETURN QUERY SELECT v_new_count <= v_limit AS success, v_new_count AS current_count, v_limit AS limit_value, GREATEST(0, v_limit - v_new_count) AS remaining;
END;
$$;

CREATE OR REPLACE FUNCTION get_org_usage(p_org_id UUID)
RETURNS TABLE (runs_today INTEGER, sends_today INTEGER, runs_limit INTEGER, sends_limit INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_limits JSONB;
BEGIN
    SELECT plan_limits INTO v_limits FROM organizations WHERE id = p_org_id;
    RETURN QUERY
    SELECT
        COALESCE(ut.runs_count, 0) AS runs_today,
        COALESCE(ut.sends_count, 0) AS sends_today,
        COALESCE((v_limits->>'runs_per_day')::INTEGER, 0) AS runs_limit,
        COALESCE((v_limits->>'sends_per_day')::INTEGER, 0) AS sends_limit
    FROM (SELECT p_org_id AS org_id) params
    LEFT JOIN usage_tracking ut ON ut.organization_id = params.org_id AND ut.usage_date = CURRENT_DATE;
END;
$$;

CREATE OR REPLACE FUNCTION org_has_feature(p_org_id UUID, p_feature TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_limits JSONB;
BEGIN
    SELECT plan_limits INTO v_limits FROM organizations WHERE id = p_org_id;
    RETURN COALESCE((v_limits->'features'->>p_feature)::BOOLEAN, FALSE);
END;
$$;

-- Plan Limits Sync Trigger
CREATE OR REPLACE FUNCTION sync_plan_limits()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.plan IS DISTINCT FROM OLD.plan AND (NEW.plan_limits IS NULL OR NEW.plan_limits = '{}'::JSONB) THEN
        NEW.plan_limits := CASE NEW.plan
            WHEN 'free' THEN jsonb_build_object('runs_per_day', 10, 'sends_per_day', 5, 'max_actions_per_run', 3, 'max_integrations', 1, 'max_team_members', 1, 'max_contacts', 100, 'features', jsonb_build_object('auto_send', false, 'api_access', false, 'audit_export', false))
            WHEN 'starter' THEN jsonb_build_object('runs_per_day', 100, 'sends_per_day', 50, 'max_actions_per_run', 10, 'max_integrations', 3, 'max_team_members', 5, 'max_contacts', 1000, 'features', jsonb_build_object('auto_send', true, 'api_access', false, 'audit_export', true))
            WHEN 'pro' THEN jsonb_build_object('runs_per_day', 1000, 'sends_per_day', 500, 'max_actions_per_run', 20, 'max_integrations', 10, 'max_team_members', 20, 'max_contacts', 10000, 'features', jsonb_build_object('auto_send', true, 'api_access', true, 'audit_export', true))
            WHEN 'agency' THEN jsonb_build_object('runs_per_day', 10000, 'sends_per_day', 5000, 'max_actions_per_run', 50, 'max_integrations', 50, 'max_team_members', 100, 'max_contacts', 100000, 'features', jsonb_build_object('auto_send', true, 'api_access', true, 'audit_export', true, 'sso', true))
            ELSE NEW.plan_limits
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizations_sync_plan_limits ON organizations;
CREATE TRIGGER organizations_sync_plan_limits BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION sync_plan_limits();
```

---

## Migration 6: Email Ingestion

```sql
-- =============================================================================
-- Email Ingestion
-- =============================================================================

CREATE TABLE IF NOT EXISTS email_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  alias_address TEXT NOT NULL UNIQUE,
  alias_key TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT unique_active_alias_per_org UNIQUE (organization_id, is_active) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_email_aliases_address ON email_aliases(alias_address);
CREATE INDEX IF NOT EXISTS idx_email_aliases_key ON email_aliases(alias_key);
CREATE INDEX IF NOT EXISTS idx_email_aliases_org ON email_aliases(organization_id);

CREATE TABLE IF NOT EXISTS inbound_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  thread_id TEXT,
  in_reply_to TEXT,
  from_address TEXT NOT NULL,
  from_name TEXT,
  to_addresses TEXT[] DEFAULT '{}',
  subject TEXT,
  snippet TEXT,
  has_attachments BOOLEAN DEFAULT false,
  attachment_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'received' NOT NULL,
  agent_run_id UUID REFERENCES agent_runs(id),
  processing_error TEXT,
  received_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  processed_at TIMESTAMPTZ,
  email_date TIMESTAMPTZ,
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  raw_headers JSONB,
  CONSTRAINT unique_message_per_org UNIQUE (organization_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_emails_org ON inbound_emails(organization_id);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_status ON inbound_emails(status);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_from ON inbound_emails(from_address);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_received ON inbound_emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_thread ON inbound_emails(thread_id) WHERE thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT unique_provider_event UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_email_webhook_events_processed ON email_webhook_events(processed_at);

ALTER TABLE email_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org aliases" ON email_aliases FOR SELECT USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Admins can manage own org aliases" ON email_aliases FOR ALL USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'admin')));
CREATE POLICY "Users can view own org emails" ON inbound_emails FOR SELECT USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Service role can insert emails" ON inbound_emails FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update emails" ON inbound_emails FOR UPDATE USING (true);

-- Helper Functions
CREATE OR REPLACE FUNCTION generate_alias_key() RETURNS TEXT AS $$
BEGIN
  RETURN lower(substring(encode(gen_random_bytes(16), 'hex') from 1 for 12));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_org_email_alias(p_org_id UUID, p_domain TEXT DEFAULT 'mail.opsmanager.app')
RETURNS TABLE (alias_address TEXT, alias_key TEXT, is_new BOOLEAN) AS $$
DECLARE
  v_existing_alias TEXT;
  v_existing_key TEXT;
  v_new_key TEXT;
  v_new_address TEXT;
BEGIN
  SELECT ea.alias_address, ea.alias_key INTO v_existing_alias, v_existing_key
  FROM email_aliases ea WHERE ea.organization_id = p_org_id AND ea.is_active = true;

  IF v_existing_alias IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_alias, v_existing_key, false;
    RETURN;
  END IF;

  v_new_key := generate_alias_key();
  v_new_address := 'inbox-' || v_new_key || '@' || p_domain;
  INSERT INTO email_aliases (organization_id, alias_address, alias_key) VALUES (p_org_id, v_new_address, v_new_key);
  RETURN QUERY SELECT v_new_address, v_new_key, true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_org_by_alias_key(p_alias_key TEXT) RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM email_aliases WHERE alias_key = p_alias_key AND is_active = true;
  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION check_email_webhook_idempotency(p_provider TEXT, p_event_id TEXT) RETURNS BOOLEAN AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  INSERT INTO email_webhook_events (provider, provider_event_id, event_type) VALUES (p_provider, p_event_id, 'inbound') ON CONFLICT (provider, provider_event_id) DO NOTHING;
  GET DIAGNOSTICS v_exists = ROW_COUNT;
  RETURN v_exists > 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_email_webhook_events() RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM email_webhook_events WHERE processed_at < now() - INTERVAL '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_email_aliases_updated_at
  BEFORE UPDATE ON email_aliases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Verification

Run after all migrations:

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;

-- Check RLS enabled
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true;

-- Check functions exist
SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_type = 'FUNCTION' ORDER BY routine_name;

-- Test helper functions work
SELECT get_current_org_id(); -- Should return NULL without auth
```
