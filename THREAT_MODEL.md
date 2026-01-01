# Threat Model - Ops Manager

This document outlines the security threat model for the Ops Manager multi-tenant SaaS application.

## 1. System Overview

Ops Manager is a multi-tenant SaaS platform that enables organizations to automate operations through AI agents. The system processes inbound emails, executes AI-driven workflows, and integrates with external services.

### Architecture Components
- **Frontend**: Next.js App Router (React Server Components)
- **Backend**: Next.js API Routes + Server Actions
- **Database**: Supabase (PostgreSQL with RLS)
- **Authentication**: Supabase Auth (JWT-based)
- **Billing**: Stripe integration
- **Email Ingestion**: Webhook handlers (SendGrid/Mailgun/Postmark)

## 2. Assets

### Critical Assets (Tier 1)
| Asset | Description | CIA Priority |
|-------|-------------|--------------|
| User credentials | Passwords, session tokens | C, I |
| API keys & secrets | Stripe keys, webhook secrets, service role key | C |
| Organization data | All tenant-specific business data | C, I, A |
| Email content | Inbound email metadata and snippets | C, I |
| Billing information | Stripe customer/subscription IDs | C, I |

### Important Assets (Tier 2)
| Asset | Description | CIA Priority |
|-------|-------------|--------------|
| Agent run history | AI execution logs and outputs | C, I |
| Audit logs | Security and operational audit trail | I, A |
| Approval workflows | Pending actions awaiting approval | I, A |
| Integration tokens | OAuth tokens for third-party services | C |

### Standard Assets (Tier 3)
| Asset | Description | CIA Priority |
|-------|-------------|--------------|
| User profiles | Names, emails, roles | C |
| Contacts | CRM contact data | C |
| Tasks | Workflow task data | I, A |

## 3. Threat Actors

### External Threats
| Actor | Motivation | Capability |
|-------|------------|------------|
| **Opportunistic Attacker** | Data theft, ransom | Low-Medium |
| **Competitor** | Industrial espionage | Medium |
| **Malicious User** | Abuse free tier, data exfiltration | Low |
| **Script Kiddie** | Vandalism, notoriety | Low |
| **Nation State** | Espionage (if high-value targets) | High |

### Internal Threats
| Actor | Motivation | Capability |
|-------|------------|------------|
| **Malicious Employee** | Data theft, sabotage | High |
| **Compromised Admin** | Account takeover | High |
| **Negligent User** | Accidental exposure | Low |

## 4. Attack Vectors & Mitigations

### 4.1 Authentication & Session

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| Credential stuffing | High | Supabase Auth with rate limiting | Implemented |
| Session hijacking | High | HTTP-only cookies, Secure flag, SameSite=Lax | Implemented |
| Session fixation | Medium | Session regeneration on login | Implemented (Supabase) |
| Weak password | Medium | Password requirements in Supabase Auth | Implemented |
| MFA bypass | Medium | MFA support available | Not enabled (roadmap) |

### 4.2 Authorization & Access Control

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| Privilege escalation | Critical | RLS policies, role hierarchy checks | Implemented |
| Tenant data leakage | Critical | Organization-scoped RLS on all tables | Implemented |
| IDOR | High | UUID-based IDs, RLS verification | Implemented |
| Broken function-level access | High | Role guards in server actions | Implemented |
| Cookie tampering (org context) | Medium | Server-side verification of org membership | Implemented |

### 4.3 Injection Attacks

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| SQL injection | Critical | Parameterized queries via Supabase client | Implemented |
| XSS (stored) | High | React auto-escaping, CSP headers | Implemented |
| XSS (reflected) | Medium | No raw HTML rendering | Implemented |
| NoSQL injection | N/A | Not applicable (PostgreSQL) | N/A |
| Command injection | High | No shell command execution | Implemented |
| Email header injection | Medium | Structured email parsing | Implemented |

### 4.4 Webhook Security

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| Spoofed webhooks | Critical | Signature verification per provider | Implemented |
| Replay attacks | High | Timestamp validation, idempotency keys | Implemented |
| Webhook flooding | Medium | Rate limiting on email processing | Implemented |
| Timing attacks | Low | Timing-safe comparison for secrets | Implemented |

### 4.5 API Security

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| Rate limit bypass | Medium | Per-org usage tracking, atomic increments | Implemented |
| API abuse | Medium | Plan-based limits, fail-closed | Implemented |
| Unauthorized API access | High | Session-based auth, RLS | Implemented |
| Mass assignment | Medium | Explicit field selection | Implemented |

### 4.6 Data Protection

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| PII exposure in logs | High | Structured logging, no sensitive data | Implemented |
| PII in email snippets | High | Redaction of SSN, CC, phone patterns | Implemented |
| Data at rest exposure | Medium | Supabase encryption, no raw tokens | Implemented |
| Backup exposure | Medium | Supabase managed backups | Delegated |

### 4.7 Infrastructure

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| SSRF | High | No user-controlled URLs in server requests | Implemented |
| Open redirects | Medium | Redirect validation in middleware | Implemented |
| Secrets in source | Critical | Env validation, .gitignore | Implemented |
| Insecure headers | Medium | Security headers in next.config.ts | Implemented |

### 4.8 Billing & Abuse

| Threat | Severity | Mitigation | Status |
|--------|----------|------------|--------|
| Plan spoofing | High | Server-side plan validation | Implemented |
| Webhook tampering | Critical | Stripe signature verification | Implemented |
| Free tier abuse | Medium | Usage limits, rate limiting | Implemented |
| Subscription bypass | High | Entitlement checks on every action | Implemented |

## 5. Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                      EXTERNAL ZONE                          │
│  - Public Internet                                          │
│  - Untrusted email providers                                │
│  - Third-party integrations                                 │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS / Webhook signatures
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       DMZ ZONE                              │
│  - Next.js middleware (session refresh)                     │
│  - API route handlers (input validation)                    │
│  - Webhook endpoints (signature verification)               │
└───────────────────────────┬─────────────────────────────────┘
                            │ Authenticated requests
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   APPLICATION ZONE                          │
│  - Server Components (RLS-protected queries)                │
│  - Server Actions (role-guarded operations)                 │
│  - Business logic (entitlement checks)                      │
└───────────────────────────┬─────────────────────────────────┘
                            │ Service role (admin only)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      DATA ZONE                              │
│  - Supabase PostgreSQL (RLS enforced)                       │
│  - Encrypted secrets (Supabase Vault - roadmap)             │
│  - Audit logs (append-only)                                 │
└─────────────────────────────────────────────────────────────┘
```

## 6. Risk Matrix

### Likelihood vs Impact

|                | Low Impact | Medium Impact | High Impact | Critical Impact |
|----------------|------------|---------------|-------------|-----------------|
| **Very Likely**| Low        | Medium        | High        | Critical        |
| **Likely**     | Low        | Medium        | High        | High            |
| **Possible**   | Low        | Low           | Medium      | High            |
| **Unlikely**   | Low        | Low           | Low         | Medium          |

### Top Risks Summary

| Risk | Likelihood | Impact | Score | Status |
|------|------------|--------|-------|--------|
| Tenant data leakage via RLS bypass | Unlikely | Critical | Medium | Mitigated |
| Webhook spoofing | Possible | High | Medium | Mitigated |
| Service role key exposure | Unlikely | Critical | Medium | Mitigated |
| Session hijacking | Unlikely | High | Low | Mitigated |
| Email alias enumeration | Possible | Low | Low | Accepted |

## 7. Security Controls Summary

### Implemented Controls
- [x] Row-Level Security (RLS) on all tables
- [x] Organization-scoped data isolation
- [x] Role-based access control (RBAC)
- [x] Webhook signature verification (Stripe, email providers)
- [x] Timing-safe secret comparison
- [x] Rate limiting via usage tracking
- [x] Secure headers (CSP, HSTS, X-Frame-Options, etc.)
- [x] HTTP-only, Secure, SameSite cookies
- [x] Environment variable validation (Zod)
- [x] Service role key isolation (`server-only`)
- [x] Audit logging (append-only)
- [x] PII redaction in email snippets
- [x] Idempotent webhook processing

### Planned Controls (Roadmap)
- [ ] Multi-factor authentication (MFA)
- [ ] SSO/SAML for enterprise
- [ ] Supabase Vault for secret encryption
- [ ] IP allowlisting for admin access
- [ ] Security event alerting
- [ ] Penetration testing

## 8. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-01 | Security Audit | Initial threat model |
