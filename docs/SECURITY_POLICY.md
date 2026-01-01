# Ops Manager Security Policy

## Overview

This document outlines the security architecture, policies, and best practices implemented in Ops Manager. All security measures follow the principle of **defense in depth** with multiple layers of protection.

---

## Table of Contents

1. [Authentication & Authorization](#authentication--authorization)
2. [Row Level Security (RLS)](#row-level-security-rls)
3. [API Security](#api-security)
4. [Data Protection](#data-protection)
5. [Audit & Compliance](#audit--compliance)
6. [Infrastructure Security](#infrastructure-security)
7. [Security Checklist](#security-checklist)
8. [Incident Response](#incident-response)

---

## Authentication & Authorization

### Authentication Flow

```
User → Supabase Auth → JWT Token → API/Edge Functions → RLS Verification → Data
```

### Key Principles

1. **Supabase Auth** handles all authentication
2. **JWTs** are short-lived (1 hour default) with refresh tokens
3. **Service Role Key** is NEVER exposed to client
4. **Anon Key** is safe for client - all data protected by RLS

### Role Hierarchy

| Role | Level | Capabilities |
|------|-------|--------------|
| `owner` | 4 | Full organization control, billing, delete org |
| `admin` | 3 | Manage members, approve actions, view audit logs |
| `member` | 2 | Create/edit own content, run agents |
| `viewer` | 1 | Read-only access to organization data |

### Best Practices

- [ ] Enable MFA for all admin/owner accounts
- [ ] Use SSO for enterprise deployments
- [ ] Review member roles quarterly
- [ ] Disable unused accounts immediately

---

## Row Level Security (RLS)

### RLS Architecture

Every table has RLS enabled with policies that enforce:

1. **Organization Isolation** - Users can only access data in their organization
2. **Role-Based Access** - Operations restricted by user role
3. **Ownership Rules** - Some operations limited to resource creator

### Policy Pattern

```sql
-- Standard SELECT policy pattern
CREATE POLICY "policy_name" ON table_name
    FOR SELECT
    USING (is_org_member(organization_id));

-- Role-restricted policy pattern
CREATE POLICY "policy_name" ON table_name
    FOR UPDATE
    USING (has_org_role(organization_id, 'admin'));
```

### Tables with RLS

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `organizations` | Org members | Service role only | Owners only | Not allowed |
| `profiles` | Org members | Trigger only | Own profile / Owners | Not allowed |
| `audit_logs` | Org members | Admins + Service role | Not allowed | Not allowed |
| `tasks` | Org members | Members+ | Creator/Assignee/Admin | Admins only |
| `contacts` | Org members | Members+ | Members+ | Admins only |
| `agent_runs` | Org members | Members+ | Creator/Admin | Owners only |
| `approvals` | Org members | Members+ | Admins only | Owners only |
| `billing_events` | Service role only | Service role only | Service role only | Service role only |
| `usage_tracking` | Org members (read) | Service role only | Service role only | Not allowed |

### Security Functions

| Function | Purpose | Security |
|----------|---------|----------|
| `get_current_org_id()` | Get user's org ID | SECURITY DEFINER, SET search_path |
| `is_org_member(org_id)` | Check org membership | SECURITY DEFINER, SET search_path |
| `has_org_role(org_id, role)` | Check role hierarchy | SECURITY DEFINER, SET search_path |
| `handle_new_user()` | Create org/profile on signup | SECURITY DEFINER, trigger only |

---

## API Security

### Edge Function Security

```typescript
// All edge functions follow this pattern:
1. Verify JWT (Authorization header)
2. Validate input with Zod schemas
3. Verify org membership
4. Check required role
5. Enforce rate limits
6. Execute operation
7. Log to audit trail
```

### Rate Limits

| Resource | Free Plan | Starter | Pro | Agency |
|----------|-----------|---------|-----|--------|
| Runs/day | 10 | 100 | 1,000 | 10,000 |
| Sends/day | 5 | 50 | 500 | 5,000 |
| Actions/run | 5 | 10 | 20 | 50 |

### Idempotency

All mutating operations support idempotency keys:
- Client provides `Idempotency-Key` header
- Server caches response for 24 hours
- Duplicate requests return cached response

### CORS Configuration

```typescript
// Allowed origins (configure per environment)
const ALLOWED_ORIGINS = [
  'https://your-app.com',
  'https://app.your-app.com',
];

// Local development only
if (process.env.NODE_ENV === 'development') {
  ALLOWED_ORIGINS.push('http://localhost:3000');
}
```

### Webhook Security

All webhooks verify signatures:

```typescript
// Stripe webhook verification
const sig = req.headers.get('stripe-signature');
const event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);

// Email webhook HMAC verification
const expectedSig = crypto.createHmac('sha256', EMAIL_WEBHOOK_SECRET)
  .update(body)
  .digest('hex');
```

---

## Data Protection

### Sensitive Data Handling

| Data Type | Storage | Encryption | Access |
|-----------|---------|------------|--------|
| Passwords | Never stored | N/A | Supabase Auth |
| API Keys | Vault | AES-256 | Service role only |
| PII (email, name) | Database | TLS in transit | RLS restricted |
| Audit logs | Immutable table | TLS in transit | Read-only |
| Billing data | Stripe | Stripe encryption | Service role only |

### Data Minimization

- Email snippets truncated to 200 chars
- No full email bodies stored
- Headers filtered for non-sensitive only
- Attachments referenced, not stored

### Encryption

- **In Transit**: TLS 1.3 for all connections
- **At Rest**: Supabase encrypts all data at rest
- **Secrets**: Use Supabase Vault for API keys/tokens

---

## Audit & Compliance

### Audit Log Schema

```sql
audit_logs (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    action TEXT NOT NULL,          -- e.g., 'task.create', 'approval.approve'
    resource_type TEXT NOT NULL,   -- e.g., 'task', 'approval'
    resource_id TEXT,              -- UUID of affected resource
    metadata JSONB,                -- Additional context
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ
)
```

### Audit Immutability

Audit logs are **append-only**:
- UPDATE trigger raises exception
- DELETE trigger raises exception
- No policies allow modification
- Backups retained per retention policy

### Logged Actions

| Category | Actions |
|----------|---------|
| Auth | login, logout, password_change, mfa_enable |
| Tasks | create, update, complete, assign, delete |
| Agents | run.start, run.complete, run.error |
| Approvals | request, approve, reject, expire |
| Billing | subscription.create, payment.success, payment.failed |
| Admin | member.invite, member.remove, role.change |

---

## Infrastructure Security

### Supabase Configuration

```toml
[auth]
jwt_expiry = 3600                    # 1 hour
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10    # Detect token theft

[auth.email]
double_confirm_changes = true        # Confirm email changes
enable_confirmations = true          # Verify email on signup
```

### HTTP Security Headers

```typescript
// next.config.mjs
headers: [
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com;"
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
]
```

### Environment Variables

| Variable | Exposure | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anonymous API key (RLS protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypasses RLS - never expose |
| `STRIPE_SECRET_KEY` | **Server only** | Stripe API access |
| `STRIPE_WEBHOOK_SECRET` | **Server only** | Webhook signature verification |
| `EMAIL_WEBHOOK_SECRET` | **Server only** | Email webhook HMAC verification |

---

## Security Checklist

### Pre-Deployment

- [ ] All environment variables set in production
- [ ] Service role key NOT in client bundle
- [ ] RLS enabled on ALL tables
- [ ] HTTPS enforced (redirect HTTP)
- [ ] CSP headers configured
- [ ] Rate limiting enabled
- [ ] Audit logging verified
- [ ] Backup strategy in place

### Regular Review (Monthly)

- [ ] Review user access and roles
- [ ] Check for unused accounts
- [ ] Review audit logs for anomalies
- [ ] Update dependencies (npm audit)
- [ ] Review Supabase Security Advisor
- [ ] Test disaster recovery

### Incident Triggers

- [ ] Unusual login patterns detected
- [ ] Rate limit consistently hit
- [ ] Failed payment attempts
- [ ] Elevated error rates
- [ ] Unauthorized access attempts

---

## Incident Response

### Severity Levels

| Level | Description | Response Time |
|-------|-------------|---------------|
| P1 - Critical | Data breach, service down | Immediate |
| P2 - High | Security vulnerability, major bug | < 4 hours |
| P3 - Medium | Performance issue, minor bug | < 24 hours |
| P4 - Low | UI issues, minor improvements | Next sprint |

### Response Procedure

1. **Detect** - Automated monitoring or user report
2. **Assess** - Determine severity and scope
3. **Contain** - Isolate affected systems
4. **Eradicate** - Remove threat/fix vulnerability
5. **Recover** - Restore normal operations
6. **Review** - Post-incident analysis

### Emergency Contacts

```
Security Lead: [Configure in production]
On-Call: [Configure in production]
Supabase Support: support@supabase.io
```

### Key Revocation

If keys are compromised:

1. **Supabase Dashboard** → Settings → API → Regenerate keys
2. Update `.env.local` / environment variables
3. Redeploy all services
4. Invalidate all active sessions
5. Review audit logs for unauthorized access

---

## Compliance Considerations

### GDPR

- User data export available via API
- Right to deletion implemented
- Consent tracked in audit logs
- Data minimization practiced

### SOC 2

- Audit logs maintained
- Access controls enforced
- Encryption in transit/at rest
- Incident response documented

### HIPAA (if applicable)

- BAA required with Supabase
- Additional encryption may be needed
- Audit log retention extended
- Access logging enhanced

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-01-01 | Initial security policy |

---

## Questions?

For security concerns or to report vulnerabilities, contact the security team or create a confidential issue.
