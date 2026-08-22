import { expect, test } from '@playwright/test';

test.describe('Session and CSRF boundaries', () => {
  test('anonymous and cleared sessions are rejected with 401', async ({ request }) => {
    const anonymous = await request.get('/api/v1/auth/session');
    expect(anonymous.status()).toBe(401);

    const expired = await request.get('/api/v1/auth/session', {
      headers: { Cookie: 'edutrack_session=' },
    });
    expect(expired.status()).toBe(401);
  });

  test('same-origin anonymous mutation reaches auth and returns 401', async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const response = await request.delete('/api/v1/knowledge-bank/document-id', {
      headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
    });

    expect(response.status()).toBe(401);
  });

  test('cross-site mutation is rejected before route dispatch', async ({ request }) => {
    const response = await request.post('/api/not-real/action', {
      headers: {
        Origin: 'https://attacker.example.test',
        'Sec-Fetch-Site': 'cross-site',
      },
    });

    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Cross-site request rejected',
    });
  });

  test('untrusted CORS preflight is not granted an allow-origin header', async ({ request }) => {
    const response = await request.fetch('/api/v1/students/create', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://attacker.example.test',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['access-control-allow-origin']).toBeUndefined();
  });
});
