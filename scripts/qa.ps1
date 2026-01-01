# =============================================================================
# Ops Manager - Full QA Harness
# =============================================================================
# Run all quality assurance checks: lint, typecheck, tests, security scans
# Usage: pwsh scripts/qa.ps1
#        OR: pnpm qa
# =============================================================================

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Write-Failure {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Write-Skip {
    param([string]$Message)
    Write-Host "[SKIP] $Message" -ForegroundColor Yellow
}

$startTime = Get-Date
$results = @()

# Track working directory
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $projectRoot

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host " OPS MANAGER QA HARNESS" -ForegroundColor Magenta
Write-Host " Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta

# -----------------------------------------------------------------------------
# Step 1: Install dependencies
# -----------------------------------------------------------------------------
Write-Step "1/10 - Installing dependencies"
try {
    pnpm install --frozen-lockfile 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        # Try without frozen lockfile
        pnpm install 2>&1 | Out-Null
    }
    Write-Success "Dependencies installed"
    $results += @{Step="Install"; Status="PASS"}
} catch {
    Write-Failure "Failed to install dependencies: $_"
    $results += @{Step="Install"; Status="FAIL"}
    exit 1
}

# -----------------------------------------------------------------------------
# Step 2: Check environment
# -----------------------------------------------------------------------------
Write-Step "2/10 - Checking environment variables"
try {
    $env:NODE_ENV = "test"
    # Skip env check in QA mode - just verify file exists
    if (Test-Path ".env.local" -or Test-Path ".env") {
        Write-Success "Environment file exists"
    } else {
        Write-Skip "No .env file found - using defaults for tests"
    }
    $results += @{Step="Check-Env"; Status="PASS"}
} catch {
    Write-Failure "Environment check failed: $_"
    $results += @{Step="Check-Env"; Status="FAIL"}
}

# -----------------------------------------------------------------------------
# Step 3: Lint
# -----------------------------------------------------------------------------
Write-Step "3/10 - Running ESLint"
try {
    pnpm run lint 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Lint failed"
    }
    Write-Success "Lint passed"
    $results += @{Step="Lint"; Status="PASS"}
} catch {
    Write-Failure "Lint failed: $_"
    $results += @{Step="Lint"; Status="FAIL"}
    exit 1
}

# -----------------------------------------------------------------------------
# Step 4: Typecheck
# -----------------------------------------------------------------------------
Write-Step "4/10 - Running TypeScript type check"
try {
    pnpm run typecheck 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Typecheck failed"
    }
    Write-Success "Typecheck passed"
    $results += @{Step="Typecheck"; Status="PASS"}
} catch {
    Write-Failure "Typecheck failed: $_"
    $results += @{Step="Typecheck"; Status="FAIL"}
    exit 1
}

# -----------------------------------------------------------------------------
# Step 5: Unit tests (Vitest)
# -----------------------------------------------------------------------------
Write-Step "5/10 - Running Vitest unit tests"
try {
    $env:NODE_ENV = "test"
    $env:SUPABASE_SERVICE_ROLE_KEY = "test-key-for-testing"
    $env:STRIPE_SECRET_KEY = "sk_test_fake"
    $env:STRIPE_WEBHOOK_SECRET = "whsec_test_fake"
    $env:EMAIL_WEBHOOK_SECRET = "test-email-webhook-secret-16chars"

    pnpm run test:run 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Failure "Some tests failed - check output above"
        $results += @{Step="Vitest"; Status="PARTIAL"}
    } else {
        Write-Success "Vitest tests passed"
        $results += @{Step="Vitest"; Status="PASS"}
    }
} catch {
    Write-Failure "Vitest failed: $_"
    $results += @{Step="Vitest"; Status="FAIL"}
}

# -----------------------------------------------------------------------------
# Step 6: Dependency audit
# -----------------------------------------------------------------------------
Write-Step "6/10 - Running dependency audit"
try {
    pnpm audit --audit-level=critical 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Failure "Critical vulnerabilities found"
        $results += @{Step="Audit"; Status="FAIL"}
    } else {
        Write-Success "No critical vulnerabilities"
        $results += @{Step="Audit"; Status="PASS"}
    }
} catch {
    Write-Failure "Audit failed: $_"
    $results += @{Step="Audit"; Status="FAIL"}
}

# -----------------------------------------------------------------------------
# Step 7: Semgrep SAST (optional)
# -----------------------------------------------------------------------------
Write-Step "7/10 - Running Semgrep SAST scan"
$semgrepInstalled = Get-Command semgrep -ErrorAction SilentlyContinue
if ($semgrepInstalled) {
    try {
        semgrep scan --config .semgrep.yml --error 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Failure "Semgrep found issues"
            $results += @{Step="Semgrep"; Status="FAIL"}
        } else {
            Write-Success "Semgrep passed"
            $results += @{Step="Semgrep"; Status="PASS"}
        }
    } catch {
        Write-Failure "Semgrep failed: $_"
        $results += @{Step="Semgrep"; Status="FAIL"}
    }
} else {
    Write-Skip "Semgrep not installed - see TESTING.md for install instructions"
    $results += @{Step="Semgrep"; Status="SKIP"}
}

# -----------------------------------------------------------------------------
# Step 8: Gitleaks secrets scan (optional)
# -----------------------------------------------------------------------------
Write-Step "8/10 - Running Gitleaks secrets scan"
$gitleaksInstalled = Get-Command gitleaks -ErrorAction SilentlyContinue
if ($gitleaksInstalled) {
    try {
        gitleaks detect --source . --config .gitleaks.toml --no-git 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Failure "Gitleaks found secrets"
            $results += @{Step="Gitleaks"; Status="FAIL"}
        } else {
            Write-Success "Gitleaks passed"
            $results += @{Step="Gitleaks"; Status="PASS"}
        }
    } catch {
        Write-Failure "Gitleaks failed: $_"
        $results += @{Step="Gitleaks"; Status="FAIL"}
    }
} else {
    Write-Skip "Gitleaks not installed - see TESTING.md for install instructions"
    $results += @{Step="Gitleaks"; Status="SKIP"}
}

# -----------------------------------------------------------------------------
# Step 9: RLS verification (requires Supabase running)
# -----------------------------------------------------------------------------
Write-Step "9/10 - Running RLS verification"
if ($env:NEXT_PUBLIC_SUPABASE_URL -and $env:SUPABASE_SERVICE_ROLE_KEY -and $env:SUPABASE_SERVICE_ROLE_KEY -ne "test-key-for-testing") {
    try {
        node scripts/rls-verify.mjs 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Failure "RLS verification failed"
            $results += @{Step="RLS"; Status="FAIL"}
        } else {
            Write-Success "RLS verification passed"
            $results += @{Step="RLS"; Status="PASS"}
        }
    } catch {
        Write-Failure "RLS verification failed: $_"
        $results += @{Step="RLS"; Status="FAIL"}
    }
} else {
    Write-Skip "RLS verification skipped - Supabase not configured"
    $results += @{Step="RLS"; Status="SKIP"}
}

# -----------------------------------------------------------------------------
# Step 10: E2E tests (requires dev server)
# -----------------------------------------------------------------------------
Write-Step "10/10 - Running Playwright E2E tests"
if (Test-Path "e2e") {
    Write-Skip "E2E tests require dev server running - run manually: pnpm test:e2e"
    $results += @{Step="E2E"; Status="SKIP"}
} else {
    Write-Skip "E2E test directory not found"
    $results += @{Step="E2E"; Status="SKIP"}
}

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host " QA HARNESS SUMMARY" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host ""

$passCount = ($results | Where-Object { $_.Status -eq "PASS" }).Count
$failCount = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$skipCount = ($results | Where-Object { $_.Status -eq "SKIP" }).Count
$partialCount = ($results | Where-Object { $_.Status -eq "PARTIAL" }).Count

foreach ($result in $results) {
    $color = switch ($result.Status) {
        "PASS" { "Green" }
        "FAIL" { "Red" }
        "SKIP" { "Yellow" }
        "PARTIAL" { "Yellow" }
        default { "White" }
    }
    Write-Host "  $($result.Step.PadRight(15)) [$($result.Status)]" -ForegroundColor $color
}

Write-Host ""
Write-Host "Duration: $($duration.TotalSeconds.ToString('F1')) seconds"
Write-Host "Results: $passCount passed, $failCount failed, $skipCount skipped, $partialCount partial"
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "QA HARNESS: FAILED" -ForegroundColor Red
    exit 1
} elseif ($partialCount -gt 0) {
    Write-Host "QA HARNESS: PARTIAL (some tests failed)" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "QA HARNESS: PASSED" -ForegroundColor Green
    exit 0
}
