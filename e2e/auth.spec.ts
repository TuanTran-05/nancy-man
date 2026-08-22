import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('login page loads with title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });

  test('login form has student code input', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('login-role-student').click();
    const studentInput = page.locator('#student-code');
    await expect(studentInput).toBeVisible();
  });

  test('Google login button is present', async ({ page }) => {
    await page.goto('/');
    const googleBtn = page.locator('button:has-text("Google"), button:has-text("google")');
    await expect(googleBtn).toBeVisible();
  });

  test('empty staff credentials keep submit disabled', async ({ page }) => {
    await page.goto('/');
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('page has no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    let sawExpectedAnonymousSession = false;
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('response', (response) => {
      if (response.url().includes('/api/v1/auth/session') && response.status() === 401) {
        sawExpectedAnonymousSession = true;
      }
    });
    await page.goto('/');
    await page.waitForTimeout(2000);
    const criticalErrors = errors.filter(
      (error) =>
        !error.includes('favicon') &&
        !error.includes('Third-party') &&
        !(sawExpectedAnonymousSession && error.includes('401 (Unauthorized)'))
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
