import { expect, test, type Page, type Route } from '@playwright/test';

const roles = ['ops_owner', 'ops_maintainer', 'ops_viewer'] as const;
const syntheticValue = 'synthetic-e2e-value';

const inventory = {
  catalogVersion: '2026-08-31',
  manifestVersion: '2026-08-31',
  generatedAt: '2026-08-31T12:00:00.000Z',
  items: [
    {
      catalogId: 'ops.api_database_url',
      name: 'DATABASE_URL',
      value: syntheticValue,
      appId: 'ops',
      appName: 'Ops Console',
      functionIds: ['api.runtime'],
      sourceId: 'ops.api_env',
      sourcePathLabel: '/etc/edutrack-ops/api.env',
      sourceAdapter: 'systemd_environment_file',
      consumerIds: ['ops.api'],
      category: 'database',
      description: 'Synthetic browser-test variable.',
      sensitivity: 'secret',
      requirement: 'required',
      mutability: 'managed',
      applyStrategy: 'runtime_restart',
      relatedDefinitionIds: ['ops.api_database_url_duplicate'],
      precedence: { precedenceId: 'ops.runtime_env', rank: 200, effective: true },
      sourceFingerprint: 'hmac-sha256:v1:' + 'a'.repeat(64),
      valueFingerprint: 'hmac-sha256:v1:' + 'b'.repeat(64),
      sourceMtime: '2026-08-31T12:00:00.000Z',
      lastOpsChange: {
        actorUserId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
        changeId: 'CHG_e2e',
        changedAt: '2026-08-31T12:01:00.000Z'
      }
    }
  ]
};

const catalog = {
  catalogVersion: '2026-08-31',
  apps: [
    { id: 'ops', displayName: 'Ops Console', runtimeVariableCount: 47 },
    { id: 'website', displayName: 'Thien Uy Website', runtimeVariableCount: 0 }
  ]
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installVariableRoutes(page: Page, role: (typeof roles)[number]) {
  let unlocked = false;

  await page.route('**/api/v1/auth/session', (route) =>
    json(route, {
      userId: `user-${role}`,
      username: `${role}-e2e`,
      displayName: role,
      role,
      csrfToken: 'csrf-e2e'
    })
  );
  await page.route('**/api/v1/auth/variables/unlock', async (route) => {
    if (route.request().method() === 'DELETE') {
      unlocked = false;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const requestBody = route.request().postDataJSON() as { password?: string; totpCode?: string };
    if (requestBody.password === 'bad-proof') {
      await json(route, { code: 'MFA_DENIED' }, 401);
      return;
    }
    expect(requestBody.totpCode).toMatch(/^\d{6}$/u);
    expect(route.request().headers()['x-ops-csrf']).toBe('csrf-e2e');
    unlocked = true;
    await json(route, {
      unlockedUntil: new Date(Date.now() + 60_000).toISOString()
    });
  });
  await page.route('**/api/v1/variables/catalog', (route) => json(route, catalog));
  await page.route('**/api/v1/variables', async (route) => {
    if (!unlocked) {
      await json(route, { code: 'STEP_UP_REQUIRED' }, 401);
      return;
    }
    await json(route, inventory);
  });
}

async function openVariables(page: Page, role: (typeof roles)[number]) {
  await installVariableRoutes(page, role);
  await page.goto('/');
  await page.evaluate(() => {
    window.history.replaceState({}, '', '/variables');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Mở khóa Variables' })).toBeVisible();
}

async function unlock(page: Page, password = 'synthetic-password') {
  await page.getByLabel('Mật khẩu hiện tại').fill(password);
  await page.getByLabel('Mã TOTP').fill('123456');
  await page.getByRole('button', { name: 'Mở khóa giá trị' }).click();
}

test('all active roles can unlock the read-only Variables workspace', async ({ page }) => {
  for (const role of roles) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await openVariables(page, role);
    await unlock(page);
    await expect(page.getByText(syntheticValue, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Thien Uy Website' })).toBeVisible();
    await expect(page.getByText('Không có variables runtime')).toBeVisible();
  }
});

test('rejects bad proof, denies direct inventory reads, filters metadata, and locks locally', async ({
  page
}) => {
  await openVariables(page, 'ops_viewer');

  expect(
    await page.evaluate(
      async () => (await fetch('/api/v1/variables', { credentials: 'same-origin' })).status
    )
  ).toBe(401);
  await unlock(page, 'bad-proof');
  await expect(page.getByRole('alert')).toContainText('không hợp lệ');
  await expect(page.getByText(syntheticValue, { exact: true })).toHaveCount(0);

  await unlock(page);
  await expect(page.getByText(syntheticValue, { exact: true })).toBeVisible();
  await expect(page.getByText('/etc/edutrack-ops/api.env')).toBeVisible();
  await expect(page.getByText('ops.api_database_url_duplicate')).toBeVisible();
  await expect(page.getByText('CHG_e2e')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sửa' })).toHaveCount(1);

  await page.getByLabel('Tìm variables').fill('does-not-exist');
  await expect(page.getByText(syntheticValue, { exact: true })).toHaveCount(0);
  await page.getByLabel('Tìm variables').fill('DATABASE');
  await expect(page.getByText(syntheticValue, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Khóa giá trị' }).click();
  await expect(page.getByRole('heading', { name: 'Mở khóa Variables' })).toBeVisible();
  await expect(page.getByText(syntheticValue, { exact: true })).toHaveCount(0);
});

test('clears values when leaving the route and when the local deadline expires', async ({
  page
}) => {
  await openVariables(page, 'ops_maintainer');
  await unlock(page);
  await expect(page.getByText(syntheticValue, { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.history.replaceState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.evaluate(() => {
    window.history.replaceState({}, '', '/variables');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Mở khóa Variables' })).toBeVisible();

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  // Install a fresh route set whose unlock response expires shortly.
  let unlocked = false;
  await page.route('**/api/v1/auth/session', (route) =>
    json(route, {
      userId: 'user-ops-maintainer',
      username: 'ops-maintainer-e2e',
      role: 'ops_maintainer',
      csrfToken: 'csrf-e2e'
    })
  );
  await page.route('**/api/v1/auth/variables/unlock', async (route) => {
    unlocked = true;
    await json(route, { unlockedUntil: new Date(Date.now() + 1_000).toISOString() });
  });
  await page.route('**/api/v1/variables/catalog', (route) => json(route, catalog));
  await page.route('**/api/v1/variables', (route) =>
    json(route, unlocked ? inventory : { code: 'STEP_UP_REQUIRED' }, unlocked ? 200 : 401)
  );
  await page.evaluate(() => {
    window.history.replaceState({}, '', '/variables');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await unlock(page);
  await expect(page.getByText(syntheticValue, { exact: true })).toBeVisible();
  await page.waitForTimeout(1_200);
  await expect(page.getByRole('heading', { name: 'Mở khóa Variables' })).toBeVisible();
  await expect(page.getByText(syntheticValue, { exact: true })).toHaveCount(0);
});
