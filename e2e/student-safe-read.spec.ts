import { expect, test } from '@playwright/test';

const staffEmail = process.env.E2E_STAFF_EMAIL;
const staffPassword = process.env.E2E_STAFF_PASSWORD;

test('student read API requires authentication', async ({ request }) => {
  const response = await request.get('/api/v1/read/students?view=academic');
  expect(response.status()).toBe(401);
});

test('students page loads projected data through the server read API', async ({ page }) => {
  test.skip(!staffEmail || !staffPassword, 'Requires E2E_STAFF_EMAIL and E2E_STAFF_PASSWORD');

  await page.goto('/login');
  await page.locator('#staff-email').fill(staffEmail!);
  await page.locator('#staff-password').fill(staffPassword!);
  await page.locator('button[type="submit"]').click();

  const projectedRead = page.waitForResponse(
    (response) => response.url().includes('/api/v1/read/students') && response.status() === 200
  );
  await page.goto('/students');
  const bodyText = await (await projectedRead).text();

  expect(bodyText).not.toContain('loginPasswordHash');
  expect(bodyText).not.toContain('loginPasswordSalt');
  expect(bodyText).not.toContain('parentPasswordHash');
  await expect(page.locator('body')).toBeVisible();
});
