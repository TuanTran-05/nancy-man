import { createHmac } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

const configuredBaseURL = process.env.OPS_E2E_BASE_URL;
if (!configuredBaseURL) throw new Error('OPS_E2E_BASE_URL is required');
const allowedOrigin = new URL(configuredBaseURL).origin;
let requests: string[] = [];

test.beforeEach(async ({ page }) => {
  requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await installCanonicalUiFixture(page);
});

test.afterEach(async ({ browserName }, testInfo) => {
  const external = requests.filter((url) => new URL(url).origin !== allowedOrigin);
  expect(external, 'browser traffic escaped ' + allowedOrigin).toEqual([]);
  const destinations = [
    ...new Set(
      requests.map((url) => {
        const parsed = new URL(url);
        return parsed.origin + parsed.pathname;
      })
    )
  ].sort();
  console.log(
    'OPS_E2E_CONTACTS test=' +
      JSON.stringify(testInfo.title) +
      ' browser=' +
      browserName +
      ' total=' +
      requests.length +
      ' allowed_origin=' +
      allowedOrigin +
      ' external=0 destinations=' +
      JSON.stringify(destinations)
  );
});

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(seed: string, time = Date.now()) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of seed) {
    value = ((value << 5) | alphabet.indexOf(char)) >>> 0;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Math.floor(time / 1000 / 30);
  const moving = Buffer.alloc(8);
  moving.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(moving).digest();
  const offset = digest.at(-1)! & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

async function installCanonicalUiFixture(page: Page): Promise<void> {
  const fixturePassword = process.env.OPS_E2E_PASSWORD ?? 'correct horse battery staple';
  const fixtureTotp = process.env.OPS_E2E_TOTP ?? totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const legacyLogin = await fetch(new URL('/api/session', allowedOrigin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ops-e2e', password: fixturePassword, totp: fixtureTotp })
  });
  if (legacyLogin.status !== 201) throw new Error('OPS_E2E_LEGACY_FIXTURE_LOGIN_FAILED');
  const legacyCookie = legacyLogin.headers.get('set-cookie')?.split(';', 1)[0];
  const legacySession = (await legacyLogin.json()) as { csrfToken?: string };
  if (!legacyCookie || !legacySession.csrfToken)
    throw new Error('OPS_E2E_LEGACY_FIXTURE_SESSION_INVALID');

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/v1/auth/session') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'UNAUTHENTICATED' })
      });
      return;
    }
    if (path === '/api/v1/auth/login') {
      const body = request.postDataJSON() as { identifier?: string; password?: string };
      const valid = body.identifier === 'ops-e2e' && body.password === fixturePassword;
      await route.fulfill({
        status: valid ? 202 : 401,
        contentType: 'application/json',
        body: JSON.stringify(
          valid
            ? {
                status: 'mfa_required',
                mfaChallenge: 'c'.repeat(32),
                factors: [
                  {
                    id: '30000000-0000-4000-8000-000000000011',
                    type: 'totp',
                    label: 'Synthetic authenticator'
                  }
                ]
              }
            : { code: 'AUTH_DENIED' }
        )
      });
      return;
    }
    if (path === '/api/v1/auth/login/totp') {
      const body = request.postDataJSON() as { token?: string };
      const valid = body.token === fixtureTotp;
      await route.fulfill({
        status: valid ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(
          valid
            ? {
                userId: '30000000-0000-4000-8000-000000000012',
                username: 'ops-e2e',
                displayName: 'Synthetic Ops Operator',
                role: 'ops_owner',
                csrfToken: 'synthetic-canonical-csrf',
                expiresAt: new Date(Date.now() + 30 * 60_000).toISOString()
              }
            : { code: 'AUTH_DENIED' }
        )
      });
      return;
    }

    let legacyPath: string | null = null;
    if (path === '/api/v1/monitoring/overview') legacyPath = '/api/overview';
    if (path === '/api/v1/monitoring/infrastructure/history') {
      legacyPath = `/api/infrastructure/history${url.search}`;
    }
    if (path === '/api/v1/zalo/link') legacyPath = '/api/zalo/link';
    if (path === '/api/v1/zalo/link-code') legacyPath = '/api/zalo/link-code';
    const acknowledgement = /^\/api\/v1\/monitoring\/incidents\/([^/]+)\/ack$/u.exec(path);
    if (acknowledgement) {
      legacyPath = `/api/incidents/${encodeURIComponent(acknowledgement[1])}/ack`;
    }
    if (!legacyPath) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'OPS_E2E_CANONICAL_FIXTURE_ROUTE_MISSING' })
      });
      return;
    }

    const response = await fetch(new URL(legacyPath, allowedOrigin), {
      method: request.method(),
      headers: {
        accept: 'application/json',
        cookie: legacyCookie,
        ...(request.method() === 'POST'
          ? { 'Content-Type': 'application/json', 'X-CSRF-Token': legacySession.csrfToken }
          : {})
      },
      ...(request.postData() ? { body: request.postData()! } : {})
    });
    await route.fulfill({
      status: response.status,
      contentType: response.headers.get('content-type') ?? 'application/json',
      body: await response.text()
    });
  });
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Tên đăng nhập').fill('ops-e2e');
  await page
    .getByLabel('Mật khẩu')
    .fill(process.env.OPS_E2E_PASSWORD ?? 'correct horse battery staple');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page
    .getByLabel('Mã xác thực')
    .fill(process.env.OPS_E2E_TOTP ?? totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'));
  await page.getByRole('button', { name: 'Hoàn tất đăng nhập' }).click();
  await expect(page.getByRole('button', { name: /Xác nhận đã xem/ })).toBeVisible();
}

test('an operator completes password plus TOTP login and can acknowledge, but cannot find a destructive control', async ({
  page
}) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Hạ tầng VPS' })).toBeVisible();
  await expect(page.getByText('42,5%').first()).toBeVisible();
  await expect(page.getByText('edutrack-worker')).toBeVisible();
  await expect(page.getByText('postgresql', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '7d' }).click();
  await expect(page.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Beszel Hub|PocketBase|Restart|Terminal|Chạy SQL/i)).toHaveCount(0);
  expect(requests.some((url) => /8090|pocketbase/i.test(url))).toBe(false);
});

test('infrastructure section remains usable at 360px without horizontal overflow', async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Hạ tầng VPS' })).toBeVisible();
  await expect(page.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('edutrack-worker')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
