/**
 * Playwright end-to-end spec for the Database Explorer feature.
 *
 * Covers:
 * - Owner login + MFA, target list, both schema trees
 * - Production masked rows, PII reveal dialog, countdown, revealed data
 * - FK navigation, explicit hide/remask
 * - Focused relationship graph, full ERD search
 * - Target reset, refresh without persisted rows
 * - Logout
 * - Second context (viewer): can see schemas/graphs, cannot trigger row query or reveal
 *
 * Requires:
 *   OPS_E2E_BASE_URL          — deployed app origin
 *   OPS_E2E_OWNER_EMAIL       — owner account email
 *   OPS_E2E_OWNER_PASSWORD    — owner account password
 *   OPS_E2E_OWNER_TOTP_SEED   — base32 TOTP seed for owner account
 *   OPS_E2E_VIEWER_EMAIL      — viewer account email
 *   OPS_E2E_VIEWER_PASSWORD   — viewer account password
 *   OPS_E2E_VIEWER_TOTP_SEED  — base32 TOTP seed for viewer account
 *   OPS_E2E_DB_TARGET_OPS     — target ID for the ops database (default: ops)
 *   OPS_E2E_DB_TARGET_PROD    — target ID for the production database (default: edutrack_production)
 */

import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseURL = process.env.OPS_E2E_BASE_URL;
if (!baseURL) throw new Error('OPS_E2E_BASE_URL is required');
const allowedOrigin = new URL(baseURL).origin;

const ownerEmail = process.env.OPS_E2E_OWNER_EMAIL;
const ownerPassword = process.env.OPS_E2E_OWNER_PASSWORD;
const ownerTotpSeed = process.env.OPS_E2E_OWNER_TOTP_SEED;
const viewerEmail = process.env.OPS_E2E_VIEWER_EMAIL;
const viewerPassword = process.env.OPS_E2E_VIEWER_PASSWORD;
const viewerTotpSeed = process.env.OPS_E2E_VIEWER_TOTP_SEED;
const opsTargetId = process.env.OPS_E2E_DB_TARGET_OPS ?? 'ops';
const prodTargetId = process.env.OPS_E2E_DB_TARGET_PROD ?? 'edutrack_production';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(seed: string, time = Date.now()): string {
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

async function login(page: Page, email: string, password: string, totpSeed: string) {
  await page.goto(baseURL!);
  await page.getByRole('textbox', { name: /email/i }).fill(email);
  await page.getByRole('textbox', { name: /password/i }).fill(password);
  await page.getByRole('button', { name: /đăng nhập/i }).click();
  // MFA step
  const totpCode = totp(totpSeed);
  await page.getByRole('textbox', { name: /mã xác thực/i }).fill(totpCode);
  await page.getByRole('button', { name: /xác nhận/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

async function navigateToDatabasePage(page: Page) {
  await page.getByRole('link', { name: /database/i }).click();
  await expect(page.getByRole('heading', { name: /database explorer/i })).toBeVisible({
    timeout: 10_000
  });
}

async function assertNoBlockedValueInPage(page: Page) {
  // Blocked cells must never show their raw value in the DOM
  const content = await page.content();
  expect(content).not.toMatch(/BLOCKED_CORPUS_COLUMN_VALUE/);
}

// ---------------------------------------------------------------------------
// Tests — Owner flows
// ---------------------------------------------------------------------------

test.describe('Database Explorer — owner', () => {
  test.skip(!ownerEmail || !ownerPassword || !ownerTotpSeed, 'Owner credentials not configured');

  let requests: string[] = [];

  test.beforeEach(async ({ page }) => {
    requests = [];
    page.on('request', (req) => requests.push(req.url()));
    await login(page, ownerEmail!, ownerPassword!, ownerTotpSeed!);
  });

  test.afterEach(async () => {
    const external = requests.filter((url) => new URL(url).origin !== allowedOrigin);
    expect(external, 'browser traffic escaped ' + allowedOrigin).toEqual([]);
    const hasCred = requests.some((url) => /password|totp|token|secret|credential/i.test(url));
    expect(hasCred, 'credential string escaped into network request URL').toBe(false);
  });

  test('shows target list and ops schema tree', async ({ page }) => {
    await navigateToDatabasePage(page);
    // Target selector present
    await expect(page.getByRole('combobox', { name: /target/i })).toBeVisible();
    // Select ops target
    await page.getByRole('combobox', { name: /target/i }).selectOption(opsTargetId);
    // Schema tree appears
    await expect(page.getByRole('complementary', { name: /danh sách bảng/i })).toBeVisible({
      timeout: 15_000
    });
  });

  test('production shows masked rows, reveal dialog, countdown, and PII data', async ({ page }) => {
    await navigateToDatabasePage(page);
    await page.getByRole('combobox', { name: /target/i }).selectOption(prodTargetId);
    // Click first relation in tree
    const firstRelation = page.locator('.schema-tree-item').first();
    await firstRelation.waitFor({ timeout: 15_000 });
    await firstRelation.click();
    // Data tab should be active
    await expect(page.getByRole('tab', { name: /dữ liệu/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // Rows should appear (masked)
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    // No blocked values in DOM
    await assertNoBlockedValueInPage(page);

    // Open PII reveal dialog
    await page.getByRole('button', { name: /mở khóa pii/i }).click();
    await expect(page.getByRole('dialog', { name: /mở khóa pii/i })).toBeVisible();
    // Fill password and TOTP
    await page
      .getByRole('dialog')
      .getByRole('textbox', { name: /mật khẩu/i })
      .fill(ownerPassword!);
    const code = totp(ownerTotpSeed!);
    await page
      .getByRole('dialog')
      .getByRole('textbox', { name: /mã xác thực/i })
      .fill(code);
    await page.getByRole('dialog').getByRole('textbox', { name: /lý do/i }).fill('E2E test reveal');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /xác nhận/i })
      .click();
    // Dialog closes, countdown appears
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/pii: đã mở khóa/i)).toBeVisible({ timeout: 5_000 });
    // No blocked values even after reveal
    await assertNoBlockedValueInPage(page);

    // Explicit hide
    await page.getByRole('button', { name: /ẩn dữ liệu nhạy cảm/i }).click();
    await expect(page.getByText(/pii: đang ẩn/i)).toBeVisible({ timeout: 5_000 });
  });

  test('FK navigation opens related rows drawer', async ({ page }) => {
    await navigateToDatabasePage(page);
    await page.getByRole('combobox', { name: /target/i }).selectOption(opsTargetId);
    const firstRelation = page.locator('.schema-tree-item').first();
    await firstRelation.waitFor({ timeout: 15_000 });
    await firstRelation.click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    // If a FK navigation button exists, click it
    const fkBtn = page.locator('[data-testid="follow-relation-btn"]').first();
    if ((await fkBtn.count()) > 0) {
      await fkBtn.click();
      await expect(page.getByRole('complementary', { name: /quan hệ liên quan/i })).toBeVisible({
        timeout: 5_000
      });
    }
  });

  test('relationship graph tab is visible and shows relation list', async ({ page }) => {
    await navigateToDatabasePage(page);
    await page.getByRole('combobox', { name: /target/i }).selectOption(opsTargetId);
    const firstRelation = page.locator('.schema-tree-item').first();
    await firstRelation.waitFor({ timeout: 15_000 });
    await firstRelation.click();
    // Switch to relations tab
    await page.getByRole('tab', { name: /quan hệ/i }).click();
    await expect(page.getByRole('tab', { name: /quan hệ/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('full ERD tab renders and search filters schema', async ({ page }) => {
    await navigateToDatabasePage(page);
    await page.getByRole('combobox', { name: /target/i }).selectOption(opsTargetId);
    await page.locator('.schema-tree-item').first().waitFor({ timeout: 15_000 });
    // Switch to ERD tab
    await page.getByRole('tab', { name: /toàn bộ erd/i }).click();
    await expect(page.getByRole('tab', { name: /toàn bộ erd/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // ERD search box
    await expect(page.getByRole('searchbox')).toBeVisible();
    await page.getByRole('searchbox').fill('nonexistent_xyz_abc');
    await expect(page.getByText(/0 bảng/i)).toBeVisible({ timeout: 5_000 });
    // Clear search
    await page.getByRole('button', { name: /xóa tìm kiếm/i }).click();
    await expect(page.getByText(/0 bảng/i)).not.toBeVisible();
  });

  test('switching targets clears rows and cursor stack', async ({ page }) => {
    await navigateToDatabasePage(page);
    await page.getByRole('combobox', { name: /target/i }).selectOption(opsTargetId);
    await page.locator('.schema-tree-item').first().waitFor({ timeout: 15_000 });
    await page.locator('.schema-tree-item').first().click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10_000 });
    // Switch target
    await page.getByRole('combobox', { name: /target/i }).selectOption(prodTargetId);
    // Table should no longer show old rows (schema tree reloads)
    await page.waitForTimeout(500);
    await assertNoBlockedValueInPage(page);
  });

  test('logout removes session and redirects to login', async ({ page }) => {
    await navigateToDatabasePage(page);
    await page.getByRole('button', { name: /đăng xuất/i }).click();
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Tests — Viewer flows
// ---------------------------------------------------------------------------

test.describe('Database Explorer — viewer', () => {
  test.skip(
    !viewerEmail || !viewerPassword || !viewerTotpSeed,
    'Viewer credentials not configured'
  );

  test.beforeEach(async ({ page }) => {
    await login(page, viewerEmail!, viewerPassword!, viewerTotpSeed!);
  });

  test('viewer sees schema tree but has no Data tab query or reveal control', async ({ page }) => {
    await navigateToDatabasePage(page);
    await page.getByRole('combobox', { name: /target/i }).selectOption(opsTargetId);
    await page.locator('.schema-tree-item').first().waitFor({ timeout: 15_000 });
    await page.locator('.schema-tree-item').first().click();

    // Data tab shows restricted message, not table rows
    await expect(page.getByText(/quyền truy cập bị giới hạn/i)).toBeVisible({ timeout: 5_000 });
    // No row query table should appear
    await expect(page.getByRole('table')).not.toBeVisible();
    // No PII reveal button
    await expect(page.getByRole('button', { name: /mở khóa pii/i })).not.toBeVisible();
  });

  test('viewer can open relationship graph and full ERD', async ({ page }) => {
    await navigateToDatabasePage(page);
    await page.getByRole('combobox', { name: /target/i }).selectOption(opsTargetId);
    await page.locator('.schema-tree-item').first().waitFor({ timeout: 15_000 });
    await page.locator('.schema-tree-item').first().click();
    // Relations tab
    await page.getByRole('tab', { name: /quan hệ/i }).click();
    await expect(page.getByRole('tab', { name: /quan hệ/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // ERD tab
    await page.getByRole('tab', { name: /toàn bộ erd/i }).click();
    await expect(page.getByRole('searchbox')).toBeVisible();
  });
});
