import { createHmac } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(seed: string, time = Date.now()) {
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const char of seed) { value = ((value << 5) | alphabet.indexOf(char)) >>> 0; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const counter = Math.floor(time / 1000 / 30); const moving = Buffer.alloc(8); moving.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(moving).digest(); const offset = digest.at(-1)! & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Tên đăng nhập').fill('ops-e2e');
  await page.getByLabel('Mật khẩu').fill(process.env.OPS_E2E_PASSWORD ?? 'correct horse battery staple');
  await page.getByLabel('Mã xác thực').fill(process.env.OPS_E2E_TOTP ?? totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'));
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('button', { name: /Xác nhận đã xem/ })).toBeVisible();
}

test('an operator completes password plus TOTP login and can acknowledge, but cannot find a destructive control', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
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

test('infrastructure section remains usable at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Hạ tầng VPS' })).toBeVisible();
  await expect(page.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('edutrack-worker')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
