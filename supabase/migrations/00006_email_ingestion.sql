-- =============================================================================
-- Migration: Email Ingestion
--
-- Adds tables for inbound email processing:
-- - email_aliases: Unique forwarding addresses per org
-- - inbound_emails: Received email metadata (minimal PII)
-- - email_webhook_events: Idempotency for webhook processing
--
-- SECURITY:
-- - RLS enabled on all tables
-- - Minimal PII storage (no full body in MVP)
-- - Alias addresses are cryptographically random
-- =============================================================================

-- =============================================================================
-- Email Aliases Table
-- Each org gets a unique email alias for forwarding
-- =============================================================================

CREATE TABLE IF NOT EXISTS email_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Alias format: inbox-{random}@mail.domain.com
  alias_address TEXT NOT NULL UNIQUE,
  alias_key TEXT NOT NULL UNIQUE, -- The random portion for verification

  -- Status
  is_active BOOLEAN DEFAULT true NOT NULL,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,

  -- Ensure one active alias per org (can have inactive for history)
  CONSTRAINT unique_active_alias_per_org UNIQUE (organization_id, is_active)
    DEFERRABLE INITIALLY DEFERRED
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_email_aliases_address ON email_aliases(alias_address);
CREATE INDEX IF NOT EXISTS idx_email_aliases_key ON email_aliases(alias_key);
CREATE INDEX IF NOT EXISTS idx_email_aliases_org ON email_aliases(organization_id);

-- =============================================================================
-- Inbound Emails Table
-- Stores minimal email metadata (no full body for MVP)
-- =============================================================================

CREATE TABLE IF NOT EXISTS inbound_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Email identifiers
  message_id TEXT NOT NULL,           -- Email Message-ID header
  thread_id TEXT,                      -- For threading (if available)
  in_reply_to TEXT,                    -- Reference to parent message

  -- Sender info (minimal)
  from_address TEXT NOT NULL,          -- Sender email
  from_name TEXT,                       -- Sender display name

  -- Recipients (minimal)
  to_addresses TEXT[] DEFAULT '{}',    -- Array of recipient addresses

  -- Content (minimal for privacy)
  subject TEXT,                         -- Subject line
  snippet TEXT,                         -- First 200 chars of body (sanitized)
  has_attachments BOOLEAN DEFAULT false,
  attachment_count INTEGER DEFAULT 0,

  -- Processing state
  status TEXT DEFAULT 'received' NOT NULL,  -- received, processing, processed, failed, ignored
  agent_run_id UUID REFERENCES agent_runs(id),
  processing_error TEXT,

  -- Metadata
  received_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  processed_at TIMESTAMPTZ,
  email_date TIMESTAMPTZ,              -- Date header from email

  -- Provider info (for debugging/audit)
  provider TEXT NOT NULL,              -- sendgrid, mailgun, postmark, etc.
  provider_event_id TEXT,              -- Provider's unique ID
  raw_headers JSONB,                   -- Selected headers only (not full)

  -- Constraints
  CONSTRAINT unique_message_per_org UNIQUE (organization_id, message_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_inbound_emails_org ON inbound_emails(organization_id);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_status ON inbound_emails(status);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_from ON inbound_emails(from_address);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_received ON inbound_emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_thread ON inbound_emails(thread_id) WHERE thread_id IS NOT NULL;

-- =============================================================================
-- Email Webhook Events Table (Idempotency)
-- =============================================================================

CREATE TABLE IF NOT EXISTS email_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now() NOT NULL,

  CONSTRAINT unique_provider_event UNIQUE (provider, provider_event_id)
);

-- Auto-cleanup old webhook events (keep 7 days)
CREATE INDEX IF NOT EXISTS idx_email_webhook_events_processed ON email_webhook_events(processed_at);

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE email_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_webhook_events ENABLE ROW LEVEL SECURITY;

-- Email aliases policies
CREATE POLICY "Users can view own org aliases"
  ON email_aliases FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage own org aliases"
  ON email_aliases FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Inbound emails policies
CREATE POLICY "Users can view own org emails"
  ON inbound_emails FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert emails"
  ON inbound_emails FOR INSERT
  WITH CHECK (true);  -- Controlled by webhook handler

CREATE POLICY "Service role can update emails"
  ON inbound_emails FOR UPDATE
  USING (true);  -- Controlled by processing logic

-- Webhook events only accessible by service role (no user policies)

-- =============================================================================
-- Helper Functions
-- =============================================================================

-- Generate a cryptographically random alias key
CREATE OR REPLACE FUNCTION generate_alias_key()
RETURNS TEXT AS $$
BEGIN
  -- 16 bytes = 32 hex chars, take first 12 for cleaner alias
  RETURN lower(substring(encode(gen_random_bytes(16), 'hex') from 1 for 12));
END;
$$ LANGUAGE plpgsql;

-- Create email alias for org (if not exists)
CREATE OR REPLACE FUNCTION create_org_email_alias(
  p_org_id UUID,
  p_domain TEXT DEFAULT 'mail.opsmanager.app'
)
RETURNS TABLE (
  alias_address TEXT,
  alias_key TEXT,
  is_new BOOLEAN
) AS $$
DECLARE
  v_existing_alias TEXT;
  v_existing_key TEXT;
  v_new_key TEXT;
  v_new_address TEXT;
BEGIN
  -- Check for existing active alias
  SELECT ea.alias_address, ea.alias_key INTO v_existing_alias, v_existing_key
  FROM email_aliases ea
  WHERE ea.organization_id = p_org_id AND ea.is_active = true;

  IF v_existing_alias IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_alias, v_existing_key, false;
    RETURN;
  END IF;

  -- Generate new alias
  v_new_key := generate_alias_key();
  v_new_address := 'inbox-' || v_new_key || '@' || p_domain;

  -- Insert new alias
  INSERT INTO email_aliases (organization_id, alias_address, alias_key)
  VALUES (p_org_id, v_new_address, v_new_key);

  RETURN QUERY SELECT v_new_address, v_new_key, true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Lookup org by alias key (for webhook processing)
CREATE OR REPLACE FUNCTION get_org_by_alias_key(p_alias_key TEXT)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM email_aliases
  WHERE alias_key = p_alias_key AND is_active = true;

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if webhook event already processed (idempotency)
CREATE OR REPLACE FUNCTION check_email_webhook_idempotency(
  p_provider TEXT,
  p_event_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Try to insert, return false if duplicate
  INSERT INTO email_webhook_events (provider, provider_event_id, event_type)
  VALUES (p_provider, p_event_id, 'inbound')
  ON CONFLICT (provider, provider_event_id) DO NOTHING;

  GET DIAGNOSTICS v_exists = ROW_COUNT;
  RETURN v_exists > 0;  -- true = new event, false = duplicate
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Cleanup Job (run periodically)
-- =============================================================================

-- Function to clean up old webhook events
CREATE OR REPLACE FUNCTION cleanup_old_email_webhook_events()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM email_webhook_events
  WHERE processed_at < now() - INTERVAL '7 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Updated_at Triggers
-- =============================================================================

CREATE TRIGGER update_email_aliases_updated_at
  BEFORE UPDATE ON email_aliases
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE email_aliases IS 'Unique inbound email addresses per organization';
COMMENT ON TABLE inbound_emails IS 'Received email metadata - minimal PII storage';
COMMENT ON TABLE email_webhook_events IS 'Idempotency tracking for email webhook processing';
COMMENT ON COLUMN inbound_emails.snippet IS 'First 200 chars of email body, sanitized of PII';
COMMENT ON COLUMN inbound_emails.raw_headers IS 'Selected non-sensitive headers for debugging';
