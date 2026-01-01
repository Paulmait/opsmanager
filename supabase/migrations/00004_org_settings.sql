-- =============================================================================
-- Migration: Organization Settings Table
-- =============================================================================
--
-- Purpose:
--   Store organization-level settings for agent behavior, auto mode,
--   and content preferences.
--
-- Security:
--   - RLS ensures each org can only access their own settings
--   - Only admins/owners can update settings
--
-- =============================================================================

-- Create org_settings table
CREATE TABLE IF NOT EXISTS org_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Agent mode settings
    auto_draft_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    auto_send_enabled BOOLEAN DEFAULT FALSE NOT NULL,
    auto_send_risk_threshold TEXT DEFAULT 'none' CHECK (auto_send_risk_threshold IN ('none', 'low', 'medium')),
    auto_send_allowed_domains TEXT[] DEFAULT ARRAY[]::TEXT[],
    auto_send_allowed_recipients TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- Rate limits
    daily_send_limit INTEGER DEFAULT 50 NOT NULL CHECK (daily_send_limit >= 0 AND daily_send_limit <= 1000),
    daily_run_limit INTEGER DEFAULT 100 NOT NULL CHECK (daily_run_limit >= 0 AND daily_run_limit <= 10000),

    -- Approval settings
    require_approval_tools TEXT[] DEFAULT ARRAY['send_email']::TEXT[],
    min_confidence_threshold TEXT DEFAULT 'medium' CHECK (min_confidence_threshold IN ('very_low', 'low', 'medium', 'high', 'very_high')),

    -- Content settings
    default_tone TEXT DEFAULT 'professional' CHECK (default_tone IN ('formal', 'casual', 'professional', 'friendly')),
    signature_template TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Unique constraint
    CONSTRAINT org_settings_org_unique UNIQUE (organization_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS org_settings_org_id_idx ON org_settings(organization_id);

-- Enable RLS
ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Members can view settings
CREATE POLICY "org_settings_select_policy" ON org_settings
    FOR SELECT
    USING (is_org_member(organization_id));

-- Admins/Owners can insert/update settings
CREATE POLICY "org_settings_insert_policy" ON org_settings
    FOR INSERT
    WITH CHECK (has_org_role(organization_id, 'admin'));

CREATE POLICY "org_settings_update_policy" ON org_settings
    FOR UPDATE
    USING (has_org_role(organization_id, 'admin'))
    WITH CHECK (has_org_role(organization_id, 'admin'));

-- Only owners can delete settings (rare operation)
CREATE POLICY "org_settings_delete_policy" ON org_settings
    FOR DELETE
    USING (has_org_role(organization_id, 'owner'));

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_org_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_settings_updated_at_trigger
    BEFORE UPDATE ON org_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_org_settings_updated_at();

-- Comments
COMMENT ON TABLE org_settings IS 'Organization-level settings for agent behavior and preferences';
COMMENT ON COLUMN org_settings.auto_draft_enabled IS 'Allow agent to automatically create drafts';
COMMENT ON COLUMN org_settings.auto_send_enabled IS 'Allow agent to send emails without approval for allowed domains/recipients';
COMMENT ON COLUMN org_settings.auto_send_risk_threshold IS 'Maximum risk level for auto-send (none, low, medium)';
COMMENT ON COLUMN org_settings.auto_send_allowed_domains IS 'Domains that can receive auto-sent emails';
COMMENT ON COLUMN org_settings.auto_send_allowed_recipients IS 'Specific email addresses that can receive auto-sent emails';
COMMENT ON COLUMN org_settings.daily_send_limit IS 'Maximum emails that can be auto-sent per day';
COMMENT ON COLUMN org_settings.require_approval_tools IS 'Tools that always require human approval';
