-- =============================================================================
-- Migration: Billing & Subscription Management
-- =============================================================================
--
-- Purpose:
--   Add subscription billing support to organizations.
--   Store plan entitlements, Stripe customer/subscription IDs,
--   and usage tracking for limit enforcement.
--
-- Security:
--   - Plan data stored server-side, never trusted from client
--   - RLS ensures org isolation
--   - Usage counts updated atomically
--
-- =============================================================================

-- Add billing columns to organizations table
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free' NOT NULL,
ADD COLUMN IF NOT EXISTS plan_limits JSONB DEFAULT '{}'::JSONB NOT NULL,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none' CHECK (subscription_status IN ('none', 'active', 'past_due', 'canceled', 'trialing', 'incomplete')),
ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS billing_email TEXT;

-- Create indexes for Stripe lookups
CREATE INDEX IF NOT EXISTS organizations_stripe_customer_id_idx
    ON organizations(stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS organizations_stripe_subscription_id_idx
    ON organizations(stripe_subscription_id)
    WHERE stripe_subscription_id IS NOT NULL;

-- =============================================================================
-- Usage Tracking Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Daily usage counters
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    runs_count INTEGER DEFAULT 0 NOT NULL CHECK (runs_count >= 0),
    sends_count INTEGER DEFAULT 0 NOT NULL CHECK (sends_count >= 0),
    actions_count INTEGER DEFAULT 0 NOT NULL CHECK (actions_count >= 0),

    -- Monthly aggregates
    month_start DATE NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::DATE,
    monthly_runs INTEGER DEFAULT 0 NOT NULL CHECK (monthly_runs >= 0),
    monthly_sends INTEGER DEFAULT 0 NOT NULL CHECK (monthly_sends >= 0),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Unique constraint per org per day
    CONSTRAINT usage_tracking_org_date_unique UNIQUE (organization_id, usage_date)
);

-- Indexes for usage queries
CREATE INDEX IF NOT EXISTS usage_tracking_org_date_idx
    ON usage_tracking(organization_id, usage_date DESC);

CREATE INDEX IF NOT EXISTS usage_tracking_month_idx
    ON usage_tracking(organization_id, month_start);

-- Enable RLS
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies for usage_tracking
CREATE POLICY "usage_tracking_select_policy" ON usage_tracking
    FOR SELECT
    USING (is_org_member(organization_id));

-- Only service role can insert/update usage (via triggers or server actions)
-- No direct insert/update policies for users

-- =============================================================================
-- Billing Events Table (Webhook Audit)
-- =============================================================================

CREATE TABLE IF NOT EXISTS billing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    stripe_event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Index for deduplication
    CONSTRAINT billing_events_stripe_event_unique UNIQUE (stripe_event_id)
);

-- Index for org lookups
CREATE INDEX IF NOT EXISTS billing_events_org_id_idx
    ON billing_events(organization_id)
    WHERE organization_id IS NOT NULL;

-- Index for event type queries
CREATE INDEX IF NOT EXISTS billing_events_type_idx
    ON billing_events(event_type);

-- =============================================================================
-- Usage Tracking Functions
-- =============================================================================

/**
 * Increment usage counter atomically.
 * Returns true if within limits, false if limit exceeded.
 */
CREATE OR REPLACE FUNCTION increment_usage(
    p_org_id UUID,
    p_usage_type TEXT,
    p_amount INTEGER DEFAULT 1
)
RETURNS TABLE (
    success BOOLEAN,
    current_count INTEGER,
    limit_value INTEGER,
    remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_plan TEXT;
    v_limits JSONB;
    v_limit_key TEXT;
    v_limit INTEGER;
    v_current INTEGER;
    v_new_count INTEGER;
BEGIN
    -- Get org plan and limits
    SELECT plan, plan_limits INTO v_plan, v_limits
    FROM organizations
    WHERE id = p_org_id;

    IF v_plan IS NULL THEN
        RETURN QUERY SELECT FALSE, 0, 0, 0;
        RETURN;
    END IF;

    -- Determine limit key based on usage type
    v_limit_key := CASE p_usage_type
        WHEN 'runs' THEN 'runs_per_day'
        WHEN 'sends' THEN 'sends_per_day'
        WHEN 'actions' THEN 'max_actions_per_run'
        ELSE NULL
    END;

    IF v_limit_key IS NULL THEN
        RETURN QUERY SELECT FALSE, 0, 0, 0;
        RETURN;
    END IF;

    -- Get limit from plan_limits JSONB
    v_limit := COALESCE((v_limits->>v_limit_key)::INTEGER, 0);

    -- Upsert usage tracking record and increment
    INSERT INTO usage_tracking (
        organization_id,
        usage_date,
        runs_count,
        sends_count,
        actions_count,
        updated_at
    )
    VALUES (
        p_org_id,
        CURRENT_DATE,
        CASE WHEN p_usage_type = 'runs' THEN p_amount ELSE 0 END,
        CASE WHEN p_usage_type = 'sends' THEN p_amount ELSE 0 END,
        CASE WHEN p_usage_type = 'actions' THEN p_amount ELSE 0 END,
        NOW()
    )
    ON CONFLICT (organization_id, usage_date)
    DO UPDATE SET
        runs_count = CASE
            WHEN p_usage_type = 'runs'
            THEN usage_tracking.runs_count + p_amount
            ELSE usage_tracking.runs_count
        END,
        sends_count = CASE
            WHEN p_usage_type = 'sends'
            THEN usage_tracking.sends_count + p_amount
            ELSE usage_tracking.sends_count
        END,
        actions_count = CASE
            WHEN p_usage_type = 'actions'
            THEN usage_tracking.actions_count + p_amount
            ELSE usage_tracking.actions_count
        END,
        updated_at = NOW()
    RETURNING
        CASE p_usage_type
            WHEN 'runs' THEN runs_count
            WHEN 'sends' THEN sends_count
            WHEN 'actions' THEN actions_count
        END
    INTO v_new_count;

    -- Check if within limit
    RETURN QUERY SELECT
        v_new_count <= v_limit AS success,
        v_new_count AS current_count,
        v_limit AS limit_value,
        GREATEST(0, v_limit - v_new_count) AS remaining;
END;
$$;

/**
 * Get current usage for an organization.
 */
CREATE OR REPLACE FUNCTION get_org_usage(p_org_id UUID)
RETURNS TABLE (
    runs_today INTEGER,
    sends_today INTEGER,
    runs_limit INTEGER,
    sends_limit INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_limits JSONB;
BEGIN
    -- Get limits
    SELECT plan_limits INTO v_limits
    FROM organizations
    WHERE id = p_org_id;

    -- Return usage with limits
    RETURN QUERY
    SELECT
        COALESCE(ut.runs_count, 0) AS runs_today,
        COALESCE(ut.sends_count, 0) AS sends_today,
        COALESCE((v_limits->>'runs_per_day')::INTEGER, 0) AS runs_limit,
        COALESCE((v_limits->>'sends_per_day')::INTEGER, 0) AS sends_limit
    FROM (SELECT p_org_id AS org_id) params
    LEFT JOIN usage_tracking ut
        ON ut.organization_id = params.org_id
        AND ut.usage_date = CURRENT_DATE;
END;
$$;

/**
 * Check if org has feature enabled.
 */
CREATE OR REPLACE FUNCTION org_has_feature(p_org_id UUID, p_feature TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_limits JSONB;
    v_has_feature BOOLEAN;
BEGIN
    SELECT plan_limits INTO v_limits
    FROM organizations
    WHERE id = p_org_id;

    v_has_feature := COALESCE(
        (v_limits->'features'->>p_feature)::BOOLEAN,
        FALSE
    );

    RETURN v_has_feature;
END;
$$;

-- =============================================================================
-- Trigger to sync plan_limits on plan change
-- =============================================================================

-- Note: plan_limits should be updated by the application when plan changes
-- This provides a fallback with default limits

CREATE OR REPLACE FUNCTION sync_plan_limits()
RETURNS TRIGGER AS $$
BEGIN
    -- If plan changed and plan_limits not explicitly set, apply defaults
    IF NEW.plan IS DISTINCT FROM OLD.plan AND
       (NEW.plan_limits IS NULL OR NEW.plan_limits = '{}'::JSONB)
    THEN
        NEW.plan_limits := CASE NEW.plan
            WHEN 'free' THEN jsonb_build_object(
                'runs_per_day', 10,
                'sends_per_day', 5,
                'max_actions_per_run', 3,
                'max_integrations', 1,
                'max_team_members', 1,
                'max_contacts', 100,
                'features', jsonb_build_object(
                    'auto_send', false,
                    'api_access', false,
                    'audit_export', false
                )
            )
            WHEN 'starter' THEN jsonb_build_object(
                'runs_per_day', 100,
                'sends_per_day', 50,
                'max_actions_per_run', 10,
                'max_integrations', 3,
                'max_team_members', 5,
                'max_contacts', 1000,
                'features', jsonb_build_object(
                    'auto_send', true,
                    'api_access', false,
                    'audit_export', true
                )
            )
            WHEN 'pro' THEN jsonb_build_object(
                'runs_per_day', 1000,
                'sends_per_day', 500,
                'max_actions_per_run', 20,
                'max_integrations', 10,
                'max_team_members', 20,
                'max_contacts', 10000,
                'features', jsonb_build_object(
                    'auto_send', true,
                    'api_access', true,
                    'audit_export', true
                )
            )
            WHEN 'agency' THEN jsonb_build_object(
                'runs_per_day', 10000,
                'sends_per_day', 5000,
                'max_actions_per_run', 50,
                'max_integrations', 50,
                'max_team_members', 100,
                'max_contacts', 100000,
                'features', jsonb_build_object(
                    'auto_send', true,
                    'api_access', true,
                    'audit_export', true,
                    'sso', true
                )
            )
            ELSE NEW.plan_limits
        END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS organizations_sync_plan_limits ON organizations;
CREATE TRIGGER organizations_sync_plan_limits
    BEFORE UPDATE ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION sync_plan_limits();

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON COLUMN organizations.plan IS 'Current subscription plan: free, starter, pro, agency';
COMMENT ON COLUMN organizations.plan_limits IS 'JSONB containing plan limits and feature flags';
COMMENT ON COLUMN organizations.stripe_customer_id IS 'Stripe customer ID for billing';
COMMENT ON COLUMN organizations.stripe_subscription_id IS 'Active Stripe subscription ID';
COMMENT ON COLUMN organizations.subscription_status IS 'Current subscription status from Stripe';

COMMENT ON TABLE usage_tracking IS 'Daily usage counters for rate limiting';
COMMENT ON TABLE billing_events IS 'Stripe webhook events for audit and deduplication';

COMMENT ON FUNCTION increment_usage IS 'Atomically increment usage counter and check limits';
COMMENT ON FUNCTION get_org_usage IS 'Get current usage counts and limits for an org';
COMMENT ON FUNCTION org_has_feature IS 'Check if org has a specific feature enabled';
