import { test, expect } from '@playwright/test';

test.describe('Knowledge Bank', () => {
  test('knowledge bank API requires auth for upload', async ({ request }) => {
    const response = await request.post('/api/v1/knowledge-bank/upload');
    expect(response.status()).toBe(401);
  });

  test('knowledge bank API requires auth for download', async ({ request }) => {
    const response = await request.get('/api/v1/knowledge-bank/download?id=test');
    expect(response.status()).toBe(401);
  });

  test('knowledge bank API requires auth for delete', async ({ request }) => {
    const response = await request.delete('/api/v1/knowledge-bank/test-id');
    expect(response.status()).toBe(401);
  });

  test('knowledge bank delete with invalid ID returns 401 without auth', async ({ request }) => {
    const response = await request.delete('/api/v1/knowledge-bank/nonexistent');
    expect(response.status()).toBe(401);
  });
});
