import { test, expect } from '@playwright/test';

test.describe('Zalo OA Panel', () => {
  test('admin dashboard loads', async ({ page }) => {
    await page.goto('/');
    // Dashboard should render without crashing
    await expect(page.locator('body')).toBeVisible();
  });

  test('API health endpoint responds', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    expect([200, 503]).toContain(response.status());
    const data = await response.json();
    expect(['ok', 'degraded']).toContain(data.status);
  });

  test('Zalo status API requires auth', async ({ request }) => {
    const response = await request.get('/api/v1/zalo/status');
    // Should return 401 without auth token
    expect(response.status()).toBe(401);
  });

  test('Zalo test API requires auth', async ({ request }) => {
    const response = await request.post('/api/v1/zalo/test', {
      data: { phone: '0384072314' },
    });
    expect(response.status()).toBe(401);
  });
});
