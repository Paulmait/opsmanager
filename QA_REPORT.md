# QA Report - Ops Manager

**Report Date:** _[DATE]_
**Version:** _[VERSION/COMMIT]_
**Environment:** _[local/staging/production]_

---

## Summary

| Check | Status | Duration | Notes |
|-------|--------|----------|-------|
| Lint (ESLint) | | | |
| Typecheck (tsc) | | | |
| Unit Tests (Vitest) | | | |
| E2E Tests (Playwright) | | | |
| RLS Verification | | | |
| Dependency Audit | | | |
| SAST (Semgrep) | | | |
| Secrets Scan (Gitleaks) | | | |

**Overall Status:** _[PASS / FAIL / PARTIAL]_

---

## Detailed Results

### 1. Lint (ESLint)

**Command:** `pnpm lint`

```
[paste output here]
```

**Status:** _[PASS/FAIL]_
**Issues Found:** _[count]_

### 2. Typecheck (TypeScript)

**Command:** `pnpm typecheck`

```
[paste output here]
```

**Status:** _[PASS/FAIL]_
**Issues Found:** _[count]_

### 3. Unit Tests (Vitest)

**Command:** `pnpm test:run`

```
[paste output here]
```

**Status:** _[PASS/FAIL]_
**Tests:** _[passed]/[total]_
**Coverage:** _[percentage]_ (if available)

### 4. E2E Tests (Playwright)

**Command:** `pnpm test:e2e`

```
[paste output here]
```

**Status:** _[PASS/FAIL/SKIPPED]_
**Tests:** _[passed]/[total]_

### 5. RLS Verification

**Command:** `pnpm test:rls`

```
[paste output here]
```

**Status:** _[PASS/FAIL/SKIPPED]_
**Tests:** _[passed]/[total]_

### 6. Dependency Audit

**Command:** `pnpm audit`

```
[paste output here]
```

**Status:** _[PASS/FAIL]_
**Vulnerabilities:**
- Critical: _[count]_
- High: _[count]_
- Moderate: _[count]_
- Low: _[count]_

### 7. SAST (Semgrep)

**Command:** `semgrep scan --config .semgrep.yml --error`

```
[paste output here]
```

**Status:** _[PASS/FAIL/SKIPPED]_
**Findings:** _[count]_

### 8. Secrets Scan (Gitleaks)

**Command:** `gitleaks detect --source . --config .gitleaks.toml --no-git`

```
[paste output here]
```

**Status:** _[PASS/FAIL/SKIPPED]_
**Leaks Found:** _[count]_

---

## Issues Found

### P0 - Critical (Must Fix Before Deploy)

| ID | Category | Description | File:Line | Status |
|----|----------|-------------|-----------|--------|
| | | | | |

### P1 - High (Fix Soon)

| ID | Category | Description | File:Line | Status |
|----|----------|-------------|-----------|--------|
| | | | | |

### P2 - Medium (Track/Document)

| ID | Category | Description | File:Line | Status |
|----|----------|-------------|-----------|--------|
| | | | | |

### P3 - Low (Nice to Have)

| ID | Category | Description | File:Line | Status |
|----|----------|-------------|-----------|--------|
| | | | | |

---

## Security Checklist

- [ ] All RLS policies verified with cross-tenant tests
- [ ] No service_role key exposed to client
- [ ] All webhook endpoints verify signatures
- [ ] Input validation on all API routes
- [ ] No hardcoded secrets in codebase
- [ ] Security headers present (CSP, X-Frame-Options, etc.)
- [ ] Audit logging enabled for sensitive operations
- [ ] Rate limiting configured
- [ ] Error messages don't leak internal details
- [ ] Dependencies have no critical vulnerabilities

---

## Known Risks / Accepted Exceptions

| Risk | Severity | Justification | Tracking |
|------|----------|---------------|----------|
| | | | |

---

## Recommendations

1. _[recommendation]_
2. _[recommendation]_

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| QA Lead | | | |
| Security | | | |

---

## Appendix

### Test Environment Configuration

```
NODE_ENV=
NEXT_PUBLIC_SUPABASE_URL=
# (list relevant non-secret env vars)
```

### Tool Versions

```
node:
pnpm:
next:
typescript:
vitest:
playwright:
semgrep:
gitleaks:
```
