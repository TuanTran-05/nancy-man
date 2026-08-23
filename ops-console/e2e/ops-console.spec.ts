import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(seed: string, time = Date.now()) {
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const char of seed) { value = ((value << 5) | alphabet.indexOf(char)) >>> 0; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const counter = Math.floor(time / 1000 / 30); const moving = Buffer.alloc(8); moving.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(moving).digest(); const offset = digest.at(-1)! & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

test('an operator completes password plus TOTP login and can acknowledge, but cannot find a destructive control', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Tên đăng nhập').fill('ops-e2e');
  await page.getByLabel('Mật khẩu').fill(process.env.OPS_E2E_PASSWORD ?? 'correct horse battery staple');
  await page.getByLabel('Mã xác thực').fill(process.env.OPS_E2E_TOTP ?? totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'));
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('button', { name: /Xác nhận đã xem/ })).toBeVisible();
  await expect(page.getByText(/Restart|Chạy SQL/i)).toHaveCount(0);
});
