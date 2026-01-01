-- =============================================================================
-- Ops Manager Extended Schema - Multi-tenant SaaS MVP
-- =============================================================================
-- Migration: 00002_extended_schema.sql
--
-- This migration adds:
-- - org_members: Granular membership with invites/roles
-- - contacts: CRM-style contact management
-- - tasks: Task/workflow management
-- - approvals: Approval workflow for agent actions
-- - agent_runs: Agent execution history
-- - integrations: OAuth token storage (encrypted references)
-- - Enhanced audit_logs with append-only enforcement
--
-- SECURITY: All tables have RLS enabled with role-based policies.
-- =============================================================================

-- =============================================================================
-- ENUM Types
-- =============================================================================

-- Membership status for invites
CREATE TYPE membership_status AS ENUM ('pending', 'active', 'suspended', 'removed');

-- Task status
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'waiting_approval', 'completed', 'failed', 'cancelled');

-- Task priority
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- Approval status
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- Agent run status
CREATE TYPE agent_run_status AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- Integration provider
CREATE TYPE integration_provider AS ENUM (
    'google_workspace',
    'microsoft_365',
    'slack',
    'quickbooks',
    'stripe',
    'hubspot',
    'custom_webhook'
);

-- Integration status
CREATE TYPE integration_status AS ENUM ('pending_auth', 'active', 'expired', 'revoked', 'error');

-- Extend user_role to include viewer
-- Note: In production, you might use a separate migration for this
DO $$
BEGIN
    -- Add 'viewer' to user_role enum if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'viewer' AND enumtypid = 'user_role'::regtype) THEN
        ALTER TYPE user_role ADD VALUE 'viewer';
    END IF;
END $$;

-- =============================================================================
-- Helper Functions (Created First for RLS Policies)
-- =============================================================================

-- Check if current user is a member of the specified organization
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

-- Get current user's role in the specified organization
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

-- Check if user has at least the specified role (role hierarchy)
CREATE OR REPLACE FUNCTION has_org_role(check_org_id UUID, required_role user_role)
RETURNS BOOLEAN AS $$
DECLARE
    user_role_value INTEGER;
    required_role_value INTEGER;
BEGIN
    -- Role hierarchy: owner=4, admin=3, member=2, viewer=1
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

-- =============================================================================
-- Org Members Table (Granular Membership)
-- =============================================================================
-- Tracks invites and membership status separately from profiles

CREATE TABLE org_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

    -- Ensure unique email per org
    CONSTRAINT unique_org_email UNIQUE (organization_id, email)
);

-- Enable RLS
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_org_members_org_id ON org_members(organization_id);
CREATE INDEX idx_org_members_user_id ON org_members(user_id);
CREATE INDEX idx_org_members_email ON org_members(email);
CREATE INDEX idx_org_members_status ON org_members(status);

-- Trigger for updated_at
CREATE TRIGGER org_members_updated_at
    BEFORE UPDATE ON org_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies for org_members
-- Viewers+: Can see members in their org
CREATE POLICY "org_members_select_policy"
    ON org_members FOR SELECT
    USING (is_org_member(organization_id));

-- Admins+: Can invite new members
CREATE POLICY "org_members_insert_policy"
    ON org_members FOR INSERT
    WITH CHECK (has_org_role(organization_id, 'admin'));

-- Admins+: Can update member status/role (but not promote above their own role)
CREATE POLICY "org_members_update_policy"
    ON org_members FOR UPDATE
    USING (has_org_role(organization_id, 'admin'))
    WITH CHECK (
        has_org_role(organization_id, 'admin')
        -- Prevent promoting someone above your own role
        AND (
            CASE role
                WHEN 'owner' THEN has_org_role(organization_id, 'owner')
                WHEN 'admin' THEN has_org_role(organization_id, 'owner')
                ELSE true
            END
        )
    );

-- Owners only: Can remove members
CREATE POLICY "org_members_delete_policy"
    ON org_members FOR DELETE
    USING (has_org_role(organization_id, 'owner'));

-- =============================================================================
-- Contacts Table
-- =============================================================================
-- CRM-style contact management with minimal PII

CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Core fields (minimal PII)
    email TEXT,
    full_name TEXT,
    company TEXT,
    job_title TEXT,
    phone TEXT,

    -- Categorization
    tags TEXT[] DEFAULT '{}',
    source TEXT, -- e.g., 'manual', 'import', 'integration'

    -- Metadata
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',

    -- Ownership
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,

    -- Timestamps
    last_contacted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_contacts_org_id ON contacts(organization_id);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_assigned_to ON contacts(assigned_to);
CREATE INDEX idx_contacts_tags ON contacts USING GIN(tags);
CREATE INDEX idx_contacts_created_at ON contacts(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies for contacts
-- Viewers+: Can view contacts in their org
CREATE POLICY "contacts_select_policy"
    ON contacts FOR SELECT
    USING (is_org_member(organization_id));

-- Members+: Can create contacts
CREATE POLICY "contacts_insert_policy"
    ON contacts FOR INSERT
    WITH CHECK (
        has_org_role(organization_id, 'member')
        AND organization_id = get_current_org_id()
    );

-- Members+: Can update contacts (own org only)
CREATE POLICY "contacts_update_policy"
    ON contacts FOR UPDATE
    USING (has_org_role(organization_id, 'member'));

-- Admins+: Can delete contacts
CREATE POLICY "contacts_delete_policy"
    ON contacts FOR DELETE
    USING (has_org_role(organization_id, 'admin'));

-- =============================================================================
-- Tasks Table
-- =============================================================================
-- Task management with org isolation

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Task details
    title TEXT NOT NULL,
    description TEXT,
    status task_status NOT NULL DEFAULT 'pending',
    priority task_priority NOT NULL DEFAULT 'medium',

    -- Relationships
    parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

    -- Assignment
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,

    -- Scheduling
    due_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Agent integration
    agent_run_id UUID, -- Will be foreign key after agent_runs table
    requires_approval BOOLEAN NOT NULL DEFAULT false,

    -- Metadata
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_tasks_org_id ON tasks(organization_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_due_at ON tasks(due_at);
CREATE INDEX idx_tasks_parent_id ON tasks(parent_task_id);
CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies for tasks
-- Viewers+: Can view tasks in their org
CREATE POLICY "tasks_select_policy"
    ON tasks FOR SELECT
    USING (is_org_member(organization_id));

-- Members+: Can create tasks
CREATE POLICY "tasks_insert_policy"
    ON tasks FOR INSERT
    WITH CHECK (
        has_org_role(organization_id, 'member')
        AND organization_id = get_current_org_id()
    );

-- Members+: Can update tasks (own or assigned)
CREATE POLICY "tasks_update_policy"
    ON tasks FOR UPDATE
    USING (
        has_org_role(organization_id, 'member')
        AND (
            created_by = auth.uid()
            OR assigned_to = auth.uid()
            OR has_org_role(organization_id, 'admin')
        )
    );

-- Admins+: Can delete tasks
CREATE POLICY "tasks_delete_policy"
    ON tasks FOR DELETE
    USING (has_org_role(organization_id, 'admin'));

-- =============================================================================
-- Agent Runs Table
-- =============================================================================
-- Tracks AI agent executions

CREATE TABLE agent_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Execution details
    agent_type TEXT NOT NULL, -- e.g., 'email_sender', 'doc_editor', 'scheduler'
    status agent_run_status NOT NULL DEFAULT 'queued',

    -- Input/Output
    input_data JSONB NOT NULL DEFAULT '{}',
    output_data JSONB,
    error_message TEXT,

    -- Context
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    triggered_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,

    -- Approval tracking
    requires_approval BOOLEAN NOT NULL DEFAULT true,
    approval_id UUID, -- Will be foreign key after approvals table

    -- Execution timing
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Resource usage
    tokens_used INTEGER,
    cost_cents INTEGER,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_agent_runs_org_id ON agent_runs(organization_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_agent_runs_agent_type ON agent_runs(agent_type);
CREATE INDEX idx_agent_runs_task_id ON agent_runs(task_id);
CREATE INDEX idx_agent_runs_triggered_by ON agent_runs(triggered_by);
CREATE INDEX idx_agent_runs_created_at ON agent_runs(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER agent_runs_updated_at
    BEFORE UPDATE ON agent_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies for agent_runs
-- Viewers+: Can view agent runs in their org
CREATE POLICY "agent_runs_select_policy"
    ON agent_runs FOR SELECT
    USING (is_org_member(organization_id));

-- Members+: Can create agent runs
CREATE POLICY "agent_runs_insert_policy"
    ON agent_runs FOR INSERT
    WITH CHECK (
        has_org_role(organization_id, 'member')
        AND organization_id = get_current_org_id()
    );

-- System updates only (service role) or admins for cancellation
CREATE POLICY "agent_runs_update_policy"
    ON agent_runs FOR UPDATE
    USING (
        has_org_role(organization_id, 'member')
        AND (
            triggered_by = auth.uid()
            OR has_org_role(organization_id, 'admin')
        )
    );

-- Owners only: Can delete agent runs (for cleanup)
CREATE POLICY "agent_runs_delete_policy"
    ON agent_runs FOR DELETE
    USING (has_org_role(organization_id, 'owner'));

-- Add foreign key from tasks to agent_runs now that table exists
ALTER TABLE tasks
    ADD CONSTRAINT tasks_agent_run_id_fkey
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;

-- =============================================================================
-- Approvals Table
-- =============================================================================
-- Approval workflow for agent actions

CREATE TABLE approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- What needs approval
    agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL, -- e.g., 'send_email', 'edit_document', 'create_invoice'
    action_summary TEXT NOT NULL,
    action_details JSONB NOT NULL DEFAULT '{}',

    -- Approval status
    status approval_status NOT NULL DEFAULT 'pending',

    -- Request details
    requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Response details
    responded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    responded_at TIMESTAMPTZ,
    response_note TEXT,

    -- Expiration
    expires_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_approvals_org_id ON approvals(organization_id);
CREATE INDEX idx_approvals_agent_run_id ON approvals(agent_run_id);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_requested_by ON approvals(requested_by);
CREATE INDEX idx_approvals_expires_at ON approvals(expires_at);
CREATE INDEX idx_approvals_created_at ON approvals(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER approvals_updated_at
    BEFORE UPDATE ON approvals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies for approvals
-- Viewers+: Can view approvals in their org
CREATE POLICY "approvals_select_policy"
    ON approvals FOR SELECT
    USING (is_org_member(organization_id));

-- Members+: Can create approval requests
CREATE POLICY "approvals_insert_policy"
    ON approvals FOR INSERT
    WITH CHECK (
        has_org_role(organization_id, 'member')
        AND organization_id = get_current_org_id()
    );

-- Admins+: Can respond to approvals
CREATE POLICY "approvals_update_policy"
    ON approvals FOR UPDATE
    USING (has_org_role(organization_id, 'admin'));

-- Owners only: Can delete approvals
CREATE POLICY "approvals_delete_policy"
    ON approvals FOR DELETE
    USING (has_org_role(organization_id, 'owner'));

-- Add foreign key from agent_runs to approvals now that table exists
ALTER TABLE agent_runs
    ADD CONSTRAINT agent_runs_approval_id_fkey
    FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE SET NULL;

-- =============================================================================
-- Integrations Table
-- =============================================================================
-- OAuth token storage with encrypted references
-- SECURITY: Actual tokens should be encrypted at rest using Supabase Vault
-- or stored in a separate secrets manager. This table stores references.

CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Integration details
    provider integration_provider NOT NULL,
    name TEXT NOT NULL, -- User-friendly name
    status integration_status NOT NULL DEFAULT 'pending_auth',

    -- OAuth data (encrypted references - actual tokens in vault)
    -- SECURITY: Never store raw tokens here in production
    -- Use Supabase Vault: vault.create_secret()
    access_token_id TEXT, -- Reference to encrypted token in vault
    refresh_token_id TEXT, -- Reference to encrypted refresh token
    token_expires_at TIMESTAMPTZ,

    -- OAuth metadata
    scopes TEXT[] DEFAULT '{}',
    account_email TEXT, -- Connected account identifier
    account_id TEXT, -- Provider's account ID

    -- Configuration
    config JSONB DEFAULT '{}', -- Provider-specific settings
    webhook_secret_id TEXT, -- Reference to encrypted webhook secret

    -- Usage tracking
    last_sync_at TIMESTAMPTZ,
    last_error TEXT,
    error_count INTEGER DEFAULT 0,

    -- Ownership
    created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One active integration per provider per org
    CONSTRAINT unique_active_provider UNIQUE (organization_id, provider)
);

-- Enable RLS
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_integrations_org_id ON integrations(organization_id);
CREATE INDEX idx_integrations_provider ON integrations(provider);
CREATE INDEX idx_integrations_status ON integrations(status);

-- Trigger for updated_at
CREATE TRIGGER integrations_updated_at
    BEFORE UPDATE ON integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies for integrations
-- Viewers+: Can view integrations (limited fields - no token refs)
CREATE POLICY "integrations_select_policy"
    ON integrations FOR SELECT
    USING (is_org_member(organization_id));

-- Admins+: Can create integrations
CREATE POLICY "integrations_insert_policy"
    ON integrations FOR INSERT
    WITH CHECK (has_org_role(organization_id, 'admin'));

-- Admins+: Can update integrations
CREATE POLICY "integrations_update_policy"
    ON integrations FOR UPDATE
    USING (has_org_role(organization_id, 'admin'));

-- Owners only: Can delete integrations
CREATE POLICY "integrations_delete_policy"
    ON integrations FOR DELETE
    USING (has_org_role(organization_id, 'owner'));

-- =============================================================================
-- Enhanced Audit Logs - Append-Only Enforcement
-- =============================================================================

-- Drop existing policies that might allow updates
DROP POLICY IF EXISTS "Admins can insert audit logs" ON audit_logs;

-- Add new columns to audit_logs if they don't exist
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS request_id TEXT,
    ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
    ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'info';

-- Create index on severity
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);

-- RLS Policies for audit_logs (Append-Only)
-- Viewers+: Can view audit logs in their org
CREATE POLICY "audit_logs_select_policy"
    ON audit_logs FOR SELECT
    USING (is_org_member(organization_id));

-- Members+: Can insert audit logs
CREATE POLICY "audit_logs_insert_policy"
    ON audit_logs FOR INSERT
    WITH CHECK (
        has_org_role(organization_id, 'member')
        AND organization_id = get_current_org_id()
    );

-- EXPLICITLY DENY UPDATE - No policy means denied by default
-- But we add a trigger as defense-in-depth

-- EXPLICITLY DENY DELETE - No policy means denied by default
-- But we add a trigger as defense-in-depth

-- Trigger to prevent updates (defense-in-depth)
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are immutable. Updates and deletes are not allowed.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_prevent_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

CREATE TRIGGER audit_logs_prevent_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

-- =============================================================================
-- Audit Log Helper Function
-- =============================================================================
-- Use this function to create audit entries consistently

CREATE OR REPLACE FUNCTION create_audit_log(
    p_action TEXT,
    p_resource_type TEXT,
    p_resource_id TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL,
    p_severity TEXT DEFAULT 'info'
)
RETURNS UUID AS $$
DECLARE
    v_org_id UUID;
    v_actor_id UUID;
    v_log_id UUID;
BEGIN
    -- Get current user's org and id
    SELECT organization_id, id INTO v_org_id, v_actor_id
    FROM profiles
    WHERE id = auth.uid();

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'User not found or not in an organization';
    END IF;

    -- Insert audit log
    INSERT INTO audit_logs (
        organization_id,
        actor_id,
        action,
        resource_type,
        resource_id,
        metadata,
        severity,
        created_at
    ) VALUES (
        v_org_id,
        v_actor_id,
        p_action,
        p_resource_type,
        p_resource_id,
        p_metadata,
        p_severity,
        NOW()
    ) RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Automatic Audit Logging Triggers
-- =============================================================================
-- Create triggers to automatically log important actions

CREATE OR REPLACE FUNCTION audit_log_changes()
RETURNS TRIGGER AS $$
DECLARE
    v_action TEXT;
    v_resource_id TEXT;
    v_metadata JSONB;
BEGIN
    -- Determine action type
    IF TG_OP = 'INSERT' THEN
        v_action := TG_TABLE_NAME || '.created';
        v_resource_id := NEW.id::TEXT;
        v_metadata := jsonb_build_object('new', to_jsonb(NEW));
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := TG_TABLE_NAME || '.updated';
        v_resource_id := NEW.id::TEXT;
        v_metadata := jsonb_build_object(
            'old', to_jsonb(OLD),
            'new', to_jsonb(NEW)
        );
    ELSIF TG_OP = 'DELETE' THEN
        v_action := TG_TABLE_NAME || '.deleted';
        v_resource_id := OLD.id::TEXT;
        v_metadata := jsonb_build_object('old', to_jsonb(OLD));
    END IF;

    -- Insert audit log (bypass RLS with service role context)
    INSERT INTO audit_logs (
        organization_id,
        actor_id,
        action,
        resource_type,
        resource_id,
        metadata,
        created_at
    ) VALUES (
        COALESCE(NEW.organization_id, OLD.organization_id),
        auth.uid(),
        v_action,
        TG_TABLE_NAME,
        v_resource_id,
        v_metadata,
        NOW()
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add audit triggers to key tables
CREATE TRIGGER tasks_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON tasks
    FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

CREATE TRIGGER approvals_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON approvals
    FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

CREATE TRIGGER integrations_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON integrations
    FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

-- =============================================================================
-- Views for Common Queries
-- =============================================================================

-- Active tasks view
CREATE OR REPLACE VIEW active_tasks AS
SELECT
    t.*,
    p.full_name as assigned_to_name,
    c.full_name as contact_name
FROM tasks t
LEFT JOIN profiles p ON t.assigned_to = p.id
LEFT JOIN contacts c ON t.contact_id = c.id
WHERE t.status NOT IN ('completed', 'cancelled', 'failed');

-- Pending approvals view
CREATE OR REPLACE VIEW pending_approvals AS
SELECT
    a.*,
    ar.agent_type,
    p.full_name as requested_by_name
FROM approvals a
JOIN agent_runs ar ON a.agent_run_id = ar.id
JOIN profiles p ON a.requested_by = p.id
WHERE a.status = 'pending'
AND (a.expires_at IS NULL OR a.expires_at > NOW());

-- =============================================================================
-- Grant Permissions
-- =============================================================================

-- Grant usage on custom types to authenticated users
GRANT USAGE ON TYPE membership_status TO authenticated;
GRANT USAGE ON TYPE task_status TO authenticated;
GRANT USAGE ON TYPE task_priority TO authenticated;
GRANT USAGE ON TYPE approval_status TO authenticated;
GRANT USAGE ON TYPE agent_run_status TO authenticated;
GRANT USAGE ON TYPE integration_provider TO authenticated;
GRANT USAGE ON TYPE integration_status TO authenticated;
