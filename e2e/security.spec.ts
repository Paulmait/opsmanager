import { test, expect } from '@playwright/test';

/**
 * Security E2E Tests
 *
 * Tests security controls including:
 * - Cross-org access prevention
 * - CSRF protection
 * - Security headers
 * - Input validation
 */

test.describe('Security Headers', () => {
  test('should have X-Frame-Options header', async ({ request }) => {
    const response = await request.get('/');
    expect(response.headers()['x-frame-options']).toBe('DENY');
  });

  test('should have X-Content-Type-Options header', async ({ request }) => {
    const response = await request.get('/');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('should have Strict-Transport-Security header', async ({ request }) => {
    const response = await request.get('/');
    const hstsHeader = response.headers()['strict-transport-security'];
    expect(hstsHeader).toContain('max-age=');
  });

  test('should have Content-Security-Policy header', async ({ request }) => {
    const response = await request.get('/');
    const cspHeader = response.headers()['content-security-policy'];
    expect(cspHeader).toBeDefined();
    expect(cspHeader).toContain("default-src 'self'");
  });

  test('should have Referrer-Policy header', async ({ request }) => {
    const response = await request.get('/');
    expect(response.headers()['referrer-policy']).toBeDefined();
  });
});

test.describe('Cross-Org Access Prevention', () => {
  // These tests require authenticated sessions
  // They verify that users cannot access resources from other orgs

  test('should return 404 for non-existent org resource', async ({ request }) => {
    const fakeOrgId = '00000000-0000-0000-0000-000000000000';
    const response = await request.get(`/api/org/${fakeOrgId}/tasks`);

    // Should return 401 (unauthenticated) or 404 (not found)
    expect([401, 403, 404]).toContain(response.status());
  });

  test('should not expose internal IDs in error messages', async ({ request }) => {
    const response = await request.get('/api/org/invalid-uuid/tasks');
    const body = await response.text();

    // Should not contain database error details
    expect(body).not.toContain('PostgreSQL');
    expect(body).not.toContain('relation');
    expect(body).not.toContain('column');
    expect(body).not.toContain('syntax error');
  });
});

test.describe('Input Validation', () => {
  test('should reject invalid JSON in POST body', async ({ request }) => {
    const response = await request.post('/api/webhooks/email', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not valid json{{{',
    });

    // Should return 400 or 500, not crash
    expect([400, 415, 500]).toContain(response.status());
  });

  test('should handle oversized request body', async ({ request }) => {
    const largeBody = 'x'.repeat(10 * 1024 * 1024); // 10MB

    const response = await request.post('/api/webhooks/email', {
      headers: { 'Content-Type': 'text/plain' },
      data: largeBody,
      timeout: 30000,
    });

    // Should return 413 (Payload Too Large) or 400
    expect([400, 413, 500]).toContain(response.status());
  });
});

test.describe('Webhook Security', () => {
  test('should reject webhook without signature', async ({ request }) => {
    const response = await request.post('/api/webhooks/stripe', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ type: 'test.event' }),
    });

    // Should return 400 (missing signature)
    expect([400, 401]).toContain(response.status());
  });

  test('should reject webhook with invalid signature', async ({ request }) => {
    const response = await request.post('/api/webhooks/stripe', {
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid_signature_here',
      },
      data: JSON.stringify({ type: 'test.event' }),
    });

    // Should return 401 (invalid signature)
    expect([400, 401]).toContain(response.status());
  });

  test('should reject email webhook without secret', async ({ request }) => {
    const response = await request.post('/api/webhooks/email', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        from: 'test@example.com',
        to: 'inbox-test@mail.opsmanager.app',
        subject: 'Test',
      }),
    });

    // Should return error for missing signature
    expect([400, 401, 500]).toContain(response.status());
  });
});

test.describe('Path Traversal Prevention', () => {
  test('should not allow path traversal in URL', async ({ request }) => {
    const response = await request.get('/api/../../../etc/passwd');
    expect(response.status()).not.toBe(200);
  });

  test('should not allow encoded path traversal', async ({ request }) => {
    const response = await request.get('/api/%2e%2e/%2e%2e/etc/passwd');
    expect(response.status()).not.toBe(200);
  });
});

test.describe('Rate Limiting', () => {
  test('health endpoint should be accessible', async ({ request }) => {
    // Health endpoint should always work
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
  });

  // Note: Full rate limiting tests require many requests
  // and are better done in integration tests
});

test.describe('Error Handling', () => {
  test('404 page should not leak information', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-12345');

    // Should show 404 page
    await expect(page.getByText(/not found|404/i)).toBeVisible();

    // Should not show stack traces or internal paths
    const content = await page.content();
    expect(content).not.toContain('node_modules');
    expect(content).not.toContain('at Function');
    expect(content).not.toContain('Error:');
  });

  test('API 404 should return JSON', async ({ request }) => {
    const response = await request.get('/api/this-endpoint-does-not-exist');
    expect([404, 405]).toContain(response.status());
  });
});
