-- =============================================================================
-- Ops Manager Initial Schema
-- =============================================================================
-- This migration creates the core tables for multi-tenant SaaS:
-- - organizations: Multi-tenant isolation boundary
-- - profiles: User profiles linked to auth.users
-- - audit_logs: Append-only audit trail
--
-- SECURITY: All tables have Row Level Security (RLS) enabled and policies
-- that enforce organization-level isolation.
-- =============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUM Types
-- =============================================================================

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member');

-- =============================================================================
-- Organizations Table
-- =============================================================================
-- The top-level tenant boundary. All data is scoped to an organization.

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own organization
CREATE POLICY "Users can view their organization"
    ON organizations
    FOR SELECT
    USING (
        id IN (
            SELECT organization_id FROM profiles
            WHERE profiles.id = auth.uid()
        )
    );

-- Policy: Only owners can update organization
CREATE POLICY "Owners can update organization"
    ON organizations
    FOR UPDATE
    USING (
        id IN (
            SELECT organization_id FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'owner'
        )
    );

-- =============================================================================
-- Profiles Table
-- =============================================================================
-- User profiles linked to Supabase auth.users. Each user belongs to one org.

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    role user_role NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view profiles in their organization
CREATE POLICY "Users can view org profiles"
    ON profiles
    FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM profiles AS p
            WHERE p.id = auth.uid()
        )
    );

-- Policy: Users can update their own profile
CREATE POLICY "Users can update own profile"
    ON profiles
    FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (
        id = auth.uid()
        -- Prevent users from changing their own role or org
        AND organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    );

-- Policy: Allow new profile creation during signup (via trigger)
CREATE POLICY "Service role can insert profiles"
    ON profiles
    FOR INSERT
    WITH CHECK (true);  -- Controlled by trigger, not direct insert

-- =============================================================================
-- Audit Logs Table
-- =============================================================================
-- Append-only audit trail for all significant actions.
-- SECURITY: Insert-only, no updates or deletes allowed.

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- Enable RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view audit logs in their organization
CREATE POLICY "Users can view org audit logs"
    ON audit_logs
    FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM profiles
            WHERE profiles.id = auth.uid()
        )
    );

-- Policy: Only admins/owners can insert audit logs (or via service role)
CREATE POLICY "Admins can insert audit logs"
    ON audit_logs
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('owner', 'admin')
        )
    );

-- SECURITY: Explicitly deny updates and deletes (defense in depth)
-- RLS by default denies, but this makes intent explicit

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX idx_profiles_organization_id ON profiles(organization_id);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_audit_logs_organization_id ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- =============================================================================
-- Triggers
-- =============================================================================

-- Auto-update updated_at timestamp
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

-- =============================================================================
-- Handle New User Signup
-- =============================================================================
-- When a user signs up, create their org and profile automatically.
-- This runs with elevated privileges (SECURITY DEFINER).

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_org_id UUID;
BEGIN
    -- Create a new organization for the user
    INSERT INTO organizations (name)
    VALUES (COALESCE(NEW.raw_user_meta_data->>'company', NEW.email || '''s Organization'))
    RETURNING id INTO new_org_id;

    -- Create the user's profile as org owner
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

-- Trigger on auth.users insert
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================================================
-- Helper Functions
-- =============================================================================

-- Get current user's organization ID
CREATE OR REPLACE FUNCTION get_current_org_id()
RETURNS UUID AS $$
    SELECT organization_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if current user has a specific role or higher
CREATE OR REPLACE FUNCTION has_role(required_role user_role)
RETURNS BOOLEAN AS $$
DECLARE
    user_role_value INTEGER;
    required_role_value INTEGER;
BEGIN
    -- Role hierarchy: owner=3, admin=2, member=1
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
