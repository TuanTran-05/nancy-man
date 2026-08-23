import { defineConfig } from '@playwright/test';

const baseURL = process.env.OPS_E2E_BASE_URL ?? 'http://127.0.0.1:3101';
const live = process.env.OPS_E2E_LIVE === '1';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: live ? undefined : { command: 'node e2e/fixture-server.mjs', url: baseURL, reuseExistingServer: false, timeout: 30_000 },
});
