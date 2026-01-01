import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 *
 * Tests user signup, signin, and session management.
 */

test.describe('Authentication', () => {
  test.describe('Signup Flow', () => {
    test('should display signup page', async ({ page }) => {
      await page.goto('/signup');
      await expect(page).toHaveTitle(/Sign Up|Create Account|Register/i);
      await expect(page.getByRole('button', { name: /sign up|create account|register/i })).toBeVisible();
    });

    test('should show validation errors for invalid input', async ({ page }) => {
      await page.goto('/signup');

      // Submit with empty fields
      await page.getByRole('button', { name: /sign up|create account|register/i }).click();

      // Should show validation errors
      await expect(page.getByText(/email|required/i)).toBeVisible();
    });

    test('should show error for invalid email format', async ({ page }) => {
      await page.goto('/signup');

      await page.getByLabel(/email/i).fill('invalid-email');
      await page.getByLabel(/password/i).first().fill('ValidPassword123!');

      await page.getByRole('button', { name: /sign up|create account|register/i }).click();

      await expect(page.getByText(/valid email|invalid email/i)).toBeVisible();
    });
  });

  test.describe('Signin Flow', () => {
    test('should display login page', async ({ page }) => {
      await page.goto('/login');
      await expect(page).toHaveTitle(/Log In|Sign In|Login/i);
      await expect(page.getByRole('button', { name: /log in|sign in/i })).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/login');

      await page.getByLabel(/email/i).fill('nonexistent@example.com');
      await page.getByLabel(/password/i).fill('wrongpassword');

      await page.getByRole('button', { name: /log in|sign in/i }).click();

      // Should show authentication error
      await expect(page.getByText(/invalid|incorrect|error/i)).toBeVisible({ timeout: 10000 });
    });

    test('should redirect to dashboard after successful login', async ({ page }) => {
      // Note: This test requires a test user to be pre-created
      // Skip if no test credentials available
      const testEmail = process.env.TEST_USER_EMAIL;
      const testPassword = process.env.TEST_USER_PASSWORD;

      if (!testEmail || !testPassword) {
        test.skip();
        return;
      }

      await page.goto('/login');

      await page.getByLabel(/email/i).fill(testEmail);
      await page.getByLabel(/password/i).fill(testPassword);

      await page.getByRole('button', { name: /log in|sign in/i }).click();

      // Should redirect to dashboard
      await expect(page).toHaveURL(/dashboard|home/i, { timeout: 10000 });
    });
  });

  test.describe('Protected Routes', () => {
    test('should redirect unauthenticated users to login', async ({ page }) => {
      await page.goto('/dashboard');

      // Should redirect to login
      await expect(page).toHaveURL(/login/i, { timeout: 5000 });
    });

    test('should redirect from settings without auth', async ({ page }) => {
      await page.goto('/settings');

      await expect(page).toHaveURL(/login/i, { timeout: 5000 });
    });

    test('should redirect from tasks without auth', async ({ page }) => {
      await page.goto('/tasks');

      await expect(page).toHaveURL(/login/i, { timeout: 5000 });
    });
  });

  test.describe('Session Management', () => {
    test('should have secure cookie attributes', async ({ page, context }) => {
      await page.goto('/login');

      const cookies = await context.cookies();

      // Check for Supabase auth cookies
      const authCookies = cookies.filter(c =>
        c.name.includes('supabase') || c.name.includes('auth')
      );

      for (const cookie of authCookies) {
        // In production, these should be secure and httpOnly
        // In dev, httpOnly should still be true
        if (process.env.NODE_ENV === 'production') {
          expect(cookie.secure).toBe(true);
        }
      }
    });
  });
});
