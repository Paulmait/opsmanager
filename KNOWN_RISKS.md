# Known Risks and Mitigations

This document lists known security risks in the Ops Manager codebase and their current status.

## Risk Classification

| Priority | Definition | Response Time |
|----------|------------|---------------|
| **P0** | Critical - Active exploitation possible | Immediate |
| **P1** | High - Significant security impact | < 24 hours |
| **P2** | Medium - Limited impact or requires specific conditions | < 1 week |
| **P3** | Low - Minimal impact, defense in depth | Backlog |

---

## P0 - Critical Risks

**None identified**

All critical vulnerabilities have been addressed:
- [x] Next.js middleware bypass (CVE-2025-29927) - Fixed by upgrading to 14.2.35
- [x] Service role key exposure - Protected with `server-only` package
- [x] SQL injection - Mitigated by parameterized queries via Supabase

---

## P1 - High Risks

### 1. MFA Not Implemented

**Risk**: Account takeover via credential stuffing or phishing

**Status**: Accepted (roadmap item)

**Mitigation**:
- Supabase Auth has built-in rate limiting
- Strong password requirements enforced
- Session cookies are HTTP-only, Secure, SameSite

**Recommendation**: Enable MFA for admin users before handling sensitive data

---

### 2. OAuth Token Storage Not Encrypted

**Risk**: Integration tokens could be exposed in database breach

**Status**: Partially mitigated

**Current State**: Tokens stored as vault references (not raw values)

**Mitigation**:
- Supabase encryption at rest
- RLS prevents unauthorized access
- Token IDs stored, not actual tokens

**Recommendation**: Implement Supabase Vault for proper secret encryption

---

## P2 - Medium Risks

### 3. Dev-Only Dependency Vulnerabilities

**Risk**: Command injection via glob CLI (dev only)

**Status**: Accepted (dev-only risk)

**Details**:
- `glob@10.3.10` in `eslint-config-next` has CLI command injection
- Only affects if glob CLI is used directly (we don't)
- `esbuild@0.21.5` in vitest has dev server vulnerability (dev only)

**Mitigation**: These packages are dev dependencies, not in production bundle

---

### 4. CSP Uses 'unsafe-inline' and 'unsafe-eval'

**Risk**: Reduced XSS protection

**Status**: Accepted (Next.js requirement)

**Details**:
```
script-src 'self' 'unsafe-inline' 'unsafe-eval'
```

**Mitigation**:
- React's automatic escaping prevents stored XSS
- No `dangerouslySetInnerHTML` usage
- Input validation on all user data

**Recommendation**: Use nonce-based CSP when Next.js supports it better

---

### 5. Email Alias Enumeration

**Risk**: Attackers could enumerate valid alias addresses

**Status**: Accepted (low impact)

**Details**:
- Alias format: `inbox-{12-char-hex}@mail.domain.com`
- 16^12 possible combinations makes brute force impractical
- Invalid aliases return generic error, not "not found"

**Mitigation**:
- Cryptographically random alias keys
- No timing difference between valid/invalid aliases
- Rate limiting on email endpoint

---

### 6. Audit Logs Not Tamper-Evident

**Risk**: Admin with database access could modify audit logs

**Status**: Accepted (defense in depth)

**Details**:
- Triggers prevent modification via SQL
- Service role could bypass (by design)
- No cryptographic proof of immutability

**Mitigation**:
- RLS prevents user modification
- Triggers block UPDATE/DELETE
- Consider log shipping to external service

---

## P3 - Low Risks

### 7. No Rate Limiting on Auth Endpoints

**Risk**: Brute force attacks on login

**Status**: Delegated to Supabase

**Mitigation**: Supabase Auth has built-in rate limiting

---

### 8. Email Snippet PII Redaction Not Comprehensive

**Risk**: Some PII patterns might not be caught

**Status**: Accepted (best effort)

**Current Patterns**:
- SSN: `XXX-XX-XXXX`
- Credit Cards: `XXXX-XXXX-XXXX-XXXX`
- Phone Numbers: `XXX-XXX-XXXX`

**Mitigation**:
- Snippet limited to 200 chars
- Full email body not stored
- Consider ML-based PII detection for v2

---

### 9. No IP-Based Access Control

**Risk**: Admin access from untrusted networks

**Status**: Backlog

**Mitigation**:
- Strong authentication required
- Consider IP allowlisting for admin endpoints

---

### 10. Webhook Replay Window is 5 Minutes

**Risk**: Replay attacks within window

**Status**: Accepted (industry standard)

**Details**: Mailgun signature verification allows 5-minute timestamp drift

**Mitigation**:
- Idempotency keys prevent duplicate processing
- Within industry standard practices

---

## Security Improvements Roadmap

### Short Term (Next Release)
- [ ] Enable MFA for admin users
- [ ] Add IP allowlisting option for admin access
- [ ] Implement security event alerting

### Medium Term (Q2)
- [ ] Implement Supabase Vault for token encryption
- [ ] Add comprehensive PII detection
- [ ] SSO/SAML support for enterprise
- [ ] External audit log shipping

### Long Term (Q3+)
- [ ] SOC 2 Type II certification prep
- [ ] Penetration testing by third party
- [ ] Bug bounty program
- [ ] Advanced threat detection

---

## Audit History

| Date | Auditor | Type | Findings |
|------|---------|------|----------|
| 2025-01-01 | Internal | Code Review | Initial security audit, 0 P0, 2 P1 |

---

## References

- [OWASP Top 10](https://owasp.org/Top10/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [Supabase Security](https://supabase.com/docs/guides/auth/auth-deep-dive)
- [Next.js Security](https://nextjs.org/docs/app/building-your-application/deploying#security)
