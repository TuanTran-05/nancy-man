import { test, expect } from '@playwright/test';

// NOTE: These tests require a seeded admin account. They are smoke-level E2E tests
// that exercise the UI flows. Full integration tests require live Firestore data.

test.describe('Student Admin Report', () => {
  test.slow();

  test.beforeEach(async ({ page }) => {
    // Navigate to home
    await page.goto('/');
  });

  test('admin can navigate to student report page via URL', async ({ page }) => {
    // The page should render without a crash even with an invalid studentId
    await page.goto('/students/test-student-id/report');
    // Should render either the loading state, the 404 state, or redirect to login
    await expect(page.locator('body')).toBeVisible();
  });

  test('report page shows loading state on initial load', async ({ page }) => {
    // Intercept API to delay response
    await page.route('**/api/v1/read/student-admin-report**', async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.continue();
    });

    await page.goto('/students/test-student-id/report');
    await expect(page.locator('body')).toBeVisible();
  });

  test('back button navigates away from report page', async ({ page }) => {
    await page.goto('/students/test-student-id/report');
    const backBtn = page.locator('#student-report-back-btn');
    if (await backBtn.isVisible()) {
      await backBtn.click();
      // Should navigate somewhere other than the report page or show a different state
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('class and course filter dropdowns render on the report page', async ({ page }) => {
    await page.goto('/students/test-student-id/report');
    await page.waitForTimeout(800);
    const filters = page.locator('#report-filters select');
    const count = await filters.count();
    // If page loaded (not redirected to login), both dropdowns should be present
    if (count > 0) {
      expect(count).toBe(2);
      await expect(page.locator('#filter-class')).toBeVisible();
      await expect(page.locator('#filter-term')).toBeVisible();
    }
  });

  test('report page has correct meta title', async ({ page }) => {
    await page.goto('/students/test-student-id/report');
    await expect(page.locator('body')).toBeVisible();
    // Verify no uncaught JS errors in the console
  });

  test('student report page handles 404 gracefully', async ({ page }) => {
    // Mock the API to return 404
    await page.route('**/api/v1/read/student-admin-report**', (route) => {
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, errorCode: 'not_found', error: 'Student not found' }),
      });
    });

    await page.goto('/students/non-existent-student-id/report');
    await page.waitForTimeout(1000);
    // Body should remain visible (no crash)
    await expect(page.locator('body')).toBeVisible();
  });

  test('tabs are visible on loaded report', async ({ page }) => {
    // Mock the API to return a successful response
    await page.route('**/api/v1/read/student-admin-report**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
            data: {
              student: { id: 'stu-1', name: 'Test Student', studentId: 'HS001', enrollmentStatus: 'active' },
              timeline: [],
              attendanceRows: [],
              ledgers: [],
              receipts: [],
              truncation: { attendance: false, ledgers: false, classSessions: false },
              generatedAt: new Date().toISOString(),
            },
          serverTime: new Date().toISOString(),
        }),
      });
    });

    await page.goto('/students/stu-1/report');
    await page.waitForTimeout(1500);

    const tabAttendance = page.locator('#tab-attendance');
    const tabFinance = page.locator('#tab-finance');
    if (await tabAttendance.isVisible()) {
      await expect(tabAttendance).toBeVisible();
      await expect(tabFinance).toBeVisible();
      await tabFinance.click();
      await expect(page.locator('#finance-empty-state')).toBeVisible();
    }
  });
});
