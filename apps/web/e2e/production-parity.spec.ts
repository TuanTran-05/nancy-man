import { createHmac } from 'node:crypto';
import { copyFile, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';

import { parseOpsE2eBaseUrl } from './baseUrl.js';
import { createOpsApp } from '../src/server/http/app.js';
import { createAuthService } from '../src/server/security/auth.js';
import { encryptSecret, hashPassword } from '../src/server/security/crypto.js';
import { createOpsStore, type OpsStore } from '../src/server/storage/store.js';

// @ts-expect-error The production capture is an intentionally dependency-free ESM tool.
import { buildPublicContract } from '../../../scripts/ops/capture-public-contract.mjs';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const storedContractPath = join(
  repositoryRoot,
  'docs/architecture/baselines/2026-08-29-ops-public-contract.json'
);
const dataKey = Buffer.alloc(32, 17);
const recipientKey = Buffer.alloc(32, 19);
const totpSeed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const username = 'ops-parity-e2e';
const password = 'correct horse battery staple';
const syntheticNow = '2030-08-30T01:02:03.000Z';
const syntheticAccountId = '10000000-0000-4000-8000-000000000007';
const syntheticIncidentId = '20000000-0000-4000-8000-000000000007';
const forbiddenCandidateText =
  /(?:\/srv\/edutrack-ops|\.sqlite|select\s+.+\s+from|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/iu;
const sqliteDataTables = [
  'accounts',
  'alert_deliveries',
  'audit_events',
  'collector_cursors',
  'daily_rollups',
  'incidents',
  'login_attempts',
  'monitor_samples',
  'sessions',
  'zalo_link_codes',
  'zalo_links',
  'zalo_webhook_events'
] as const;
const expectedSqliteTables = [...sqliteDataTables, 'schema_version', 'sqlite_sequence'].sort();

let candidateOrigin: string;
let apiOrigin: string | undefined;
let candidateServer: Server | undefined;
let candidateStore: OpsStore | undefined;
let candidateDirectory: string | undefined;
let browserContacts: string[] = [];
let usingSnapshot = false;

const expectedStoredContract = {
  schemaVersion: 1,
  entries: [
    {
      route: { method: 'GET', path: '/' },
      status: 200,
      jsonShape: null,
      securityHeaders: { 'cache-control': 'public, max-age=3600' },
      uiLandmarks: [
        '#root',
        'html[lang=vi]',
        'meta[name=robots][content=noindex,nofollow]',
        'title=Thien Uy Ops Console'
      ]
    },
    {
      route: { method: 'GET', path: '/api/overview' },
      status: 401,
      jsonShape: { type: 'object', keys: { error: { type: 'string' } } },
      securityHeaders: { 'cache-control': 'no-store' },
      uiLandmarks: []
    },
    {
      route: { method: 'GET', path: '/api/session' },
      status: 401,
      jsonShape: { type: 'object', keys: { error: { type: 'string' } } },
      securityHeaders: { 'cache-control': 'no-store' },
      uiLandmarks: []
    }
  ]
};

function safeFail(code: string): never {
  throw new Error(code);
}

async function listen(app: ReturnType<typeof createOpsApp>, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1');
    const onError = () => {
      server.close();
      reject(new Error('OPS_PARITY_BIND_FAILED'));
    };
    server.once('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(new Error('OPS_PARITY_CLOSE_FAILED')) : resolve()))
  );
}

function parseCandidateOrigin(value: string | undefined, fallback: string) {
  return parseOpsE2eBaseUrl(value ?? fallback);
}

async function validateSnapshot(path: string): Promise<void> {
  const resolved = await realpath(path).catch(() => safeFail('OPS_PARITY_SNAPSHOT_INVALID'));
  const root = dirname(resolved);
  if (
    resolved !== path ||
    basename(resolved) !== 'ops.sqlite' ||
    dirname(root) !== '/tmp' ||
    !/^edutrack-ops-parity\.[A-Za-z0-9]{10}$/u.test(basename(root))
  )
    safeFail('OPS_PARITY_SNAPSHOT_INVALID');
  const [rootStat, fileStat] = await Promise.all([lstat(root), lstat(resolved)]);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    rootStat.uid !== process.getuid?.() ||
    (rootStat.mode & 0o777) !== 0o700 ||
    !fileStat.isFile() ||
    fileStat.isSymbolicLink() ||
    fileStat.uid !== process.getuid?.() ||
    (fileStat.mode & 0o777) !== 0o600
  )
    safeFail('OPS_PARITY_SNAPSHOT_INVALID');
}

async function assertNoSqliteSidecars(path: string): Promise<void> {
  for (const suffix of ['-journal', '-shm', '-wal']) {
    try {
      await lstat(`${path}${suffix}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      safeFail('OPS_PARITY_COPY_SIDECAR_CHECK_FAILED');
    }
    safeFail('OPS_PARITY_COPY_SIDECAR_PRESENT');
  }
}

async function sanitizeCopiedDatabase(path: string): Promise<void> {
  const database = new Database(path);
  try {
    const actualTables = (
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map(({ name }) => name);
    if (JSON.stringify(actualTables) !== JSON.stringify(expectedSqliteTables))
      safeFail('OPS_PARITY_COPY_SCHEMA_INVENTORY_MISMATCH');
    if (database.pragma('journal_mode = DELETE', { simple: true }) !== 'delete')
      safeFail('OPS_PARITY_COPY_JOURNAL_MODE_INVALID');
    database.pragma('secure_delete = ON');
    database.pragma('foreign_keys = OFF');
    database.transaction(() => {
      for (const table of sqliteDataTables) database.prepare(`DELETE FROM ${table}`).run();
      database.prepare('DELETE FROM sqlite_sequence').run();
    })();
    database.exec('VACUUM');
    for (const table of [...sqliteDataTables, 'sqlite_sequence']) {
      const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      };
      if (row.count !== 0) safeFail('OPS_PARITY_COPY_SANITIZATION_FAILED');
    }
  } finally {
    database.close();
  }
  await assertNoSqliteSidecars(path);
}

function seedSyntheticFixture(store: OpsStore): void {
  store.createAccount({
    id: syntheticAccountId,
    username,
    passwordHash: hashPassword(password),
    totpSecretEnc: encryptSecret(totpSeed, dataKey),
    createdAt: syntheticNow
  });
  store.recordSample({
    monitor: 'app_liveness',
    level: 'healthy',
    observedAt: syntheticNow,
    latencyMs: 4,
    details: { probeOk: true, release: 'synthetic-task7' },
    errorCode: null
  });
  store.recordSample({
    monitor: 'beszel',
    level: 'healthy',
    observedAt: syntheticNow,
    latencyMs: 4,
    details: {
      probeOk: true,
      hubVersion: 'synthetic-task7',
      systemStatus: 'up',
      metricObservedAt: syntheticNow
    },
    errorCode: null
  });
  store.recordSample({
    monitor: 'host_resources',
    level: 'healthy',
    observedAt: syntheticNow,
    latencyMs: 4,
    details: {
      probeOk: true,
      cpuPercent: 42.5,
      memoryPercent: 61.2,
      memoryUsedBytes: 6_442_450_944,
      memoryTotalBytes: 10_737_418_240,
      swapPercent: 0,
      swapUsedBytes: 0,
      swapTotalBytes: 2_147_483_648,
      diskPercent: 48,
      diskUsedBytes: 51_539_607_552,
      diskTotalBytes: 107_374_182_400,
      networkReceiveBytesPerSecond: 1200,
      networkTransmitBytesPerSecond: 800,
      diskReadBytesPerSecond: 600,
      diskWriteBytesPerSecond: 300,
      load1: 1.2,
      load5: 0.9,
      load15: 0.7,
      cpuThreads: 4,
      uptimeSeconds: 3600,
      metricObservedAt: syntheticNow
    },
    errorCode: null
  });
  store.recordSample({
    monitor: 'host_services',
    level: 'warning',
    observedAt: syntheticNow,
    latencyMs: 4,
    details: {
      matchedTotal: 1,
      failedServices: ['synthetic-worker'],
      metricObservedAt: syntheticNow,
      services: [
        {
          name: 'synthetic-worker',
          state: 'failed',
          subState: 'failed',
          cpuPercent: 0.1,
          memoryBytes: 16_777_216,
          observedAt: syntheticNow
        }
      ]
    },
    errorCode: 'synthetic_service_failed'
  });
  store
    .getDatabaseForBackup()
    .prepare(
      `INSERT INTO incidents
       (id, dedupe_key, monitor, level, state, occurrence_count, opened_at, last_seen_at,
        recovered_at, acknowledged_at, acknowledged_by, note, safe_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
    )
    .run(
      syntheticIncidentId,
      'synthetic:task7',
      'app_liveness',
      'warning',
      'open',
      1,
      syntheticNow,
      syntheticNow,
      'Synthetic Task 7 incident'
    );
}

async function startSnapshotCandidate(snapshotPath: string, port: number): Promise<void> {
  await validateSnapshot(snapshotPath);
  candidateDirectory = await mkdtemp(join(tmpdir(), 'edutrack-ops-candidate-'));
  const directoryStat = await lstat(candidateDirectory);
  if (
    dirname(candidateDirectory) !== '/tmp' ||
    !/^edutrack-ops-candidate-[A-Za-z0-9]{6}$/u.test(basename(candidateDirectory)) ||
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    directoryStat.uid !== process.getuid?.() ||
    (directoryStat.mode & 0o777) !== 0o700
  )
    safeFail('OPS_PARITY_CANDIDATE_TEMP_INVALID');
  const databasePath = join(candidateDirectory, 'ops.sqlite');
  await copyFile(snapshotPath, databasePath);
  const databaseStat = await lstat(databasePath);
  if (
    !databaseStat.isFile() ||
    databaseStat.isSymbolicLink() ||
    databaseStat.uid !== process.getuid?.() ||
    (databaseStat.mode & 0o777) !== 0o600
  )
    safeFail('OPS_PARITY_CANDIDATE_DATABASE_INVALID');
  await sanitizeCopiedDatabase(databasePath);
  candidateStore = createOpsStore(databasePath, () => new Date(), recipientKey);
  seedSyntheticFixture(candidateStore);
  const auth = createAuthService({ store: candidateStore, dataKey });
  const app = createOpsApp({
    store: candidateStore,
    auth,
    staticDir: join(repositoryRoot, 'apps/web/dist/web'),
    zalo: {
      store: candidateStore,
      auth,
      config: {
        botToken: 'synthetic-local-only',
        webhookSecret: 'w'.repeat(32),
        linkCodePepper: 'p'.repeat(32),
        chatHashSecret: 'h'.repeat(32),
        recipientKey,
        timeoutMs: 5000,
        linkTtlSeconds: 600
      },
      confirmationSender: async () => safeFail('OPS_PARITY_EXTERNAL_DELIVERY_BLOCKED')
    }
  });
  candidateServer = await listen(app, port);
}

async function candidateContract(
  origin: string,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const responses = [];
  for (const route of ['/', '/api/session', '/api/overview'] as const) {
    const response = await fetchImpl(new URL(route, `${origin}/`), {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      headers: { accept: route === '/' ? 'text/html' : 'application/json' }
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > 65_536) safeFail('OPS_PARITY_CANDIDATE_BODY_TOO_LARGE');
    responses.push({
      method: 'GET',
      route,
      status: response.status,
      headers: response.headers,
      body: body.toString('utf8')
    });
  }
  return buildPublicContract(responses);
}

function totp(seed: string, time = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of seed) {
    value = ((value << 5) | alphabet.indexOf(character)) >>> 0;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const moving = Buffer.alloc(8);
  moving.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / 30)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(moving).digest();
  const offset = digest.at(-1)! & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

async function login(page: Page): Promise<void> {
  await page.goto(candidateOrigin);
  await page.getByLabel('Tên đăng nhập').fill(usingSnapshot ? username : 'ops-e2e');
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByLabel('Mã xác thực').fill(totp(totpSeed));
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Hạ tầng VPS' })).toBeVisible();
}

test.beforeAll(async () => {
  const configured = parseOpsE2eBaseUrl(process.env.OPS_E2E_BASE_URL);
  const snapshotPath = process.env.OPS_PARITY_SQLITE_SNAPSHOT;
  usingSnapshot = Boolean(snapshotPath);
  const candidate = parseCandidateOrigin(
    process.env.OPS_PARITY_CANDIDATE_BASE_URL,
    configured.baseURL
  );
  if (snapshotPath && candidate.origin === configured.origin)
    safeFail('OPS_PARITY_SNAPSHOT_REQUIRES_DISTINCT_CANDIDATE_PORT');
  candidateOrigin = candidate.origin;
  if (snapshotPath) await startSnapshotCandidate(snapshotPath, candidate.port);
  apiOrigin = process.env.OPS_PARITY_API_BASE_URL
    ? parseOpsE2eBaseUrl(process.env.OPS_PARITY_API_BASE_URL).origin
    : undefined;
  if (apiOrigin === candidateOrigin || apiOrigin === configured.origin)
    safeFail('OPS_PARITY_API_PORT_INVALID');
});

test.afterAll(async () => {
  const failures: unknown[] = [];
  try {
    await closeServer(candidateServer);
  } catch (error) {
    failures.push(error);
  } finally {
    candidateServer = undefined;
  }
  try {
    const database = candidateStore?.getDatabaseForBackup();
    if (database?.open) database.close();
  } catch (error) {
    failures.push(error);
  } finally {
    candidateStore = undefined;
  }
  if (candidateDirectory) {
    try {
      await assertNoSqliteSidecars(join(candidateDirectory, 'ops.sqlite'));
    } catch (error) {
      failures.push(error);
    }
    try {
      await rm(candidateDirectory, { recursive: true, force: false });
    } catch (error) {
      failures.push(error);
    } finally {
      candidateDirectory = undefined;
    }
  }
  if (failures.length) throw new AggregateError(failures, 'OPS_PARITY_CLEANUP_FAILED');
});

test.beforeEach(async ({ page }) => {
  browserContacts = [];
  page.on('request', (request) => browserContacts.push(request.url()));
});

test.afterEach(async ({ page }, testInfo) => {
  expect(page.isClosed()).toBe(false);
  const escaped = browserContacts.filter((value) => new URL(value).origin !== candidateOrigin);
  expect(escaped).toEqual([]);
  const destinations = [...new Set(browserContacts.map((value) => new URL(value).pathname))].sort();
  console.log(
    `OPS_PARITY_BROWSER_CONTACTS test=${JSON.stringify(testInfo.title)} origin=isolated-candidate external=0 destinations=${JSON.stringify(destinations)}`
  );
});

test('matches the sanitized anonymous production contract without retaining response values', async () => {
  const stored = JSON.parse(await readFile(storedContractPath, 'utf8')) as unknown;
  expect(stored).toEqual(expectedStoredContract);
  await expect(candidateContract(candidateOrigin)).resolves.toEqual(stored);
  await expect(
    candidateContract(candidateOrigin, async (input, init) => {
      const response = await fetch(input, init);
      if (new URL(String(input)).pathname !== '/api/session') return response;
      await response.body?.cancel();
      return new Response('{"error":"unauthorized","nested":{"UsErNaMe":"synthetic"}}', {
        status: response.status,
        headers: response.headers
      });
    })
  ).rejects.toThrow('PUBLIC_CONTRACT_FORBIDDEN_MATERIAL');
});

test('keeps MFA, overview, history and incident acknowledgement functional on synthetic copy-only data', async ({
  page
}) => {
  await login(page);
  await expect(page.getByText('42,5%').first()).toBeVisible();
  await expect(
    page.getByText(usingSnapshot ? 'synthetic-worker' : 'edutrack-worker')
  ).toBeVisible();
  await page.getByRole('button', { name: '7d' }).click();
  await expect(page.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByText(usingSnapshot ? 'Synthetic Task 7 incident' : 'Synthetic E2E incident')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận đã xem' }).click();
  await page.getByLabel('Ghi chú').fill('Synthetic acknowledgement only');
  await page.getByRole('button', { name: 'Lưu acknowledge' }).click();
  await expect(page.getByText('Đã acknowledge')).toBeVisible();
  expect(forbiddenCandidateText.test(await page.locator('body').innerText())).toBe(false);
});

test('rejects the separate API cookie in the monitoring session namespace', async () => {
  const response = await fetch(`${candidateOrigin}/api/session`, {
    headers: { Cookie: '__Host-ops-session=synthetic-api-cookie' }
  });
  expect(response.status).toBe(401);
});

test('keeps API health, ingest validation and SQL denial bounded to an isolated PostgreSQL candidate', async () => {
  test.skip(!apiOrigin, 'isolated PostgreSQL-backed API candidate was not supplied');
  const health = await fetch(`${apiOrigin}/healthz`);
  expect(health.status).toBe(200);
  await expect(health.json()).resolves.toEqual({ status: 'ok' });

  const ingest = await fetch(`${apiOrigin}/api/v1/ingest/browser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://man.thienuy.edu.vn' },
    body: '{}'
  });
  expect(ingest.status).toBe(401);
  await expect(ingest.json()).resolves.toEqual({ accepted: false, code: 'MISSING_PROJECT_KEY' });

  const authorized = await fetch(`${apiOrigin}/api/v1/ingest/browser`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://man.thienuy.edu.vn',
      'X-Ops-Project-Key': 'task7-browser-key'
    },
    body: JSON.stringify({
      schemaVersion: 1,
      eventId: 'EVT_01K3ZABCDEF0123456789ABCDE',
      idempotencyKey: 'task7-idem-0123456789abcdef',
      capturedAt: '2026-08-30T01:02:03.000Z',
      source: 'browser',
      level: 'error',
      error: {
        name: 'Error',
        code: 'TASK7_SYNTHETIC',
        safeMessage: 'Synthetic isolated candidate event'
      },
      context: {
        release: '0123456789abcdef0123456789abcdef01234567',
        service: 'edutrack-web',
        environment: 'production',
        route: '/task7-synthetic'
      }
    })
  });
  expect(authorized.status).toBe(202);
  await expect(authorized.json()).resolves.toEqual({
    accepted: true,
    duplicate: false,
    eventId: 'EVT_01K3ZABCDEF0123456789ABCDE'
  });

  const denied = await fetch(`${apiOrigin}/api/v1/sql/classify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: '__Host-ops_session=synthetic-monitoring-cookie'
    },
    body: JSON.stringify({ sql: 'SELECT 1' })
  });
  expect(denied.status).toBe(404);
});
