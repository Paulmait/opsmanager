-- =============================================================================
-- Migration: Idempotency Keys Table
-- =============================================================================
--
-- Purpose:
--   Store idempotency keys for Edge Function deduplication.
--   Prevents duplicate execution of the same request.
--
-- Security:
--   - No RLS needed (only accessed by service role from Edge Functions)
--   - Keys are hashed to prevent information leakage
--   - Automatic cleanup of expired keys
--
-- =============================================================================

-- Idempotency keys table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Index for fast lookups
    CONSTRAINT idempotency_keys_key_idx UNIQUE (key)
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx
    ON idempotency_keys (created_at);

-- Comment on table
COMMENT ON TABLE idempotency_keys IS
    'Stores idempotency keys for Edge Function request deduplication';

COMMENT ON COLUMN idempotency_keys.key IS
    'SHA-256 hash of function name + org_id + payload';

COMMENT ON COLUMN idempotency_keys.response IS
    'Cached response for replay on duplicate requests';

-- =============================================================================
-- Cleanup Function
-- =============================================================================

-- Function to clean up expired idempotency keys
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys(
    retention_hours INT DEFAULT 24
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count INT;
BEGIN
    DELETE FROM idempotency_keys
    WHERE created_at < NOW() - (retention_hours || ' hours')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$;

-- Comment on function
COMMENT ON FUNCTION cleanup_expired_idempotency_keys IS
    'Removes idempotency keys older than retention_hours (default 24)';

-- =============================================================================
-- Scheduled Cleanup (Optional - requires pg_cron extension)
-- =============================================================================

-- Uncomment if pg_cron is available:
-- SELECT cron.schedule(
--     'cleanup-idempotency-keys',
--     '0 * * * *',  -- Every hour
--     $$ SELECT cleanup_expired_idempotency_keys(24) $$
-- );

-- =============================================================================
-- Additional Indexes for agent_runs and approvals
-- =============================================================================

-- Index for rate limit queries on agent_runs
CREATE INDEX IF NOT EXISTS agent_runs_org_created_idx
    ON agent_runs (organization_id, created_at DESC);

-- Index for rate limit queries on approvals
CREATE INDEX IF NOT EXISTS approvals_org_status_created_idx
    ON approvals (organization_id, status, created_at DESC);

-- Index for pending approvals lookup
CREATE INDEX IF NOT EXISTS approvals_pending_idx
    ON approvals (organization_id, status)
    WHERE status = 'pending';

-- =============================================================================
-- Update approvals table with additional fields for Edge Functions
-- =============================================================================

-- Add expires_at column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'approvals' AND column_name = 'expires_at'
    ) THEN
        ALTER TABLE approvals ADD COLUMN expires_at TIMESTAMPTZ;
    END IF;
END $$;

-- Add decision_reason column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'approvals' AND column_name = 'decision_reason'
    ) THEN
        ALTER TABLE approvals ADD COLUMN decision_reason TEXT;
    END IF;
END $$;

-- Add index for expired approvals cleanup
CREATE INDEX IF NOT EXISTS approvals_expires_at_idx
    ON approvals (expires_at)
    WHERE status = 'pending';

-- =============================================================================
-- Function to expire old pending approvals
-- =============================================================================

CREATE OR REPLACE FUNCTION expire_pending_approvals()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    expired_count INT;
BEGIN
    UPDATE approvals
    SET status = 'expired'
    WHERE status = 'pending'
    AND expires_at < NOW();

    GET DIAGNOSTICS expired_count = ROW_COUNT;

    RETURN expired_count;
END;
$$;

COMMENT ON FUNCTION expire_pending_approvals IS
    'Marks pending approvals as expired if past their expires_at time';
