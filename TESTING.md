# Testing Guide - Ops Manager

This document describes how to run the comprehensive QA harness for the Ops Manager project.

## Quick Start

Run the full QA harness (PowerShell):
```powershell
pnpm qa
```

Run quick checks (lint + typecheck + unit tests):
```bash
pnpm qa:quick
```

## Test Layers

| Layer | Command | Description |
|-------|---------|-------------|
| Lint | `pnpm lint` | ESLint static analysis |
| Typecheck | `pnpm typecheck` | TypeScript type validation |
| Unit Tests | `pnpm test:run` | Vitest unit/integration tests |
| E2E Tests | `pnpm test:e2e` | Playwright browser tests |
| RLS Tests | `pnpm test:rls` | Supabase RLS verification |
| Dependency Audit | `pnpm audit` | npm security audit |
| SAST (Semgrep) | `pnpm sec:semgrep` | Static security analysis |
| Secrets Scan | `pnpm sec:gitleaks` | Secret detection |

## Prerequisites

### Required
- Node.js 18+
- pnpm 9.15+
- PowerShell (for qa.ps1)

### Optional (for full security scanning)
- Semgrep (`pip install semgrep` or `pipx install semgrep`)
- Gitleaks (`winget install Gitleaks` on Windows)
- Supabase CLI (for RLS tests)

## Running Individual Test Suites

### 1. Unit Tests (Vitest)

```bash
# Run all tests
pnpm test:run

# Run tests in watch mode
pnpm test

# Run specific test file
pnpm test tests/security.test.ts

# Run tests matching pattern
pnpm test --testNamePattern="Zod"
```

#### Test Categories
- `tests/auth.test.ts` - Authentication tests
- `tests/billing.test.ts` - Stripe billing tests
- `tests/email-ingestion.test.ts` - Email processing tests
- `tests/security.test.ts` - Security control tests
- `tests/edge-functions.test.ts` - Edge function tests

### 2. E2E Tests (Playwright)

```bash
# Install Playwright browsers (first time only)
pnpm exec playwright install

# Run all E2E tests
pnpm test:e2e

# Run with UI mode (interactive)
pnpm test:e2e:ui

# Run specific test file
pnpm exec playwright test e2e/auth.spec.ts

# Generate test report
pnpm exec playwright show-report
```

#### E2E Test Files
- `e2e/auth.spec.ts` - Authentication flows
- `e2e/security.spec.ts` - Security header and access tests

### 3. RLS Verification

The RLS verification suite tests multi-tenant isolation using real user sessions.

**Prerequisites:**
- Local Supabase instance running, OR
- Remote Supabase project with test credentials

**Setup:**
```bash
# Set environment variables
export NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
export SUPABASE_SERVICE_ROLE_KEY="your-service-key"  # Only for test user setup
```

**Run:**
```bash
pnpm test:rls
```

**What it tests:**
1. ✓ User A can only see their own organization
2. ✓ User B cannot see User A's organization
3. ✓ User B cannot insert into User A's organization
4. ✓ User B cannot read User A's tasks
5. ✓ User B cannot update User A's tasks
6. ✓ User A can only see profiles in their org
7. ✓ Audit logs cannot be updated
8. ✓ Audit logs cannot be deleted
9. ✓ Email aliases are org-isolated
10. ✓ Inbound emails are org-isolated

### 4. Security Scanning

#### Semgrep (SAST)

**Installation (Windows):**
```powershell
pip install semgrep
# OR
pipx install semgrep
```

**Installation (macOS/Linux):**
```bash
brew install semgrep
# OR
pip install semgrep
```

**Run:**
```bash
semgrep scan --config .semgrep.yml --error
```

**Custom rules included:**
- Hardcoded credentials detection
- Service role key in client code
- SQL injection patterns
- XSS via dangerouslySetInnerHTML
- Missing auth checks
- Weak random generators
- SSRF patterns
- Sensitive data in logs

#### Gitleaks (Secrets)

**Installation (Windows):**
```powershell
winget install Gitleaks
```

**Installation (macOS):**
```bash
brew install gitleaks
```

**Run:**
```bash
# Scan files only (no git history)
gitleaks detect --source . --config .gitleaks.toml --no-git

# Include git history
gitleaks detect --source . --config .gitleaks.toml
```

### 5. Dependency Audit

```bash
# Check for vulnerabilities (high+ severity)
pnpm audit

# Check all severities
pnpm audit --audit-level=low

# Auto-fix where possible
pnpm audit --fix
```

## Full QA Harness

The `scripts/qa.ps1` script runs all checks in sequence:

```powershell
# Full run
pnpm qa

# Or directly
pwsh scripts/qa.ps1
```

**Steps executed:**
1. Install dependencies
2. Check environment
3. Run ESLint
4. Run TypeScript typecheck
5. Run Vitest unit tests
6. Run dependency audit
7. Run Semgrep (if installed)
8. Run Gitleaks (if installed)
9. Run RLS verification (if Supabase configured)
10. Run E2E tests (if dev server available)

**Exit codes:**
- `0` - All checks passed
- `1` - One or more checks failed

## Environment Setup for Testing

### Required Environment Variables

Create `.env.local` for local testing:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-local-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-local-service-key

# Stripe (test mode)
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_secret

# Email (test mode)
EMAIL_WEBHOOK_SECRET=test-webhook-secret-at-least-16-chars
EMAIL_PROVIDER=test
EMAIL_DOMAIN=test.opsmanager.app

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=test
```

### Test User Credentials (for E2E)

```bash
# Optional - for authenticated E2E tests
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=TestPassword123!
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: QA

on:
  push:
    branches: [main]
  pull_request:

jobs:
  qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Unit Tests
        run: pnpm test:run
        env:
          NODE_ENV: test
          SUPABASE_SERVICE_ROLE_KEY: test-key
          STRIPE_SECRET_KEY: sk_test_fake
          STRIPE_WEBHOOK_SECRET: whsec_test_fake
          EMAIL_WEBHOOK_SECRET: test-email-webhook-secret-16chars

      - name: Dependency Audit
        run: pnpm audit --audit-level=critical
        continue-on-error: true

      - name: Install Playwright
        run: pnpm exec playwright install --with-deps chromium

      - name: E2E Tests
        run: pnpm test:e2e
```

## Troubleshooting

### Common Issues

#### "Cannot find module '@/lib/...'"
The test is importing a file that uses `server-only`. Mock the module or ensure you're not testing server-only code in client context.

#### "Missing environment variable"
Set required env vars:
```bash
export SUPABASE_SERVICE_ROLE_KEY=test-key
export STRIPE_SECRET_KEY=sk_test_fake
export STRIPE_WEBHOOK_SECRET=whsec_test_fake
export EMAIL_WEBHOOK_SECRET=test-webhook-secret-min16
```

#### "Playwright browsers not installed"
```bash
pnpm exec playwright install
```

#### "RLS tests fail with 'User not found'"
The signup trigger may not be creating users. Check:
1. Database migrations are applied
2. `handle_new_user()` trigger exists
3. Service role key is valid

#### "Semgrep not found"
Install with:
```bash
pip install semgrep
# or
pipx install semgrep
```

#### "Gitleaks not found"
Install with:
```powershell
winget install Gitleaks  # Windows
brew install gitleaks    # macOS
```

## Test Coverage

To generate coverage report:

```bash
pnpm test:run --coverage
```

Coverage report will be in `coverage/` directory.

## Writing New Tests

### Unit Test Template (Vitest)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("FeatureName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should do something", () => {
    expect(true).toBe(true);
  });
});
```

### E2E Test Template (Playwright)

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature', () => {
  test('should work', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Ops Manager/);
  });
});
```

### RLS Test Pattern

When testing RLS, always:
1. Create resources as User A
2. Try to access as User B
3. Verify access is denied
4. Clean up test data

## Security Testing Checklist

Before release, verify:

- [ ] All unit tests pass (`pnpm test:run`)
- [ ] All E2E tests pass (`pnpm test:e2e`)
- [ ] RLS verification passes (`pnpm test:rls`)
- [ ] No critical/high vulnerabilities (`pnpm audit`)
- [ ] No secrets in code (`gitleaks detect`)
- [ ] No SAST findings (`semgrep scan`)
- [ ] Security headers present (verify in browser)
- [ ] Webhook signatures verified (check logs)
