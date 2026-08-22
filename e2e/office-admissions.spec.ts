import { expect, test } from '@playwright/test';

test.describe('Office Admissions access boundary', () => {
  test('redirects unauthenticated visitors away from the admissions page', async ({ page }) => {
    await page.goto('/admissions');

    await expect(page).toHaveURL(/\/login$/);
  });

  test('requires authentication for every admissions API surface', async ({ request }) => {
    const responses = await Promise.all([
      request.get(
        '/api/v1/admissions/search-historical?name=Nguyen%20Van%20A&dob=2014-01-01&contact=0384072314'
      ),
      request.post('/api/v1/admissions/create-trial', {
        data: {
          name: 'Nguyen Van A',
          dob: '2014-01-01',
          contact: '0384072314',
          grade: 6,
          classId: 'class-1',
        },
      }),
      request.post('/api/v1/admissions/trial-decision', {
        data: { studentId: 'student-1', decision: 'accepted' },
      }),
      request.get('/api/v1/admissions/recent'),
    ]);

    expect(responses.map((response) => response.status())).toEqual([401, 401, 401, 401]);
  });
});
