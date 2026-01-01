# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in Ops Manager, please report it responsibly:

1. **DO NOT** create a public GitHub issue
2. Email security concerns to: security@opsmanager.app
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes

We aim to respond within 48 hours and will keep you updated on remediation progress.

## Security Architecture

### Authentication
- **Provider**: Supabase Auth (Gotrue)
- **Method**: Email/password with optional OAuth
- **Sessions**: JWT tokens in HTTP-only, Secure, SameSite=Lax cookies
- **Refresh**: Automatic session refresh via middleware

### Authorization
- **Model**: Role-Based Access Control (RBAC)
- **Roles**: Owner > Admin > Member > Viewer
- **Enforcement**: Row-Level Security (RLS) at database level
- **Verification**: Server-side org membership checks on every request

### Multi-Tenancy
- All data is scoped to organizations
- RLS policies enforce tenant isolation at the database level
- Organization ID is verified server-side, never trusted from client
- Cross-tenant access is cryptographically prevented

## Security Controls

### Input Validation
- Zod schema validation for environment variables
- Type-safe database queries via Supabase client
- No raw SQL queries
- Structured parsing of webhook payloads

### Output Encoding
- React's automatic XSS protection for rendered content
- No dangerouslySetInnerHTML usage
- CSP headers prevent inline script execution

### Cryptographic Controls
- Webhook signatures verified using timing-safe comparison
- HTTPS enforced via HSTS header
- Service role key never exposed to client
- Email aliases use cryptographically random identifiers

### Rate Limiting
- Per-organization usage tracking
- Daily limits on runs and sends
- Atomic increment with limit check
- Fail-closed on database errors

### Logging & Monitoring
- Structured JSON logging in production
- Audit logs for all significant actions
- Append-only audit table (no updates/deletes)
- No PII in log entries

## Secure Headers

The following security headers are configured:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...
```

## Secrets Management

### Environment Variables
| Variable | Purpose | Exposure |
|----------|---------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (RLS-protected) | Client |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS (DANGER) | Server only |
| `STRIPE_SECRET_KEY` | Stripe API access | Server only |
| `STRIPE_WEBHOOK_SECRET` | Webhook verification | Server only |
| `EMAIL_WEBHOOK_SECRET` | Email webhook verification | Server only |

### Secret Protection
- Server-only secrets use `server-only` package to prevent client bundling
- Environment validation at startup via Zod
- Build fails if server secrets accessed in client code
- `.env.local` excluded from git

## Webhook Security

### Stripe Webhooks
- Signature verified using `stripe.webhooks.constructEvent()`
- Raw body used for signature verification
- Idempotent processing via event ID tracking
- Events stored in `billing_events` table

### Email Webhooks
- Provider-specific signature verification
  - SendGrid: Custom header or bearer token
  - Mailgun: HMAC-SHA256 with timestamp validation
  - Postmark: Token header or basic auth
- Timestamp validation prevents replay attacks (5 min window)
- Idempotent processing via `email_webhook_events` table
- Timing-safe string comparison for all secrets

## Database Security

### Row-Level Security (RLS)
All tables have RLS enabled with organization-scoped policies:

- `organizations` - Users can only view/update their own org
- `profiles` - Users can view org members, update only self
- `audit_logs` - Append-only (no update/delete policies)
- `tasks`, `contacts`, `agent_runs` - Full CRUD with org isolation
- `approvals` - Members can create, admins can respond
- `integrations` - Admins can manage

### Security Functions
```sql
-- Org membership check (used in RLS)
is_org_member(check_org_id UUID) → BOOLEAN

-- Role hierarchy check
has_org_role(check_org_id UUID, required_role user_role) → BOOLEAN

-- Current org context
get_current_org_id() → UUID
```

## Compliance Considerations

### Data Minimization
- Email content not stored (only metadata + redacted snippet)
- PII patterns (SSN, CC, phone) automatically redacted
- Integration tokens stored as vault references (planned)

### Audit Trail
- All significant actions logged
- Immutable audit log (triggers prevent modification)
- Includes actor, action, resource, timestamp, metadata

### Data Retention
- Email webhook events auto-cleaned after 7 days
- Audit logs retained indefinitely
- User data removed on account deletion (cascade)

## Dependency Security

Run dependency audit regularly:
```bash
pnpm audit
```

Current status (as of last audit):
- Critical: 0
- High: 1 (dev-only, glob CLI - not exploitable in this project)
- Moderate: 1 (dev-only, esbuild - only affects dev server)
- Low: 0

## Incident Response

### If You Suspect a Breach
1. Immediately rotate affected secrets
2. Review audit logs for unauthorized access
3. Notify affected users if required
4. Document timeline and remediation

### Key Rotation Procedure
1. Generate new secret in provider dashboard
2. Update environment variable
3. Deploy updated configuration
4. Verify new secret is active
5. Revoke old secret

## Security Checklist for Development

### Before Merging Code
- [ ] No secrets in code or comments
- [ ] RLS policies cover new tables
- [ ] Server actions verify org membership
- [ ] Input validation on all user data
- [ ] Error messages don't leak sensitive info
- [ ] New dependencies audited (`pnpm audit`)

### Before Deployment
- [ ] All environment variables set
- [ ] Webhook secrets configured in provider
- [ ] Database migrations applied
- [ ] RLS policies tested
- [ ] Security headers verified

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-01 | Initial security policy |
