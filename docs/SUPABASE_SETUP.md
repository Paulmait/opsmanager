# Supabase Setup Guide

Complete setup instructions for Ops Manager database and edge functions.

## Quick Start - SQL Editor (Recommended)

For fastest setup, run these migrations in order in the Supabase SQL Editor.

### Step 1: Go to SQL Editor

1. Open your Supabase Dashboard
2. Navigate to **SQL Editor** in the left sidebar
3. Click **New Query**

### Step 2: Run Migrations in Order

Copy and run each migration file in sequence:

1. `supabase/migrations/00001_initial_schema.sql` - Core tables (organizations, profiles, audit_logs)
2. `supabase/migrations/00002_extended_schema.sql` - Extended tables (contacts, tasks, approvals, etc.)
3. `supabase/migrations/00003_idempotency_keys.sql` - Idempotency support
4. `supabase/migrations/00004_org_settings.sql` - Organization settings
5. `supabase/migrations/00005_billing.sql` - Billing and usage tracking
6. `supabase/migrations/00006_email_ingestion.sql` - Email ingestion tables

---

## Table Editor Setup (Manual)

If you prefer using the Table Editor UI, follow these steps:

### Core Tables

#### 1. Organizations Table

**Table Name:** `organizations`

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| id | uuid | gen_random_uuid() | No | Primary Key |
| name | text | | No | |
| plan | text | 'free' | No | free/starter/pro/agency |
| plan_limits | jsonb | '{}' | No | Plan entitlements |
| stripe_customer_id | text | | Yes | Unique |
| stripe_subscription_id | text | | Yes | Unique |
| subscription_status | text | 'none' | Yes | none/active/past_due/canceled/trialing |
| subscription_period_end | timestamptz | | Yes | |
| billing_email | text | | Yes | |
| created_at | timestamptz | now() | No | |
| updated_at | timestamptz | now() | No | |

**RLS:** Enable RLS and create policies per migration file.

#### 2. Profiles Table

**Table Name:** `profiles`

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| id | uuid | | No | Primary Key, References auth.users(id) |
| organization_id | uuid | | No | References organizations(id) |
| email | text | | No | |
| full_name | text | | Yes | |
| role | user_role | 'member' | No | owner/admin/member/viewer |
| created_at | timestamptz | now() | No | |
| updated_at | timestamptz | now() | No | |

#### 3. Audit Logs Table

**Table Name:** `audit_logs`

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| id | uuid | gen_random_uuid() | No | Primary Key |
| organization_id | uuid | | No | References organizations(id) |
| actor_id | uuid | | No | References profiles(id) |
| action | text | | No | |
| resource_type | text | | No | |
| resource_id | text | | Yes | |
| metadata | jsonb | | Yes | |
| ip_address | inet | | Yes | |
| user_agent | text | | Yes | |
| request_id | text | | Yes | |
| duration_ms | integer | | Yes | |
| severity | text | 'info' | Yes | |
| created_at | timestamptz | now() | No | |

### Extended Tables

#### 4. Contacts Table

**Table Name:** `contacts`

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| id | uuid | gen_random_uuid() | No | Primary Key |
| organization_id | uuid | | No | References organizations(id) |
| email | text | | Yes | |
| full_name | text | | Yes | |
| company | text | | Yes | |
| job_title | text | | Yes | |
| phone | text | | Yes | |
| tags | text[] | '{}' | No | |
| source | text | | Yes | |
| notes | text | | Yes | |
| custom_fields | jsonb | '{}' | No | |
| created_by | uuid | | Yes | References profiles(id) |
| assigned_to | uuid | | Yes | References profiles(id) |
| last_contacted_at | timestamptz | | Yes | |
| created_at | timestamptz | now() | No | |
| updated_at | timestamptz | now() | No | |

#### 5. Tasks Table

**Table Name:** `tasks`

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| id | uuid | gen_random_uuid() | No | Primary Key |
| organization_id | uuid | | No | References organizations(id) |
| title | text | | No | |
| description | text | | Yes | |
| status | task_status | 'pending' | No | |
| priority | task_priority | 'medium' | No | |
| parent_task_id | uuid | | Yes | Self-reference |
| contact_id | uuid | | Yes | References contacts(id) |
| created_by | uuid | | No | References profiles(id) |
| assigned_to | uuid | | Yes | References profiles(id) |
| due_at | timestamptz | | Yes | |
| started_at | timestamptz | | Yes | |
| completed_at | timestamptz | | Yes | |
| agent_run_id | uuid | | Yes | References agent_runs(id) |
| requires_approval | boolean | false | No | |
| metadata | jsonb | '{}' | No | |
| created_at | timestamptz | now() | No | |
| updated_at | timestamptz | now() | No | |

#### 6. Agent Runs Table

**Table Name:** `agent_runs`

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| id | uuid | gen_random_uuid() | No | Primary Key |
| organization_id | uuid | | No | References organizations(id) |
| agent_type | text | | No | |
| status | agent_run_status | 'queued' | No | |
| input_data | jsonb | '{}' | No | |
| output_data | jsonb | | Yes | |
| error_message | text | | Yes | |
| task_id | uuid | | Yes | References tasks(id) |
| triggered_by | uuid | | No | References profiles(id) |
| requires_approval | boolean | true | No | |
| approval_id | uuid | | Yes | References approvals(id) |
| queued_at | timestamptz | now() | No | |
| started_at | timestamptz | | Yes | |
| completed_at | timestamptz | | Yes | |
| tokens_used | integer | | Yes | |
| cost_cents | integer | | Yes | |
| created_at | timestamptz | now() | No | |
| updated_at | timestamptz | now() | No | |

#### 7. Approvals Table

**Table Name:** `approvals`

| Column | Type | Default | Nullable | Notes |
|--------|------|---------|----------|-------|
| id | uuid | gen_random_uuid() | No | Primary Key |
| organization_id | uuid | | No | References organizations(id) |
| agent_run_id | uuid | | No | References agent_runs(id) |
| action_type | text | | No | |
| action_summary | text | | No | |
| action_details | jsonb | '{}' | No | |
| status | approval_status | 'pending' | No | |
| requested_by | uuid | | No | References profiles(id) |
| requested_at | timestamptz | now() | No | |
| responded_by | uuid | | Yes | References profiles(id) |
| responded_at | timestamptz | | Yes | |
| response_note | text | | Yes | |
| expires_at | timestamptz | | Yes | |
| decision_reason | text | | Yes | |
| created_at | timestamptz | now() | No | |
| updated_at | timestamptz | now() | No | |

---

## Required ENUM Types

Create these types before creating tables:

```sql
-- User roles
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member', 'viewer');

-- Membership status
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
```

---

## Edge Functions Setup

### 1. Deploy Edge Functions

From the project root:

```bash
# Link to your Supabase project
supabase link --project-ref uihrqbaidkyhkropbwvx

# Deploy all functions
supabase functions deploy run-agent
supabase functions deploy approve-action
supabase functions deploy weekly-report
```

### 2. Set Environment Variables

In Supabase Dashboard > Project Settings > Edge Functions:

```
SUPABASE_URL=https://uihrqbaidkyhkropbwvx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

### 3. Test Edge Functions

```bash
# Test run-agent
curl -X POST 'https://uihrqbaidkyhkropbwvx.supabase.co/functions/v1/run-agent' \
  -H 'Authorization: Bearer <user-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{
    "org_id": "<org-uuid>",
    "trigger_payload": {
      "goal": "Create a test task",
      "max_actions": 5
    }
  }'
```

---

## Database Functions (SQL Editor)

### Key Functions to Create

These are created by the migrations, but here are the key ones:

```sql
-- Get current user's organization ID
CREATE OR REPLACE FUNCTION get_current_org_id()
RETURNS UUID AS $$
    SELECT organization_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check organization membership
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

-- Check role hierarchy
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

-- Increment usage atomically
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
LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Verification Queries

Run these after setup to verify:

```sql
-- Check all tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';

-- Check enum types exist
SELECT typname FROM pg_type
WHERE typtype = 'e'
AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- Check functions exist
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public';
```

---

## Troubleshooting

### Common Issues

1. **RLS blocking inserts**
   - Ensure user is authenticated
   - Check profile exists for user
   - Verify organization membership

2. **Function not found**
   - Run migrations in order
   - Check function exists with verification query

3. **Edge function 401**
   - Verify JWT is valid
   - Check SUPABASE_SERVICE_ROLE_KEY is set

4. **Type errors**
   - Run ENUM type creation first
   - Check for existing conflicting types

### Reset Database (Development Only)

```sql
-- Drop all tables (DANGEROUS - development only)
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- Then re-run migrations
```
