import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { parseOpsE2eBaseUrl } from './e2e/baseUrl.js';

const { baseURL } = parseOpsE2eBaseUrl(process.env.OPS_E2E_BASE_URL);
const workspaceDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  workers: 1,
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: 'node e2e/fixture-server.mjs',
    cwd: workspaceDirectory,
    url: baseURL,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
