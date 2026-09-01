import { expect, test, type Page, type Route } from '@playwright/test';

const sentinel = 'synthetic-mutation-value';
const digest = `hmac-sha256:v1:${'d'.repeat(64)}`;
const impactPlan = {
  applicationId: 'ops',
  sourceIds: ['ops.api_env'],
  actionIds: ['ops.api.restart'],
  checkIds: ['ops.api.health'],
  strategies: ['runtime_restart'],
  counts: { items: 1, sources: 1, actions: 1, checks: 1 }
};

const inventory = {
  catalogVersion: '2026-08-31',
  manifestVersion: '2026-08-31',
  generatedAt: '2026-08-31T12:00:00.000Z',
  items: [
    {
      catalogId: 'ops.api_public_name',
      name: 'PUBLIC_NAME',
      value: 'synthetic-current-value',
      appId: 'ops',
      appName: 'Ops Console',
      functionIds: ['ops.api'],
      sourceId: 'ops.api_env',
      sourcePathLabel: '/etc/edutrack-ops/api.env',
      sourceAdapter: 'systemd_environment_file',
      consumerIds: ['ops.api'],
      category: 'runtime_networking',
      description: 'Synthetic mutation-test variable.',
      sensitivity: 'public',
      requirement: 'required',
      mutability: 'managed',
      applyStrategy: 'runtime_restart',
      relatedDefinitionIds: [],
      precedence: { precedenceId: 'ops.api_env', rank: 100, effective: true },
      sourceFingerprint: `hmac-sha256:v1:${'a'.repeat(64)}`,
      valueFingerprint: `hmac-sha256:v1:${'b'.repeat(64)}`
    }
  ]
};

const catalog = {
  catalogVersion: '2026-08-31',
  apps: [{ id: 'ops', displayName: 'Ops Console', runtimeVariableCount: 1 }]
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installRoutes(page: Page, requests: string[]) {
  let unlocked = false;
  await page.route('**/api/v1/auth/session', (route) =>
    json(route, {
      userId: 'owner-e2e',
      username: 'owner-e2e',
      displayName: 'Owner',
      role: 'ops_owner',
      csrfToken: 'csrf-e2e'
    })
  );
  await page.route('**/api/v1/auth/variables/unlock', async (route) => {
    if (route.request().method() === 'DELETE') {
      unlocked = false;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    unlocked = true;
    await json(route, { unlockedUntil: new Date(Date.now() + 60_000).toISOString() });
  });
  await page.route('**/api/v1/variables/catalog', (route) => json(route, catalog));
  await page.route('**/api/v1/variables', async (route) => {
    if (!unlocked) {
      await json(route, { code: 'STEP_UP_REQUIRED' }, 401);
      return;
    }
    await json(route, inventory);
  });
  await page.route('**/api/v1/config-changes', async (route) => {
    requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    expect(route.request().postDataJSON()).not.toHaveProperty('value');
    await json(route, {
      changeId: 'CHG_E2E_MUTATION',
      state: 'DRAFT',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString()
    });
  });
  await page.route('**/api/v1/config-changes/CHG_E2E_MUTATION/items', async (route) => {
    requests.push(`${route.request().method()} items`);
    const body = route.request().postDataJSON() as { items?: Array<{ value?: string }> };
    expect(body.items?.[0]?.value).toBe(sentinel);
    await json(route, { state: 'READY', changeDigest: digest, impactPlan });
  });
  await page.route('**/api/v1/config-changes/CHG_E2E_MUTATION/validate', async (route) => {
    requests.push('POST validate');
    const body = route.request().postDataJSON() as { items?: Array<{ value?: string }> };
    expect(body.items?.[0]?.value).toBe(sentinel);
    await json(route, { state: 'READY', changeDigest: digest, impactPlan });
  });
  await page.route('**/api/v1/config-changes/CHG_E2E_MUTATION/save', async (route) => {
    requests.push('POST save');
    expect(route.request().postDataJSON()).not.toHaveProperty('value');
    await json(route, { changeId: 'CHG_E2E_MUTATION', state: 'SAVED', changeDigest: digest });
  });
  await page.route('**/api/v1/auth/variables/apply-authorization', async (route) => {
    requests.push('POST authorize');
    const body = route.request().postDataJSON() as { changeDigest?: string };
    expect(body.changeDigest).toBe(digest);
    await json(route, { authorizedUntil: new Date(Date.now() + 300_000).toISOString() });
  });
  await page.route('**/api/v1/config-changes/CHG_E2E_MUTATION/apply', async (route) => {
    requests.push('POST apply');
    expect(route.request().postDataJSON()).not.toHaveProperty('value');
    await json(route, {
      changeId: 'CHG_E2E_MUTATION',
      runId: 'RUN_E2E_MUTATION',
      state: 'APPLYING'
    });
  });
  await page.route('**/api/v1/config-changes/CHG_E2E_MUTATION/events', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `event: change\ndata: ${JSON.stringify({ state: 'COMPLETED', changeDigest: digest, impactPlan })}\n\n`
    });
  });
  await page.route('**/api/v1/config-changes/CHG_E2E_MUTATION', async (route) => {
    requests.push('GET status');
    await json(route, { state: 'COMPLETED', changeDigest: digest, impactPlan });
  });
}

test('keeps mutation values transient while enforcing the guarded lifecycle', async ({ page }) => {
  const requests: string[] = [];
  await installRoutes(page, requests);
  await page.goto('/');
  await page.evaluate(() => {
    window.history.replaceState({}, '', '/variables');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByLabel('Mật khẩu hiện tại').fill('synthetic-password');
  await page.getByLabel('Mã TOTP').fill('123456');
  await page.getByRole('button', { name: 'Mở khóa giá trị' }).click();
  await expect(page.getByText('synthetic-current-value', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sửa' }).click();
  await page.getByLabel('Giá trị mới').fill(sentinel);
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept('synthetic runtime drill');
  });
  await page.getByRole('button', { name: 'Đưa vào bản nháp' }).click();
  await expect(page.getByRole('heading', { name: 'CHG_E2E_MUTATION' })).toBeVisible();
  await expect(page.getByText(sentinel, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await page.getByLabel('Mật khẩu').fill('synthetic-apply-password');
  await page.getByLabel('Mã TOTP').fill('123456');
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByRole('heading', { name: 'COMPLETED' })).toBeVisible();
  expect(requests).toEqual([
    'POST /api/v1/config-changes',
    'PUT items',
    'POST save',
    'POST authorize',
    'POST apply',
    'GET status'
  ]);
});
