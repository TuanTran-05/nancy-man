# Ops Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phát hành một Ops Console chỉ-đọc, có TOTP, tại `https://man.thienuy.edu.vn` để giám sát EduTrack/PostgreSQL/cron/backup/lỗi và cảnh báo Zalo Bot.

**Architecture:** Xây `ops-console/` là package Node/React độc lập với runtime EduTrack. `ops-web` phục vụ dashboard ở loopback `127.0.0.1:3101`; `ops-collector` không public thu metric, log đã lọc, đánh giá incident và gửi Zalo. Cả hai dùng Ops SQLite riêng, còn PostgreSQL chỉ cho role `ops_monitor` thực thi một hàm aggregate `SECURITY DEFINER` đã review.

**Tech Stack:** Node.js 22.22+, TypeScript, React 19, Vite 6, Express 5, `better-sqlite3` 13.0.3, `pg` 8.23.0, Zod 4, Vitest 4, Testing Library, esbuild, systemd, Nginx, Certbot, PostgreSQL 16.

**Spec:** `docs/superpowers/specs/2026-08-23-ops-console-design.md`

## Global Constraints

- Đọc toàn bộ spec trước từng task; website không được restart tiến trình, chạy SQL tùy ý, thay dữ liệu EduTrack hoặc cấu hình production.
- Không dùng account/role EduTrack cho web login; Ops account là username riêng, `scrypt` versioned + TOTP bắt buộc.
- Không persist/send log thô, token, bearer, cookie, password, email, phone, UUID nghiệp vụ, request body hay dữ liệu học viên.
- Browser không bao giờ nhận credential PostgreSQL/Zalo, log source path hay response raw từ PostgreSQL.
- `ops_monitor` không có `SELECT` public tables, DML/DDL, `pg_monitor`, `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION` hoặc `BYPASSRLS`.
- V1 không bật `pg_stat_statements`, `track_io_timing` hay cấu hình PostgreSQL cần restart.
- Collector: service/liveness mỗi 15 giây, PostgreSQL mỗi 60 giây; raw snapshot 30 ngày, aggregate ngày 12 tháng, error/alert/audit 90 ngày.
- Alert Zalo chỉ chứa severity, monitor, thời điểm, số lần và link console; dùng bot Ops riêng với recipient lấy từ link private chat đã mã hóa, dedupe 30 phút, recovery sau 2 mẫu healthy.
- Production release không tiếp tục nếu chưa link được một Ops recipient, TLS/probe fail, least-privilege test fail, hoặc `systemctl --failed` vẫn có `logrotate.service` failed chưa được xử lý trong workstream riêng.

---

## File structure

```text
ops-console/
  package.json                         isolated dependencies and scripts
  package-lock.json                    reproducible package resolution
  tsconfig.json, vite.config.ts        web/test/typecheck configuration
  scripts/build-server.mjs             esbuild server, collector and CLI entries
  src/shared/models.ts                 cross-process monitor, incident and API types
  src/server/config.ts                 strict split web/collector environment parsing
  src/server/storage/{schema,store}.ts Ops SQLite WAL schema, queries and retention
  src/server/security/{crypto,totp,auth}.ts
  src/server/http/{app,authRoutes,monitorRoutes}.ts
  src/server/collector/{healthProbe,postgresProbe,processProbe,logTailer,opsParsers,
                        redactor,statusMachine,collector}.ts
  src/server/alerts/{alertService,zaloBotClient,failsafe}.ts
  src/cli/provision-ops-user.ts        local-only account/TOTP bootstrap command
  src/web/{main,App,api,styles}.tsx    protected responsive dashboard
  src/web/components/*                 focused overview, monitor and incident views
  deploy/{ops.env.example,web.env.example,collector.env.example,
          provision-postgres-monitor.{sh,sql},release-ops.sh,
          nginx/{bootstrap,man.thienuy.edu.vn}.conf,
          systemd/*.service,*.timer,logrotate-ops.conf,README.md}
  src/**/*.test.ts[x]                  unit, contract and UI tests
```

The root application receives no runtime route or dependency changes. It only gets one root-operated PostgreSQL provisioning asset under `ops-console/deploy/`; the existing `/srv/edutrack/current`, PM2 process, app environment and main Nginx vhost remain untouched.

### Task 1: Create the isolated package and validated configuration

**Files:**
- Create: `ops-console/package.json`, `ops-console/package-lock.json`, `ops-console/tsconfig.json`, `ops-console/vite.config.ts`, `ops-console/index.html`
- Create: `ops-console/src/shared/models.ts`, `ops-console/src/server/config.ts`
- Test: `ops-console/src/server/config.test.ts`

**Interfaces:**
- Produces `loadWebConfig(env)`, `loadCollectorConfig(env)` and `loadFailsafeConfig(env)`.
- Produces `MonitorName`, `MonitorLevel`, `MonitorSample`, `Incident`, `DashboardOverview`, `AlertDelivery` from `src/shared/models.ts`.

- [ ] **Step 1: Write failing configuration tests.**

```ts
import { describe, expect, it } from 'vitest';
import { loadCollectorConfig, loadWebConfig } from './config.js';

const base = {
  NODE_ENV: 'test', OPS_DB_PATH: ':memory:', OPS_LISTEN_HOST: '127.0.0.1',
  OPS_PORT: '3101', OPS_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('ops configuration', () => {
  it('rejects a public web listener', () =>
    expect(() => loadWebConfig({ ...base, OPS_LISTEN_HOST: '0.0.0.0' })).toThrow('127.0.0.1'));
it('requires monitor URL, bot token and recipient encryption key for production collector', () =>
    expect(() => loadCollectorConfig({ ...base, NODE_ENV: 'production' })).toThrow();
});
```

- [ ] **Step 2: Create the package manifest/tooling and run the test to prove the failure.**

Create an isolated ESM manifest with exact engines `node >=22.22.0`; runtime dependencies `better-sqlite3@13.0.3`, `express@5.2.1`, `pg@8.23.0`, `zod@4.4.3`, `react@19.2.7`, `react-dom@19.2.7`; development dependencies aligned with the root repo's Vite/Vitest/TypeScript/esbuild versions plus `@types/better-sqlite3`, `@types/express`, `@types/node`, React types, Testing Library, `@playwright/test`, `supertest` and `@types/supertest`. At this task `build` aliases `build:web`; Tasks 5–7 add `build:server` and replace it with `build:web && build:server` once all server entries exist. Add `typecheck`, `test`, `test:watch` and `test:e2e`; Task 3 adds `ops:provision-user`, and Tasks 5–7 add the three `start:*` commands. Configure Vitest node by default and jsdom for `src/web/**/*.test.tsx`.

Run: `cd ops-console && npm install && npm run test -- src/server/config.test.ts`
Expected: FAIL because `config.ts` exports do not yet exist.

- [ ] **Step 3: Define shared types, config validation and build entries.**

Implement exact public types:

```ts
export type MonitorName = 'app_liveness' | 'app_health' | 'app_process' | 'postgres' | 'errors' | 'cron' | 'backup' | 'collector';
export type MonitorLevel = 'unknown' | 'healthy' | 'warning' | 'critical';
export type IncidentState = 'open' | 'acknowledged' | 'recovered';
export interface MonitorSample { monitor: MonitorName; level: MonitorLevel; observedAt: string; latencyMs: number | null; details: Record<string, unknown>; errorCode: string | null; }
export interface Incident { id: string; dedupeKey: string; monitor: MonitorName; level: Exclude<MonitorLevel, 'unknown' | 'healthy'>; state: IncidentState; occurrenceCount: number; openedAt: string; lastSeenAt: string; recoveredAt: string | null; acknowledgedAt: string | null; acknowledgedBy: string | null; note: string | null; safeSummary: string; }
export interface AlertDelivery { id: string; incidentId: string; recipientId: string; kind: 'opened' | 'reminder' | 'recovered' | 'collector_failed'; state: 'queued' | 'sending' | 'sent' | 'failed' | 'delivery_ambiguous'; attemptCount: number; nextAttemptAt: string; lastErrorCode: string | null; }
export interface DashboardOverview { collectedAt: string | null; latestByMonitor: Partial<Record<MonitorName, MonitorSample>>; openIncidents: Incident[]; recentDeliveries: AlertDelivery[]; }
```

`loadWebConfig` accepts only loopback listener and validates a 32-byte base64 `OPS_DATA_KEY`, the separate Ops bot token, webhook/link secrets and recipient encryption key. `loadCollectorConfig` deliberately does **not** read `OPS_DATA_KEY`; it requires only loopback app URL, PostgreSQL monitor URL, current PM2/error/cron/backup paths, the same Ops bot token, recipient encryption key and a 5–60 second Zalo timeout. Active recipients come from the authenticated private-chat link table, with static recipient IDs retained only as an optional migration fallback. `loadFailsafeConfig` reads the shared Ops DB path, bot token, recipient key and timeout. Vite builds only `src/web/main.tsx`; Task 5 introduces the Node esbuild process after the first executable collector entry exists.

- [ ] **Step 4: Run package gates.**

Run: `cd ops-console && npm run typecheck && npm run test -- src/server/config.test.ts && npm run build:web`
Expected: PASS; the browser build contains no `.env` values and is ready for the protected application shell added in Task 7.

- [ ] **Step 5: Commit the isolated scaffold.**

```bash
git add ops-console
git commit -m "feat(ops): scaffold isolated console runtime"
```

### Task 2: Build the independent Ops SQLite store and retention model

**Files:**
- Create: `ops-console/src/server/storage/schema.ts`, `ops-console/src/server/storage/store.ts`
- Test: `ops-console/src/server/storage/store.test.ts`

**Interfaces:**
- Consumes `MonitorSample` and `Incident` from Task 1.
- Produces `createOpsStore(path, now): OpsStore`, `recordSample`, `upsertIncident`, `acknowledgeIncident`, `claimDueDeliveries`, `recordAuditEvent`, `readDashboardOverview`, `pruneRetention`, and `getCursor`/`setCursor`.

`OpsStore` is the exact boundary later tasks use:

```ts
export interface OpsStore {
  recordSample(sample: MonitorSample): void;
  upsertIncident(input: Omit<Incident, 'id' | 'openedAt' | 'lastSeenAt' | 'occurrenceCount'> & { now: string }): Incident;
  getIncident(id: string): Incident | undefined;
  acknowledgeIncident(id: string, input: { accountId: string; note: string; now: string }): Incident;
  enqueueDelivery(input: Omit<AlertDelivery, 'id' | 'attemptCount' | 'state'>): AlertDelivery;
  claimDueDeliveries(now: string, limit: number): AlertDelivery[];
  recordAuditEvent(input: { actorId: string | null; action: string; target: string; details: Record<string, string>; occurredAt: string }): void;
  listAuditEvents(): Array<{ actorId: string | null; action: string; target: string; occurredAt: string }>;
  readDashboardOverview(now?: string): DashboardOverview;
  getCursor(source: string): { inode: number; offset: number } | undefined;
  setCursor(source: string, cursor: { inode: number; offset: number }): void;
  pruneRetention(now?: string): void;
}
```

- [ ] **Step 1: Write failing store tests using a temporary file database.**

```ts
it('retains only sanitized samples inside the 30-day window', () => {
  const store = createOpsStore(tempDbPath, () => new Date('2026-08-23T00:00:00Z'));
  store.recordSample({ monitor: 'postgres', level: 'healthy', observedAt: '2026-07-23T00:00:00Z', latencyMs: 4, details: {}, errorCode: null });
  store.pruneRetention();
  expect(store.readDashboardOverview().latestByMonitor.postgres).toBeUndefined();
});

it('acknowledges an incident without modifying its source sample', () => {
  const incident = store.upsertIncident({ dedupeKey: 'postgres:database_unreachable', monitor: 'postgres', level: 'critical', state: 'open', recoveredAt: null, acknowledgedAt: null, acknowledgedBy: null, note: null, safeSummary: 'Database unavailable', now: '2026-08-23T00:00:00Z' });
  store.acknowledgeIncident(incident.id, { accountId: 'ops-a', note: 'Đã xem', now: '2026-08-23T00:01:00Z' });
  expect(store.getIncident(incident.id)).toMatchObject({ state: 'acknowledged', acknowledgedBy: 'ops-a' });
});
```

- [ ] **Step 2: Run the store tests to verify they fail.**

Run: `cd ops-console && npm run test -- src/server/storage/store.test.ts`
Expected: FAIL because `createOpsStore` is undefined.

- [ ] **Step 3: Implement schema migrations and the repository.**

Open SQLite with `better-sqlite3`, set `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, and `synchronous=FULL`. Maintain `schema_version` and transactional migrations for `accounts`, `sessions`, `login_attempts`, `monitor_samples`, `incidents`, `alert_deliveries`, `audit_events`, `collector_cursors`, and `daily_rollups`. Store structured detail as JSON text only after source-specific redaction. Hash session tokens and never store a bearer cookie value. Make all inserts parameterized; cap `safe_summary` at 500 chars and `note` at 500 chars.

`pruneRetention` deletes raw samples older than 30 days, compacts older snapshots into daily rows through 12 months, and deletes error/incident/delivery/audit rows older than 90 days without deleting an unresolved incident. `readDashboardOverview` always exposes newest timestamp so UI can mark stale data.

- [ ] **Step 4: Run repository and package tests.**

Run: `cd ops-console && npm run test -- src/server/storage/store.test.ts && npm run typecheck`
Expected: PASS, including WAL/migration, retention, acknowledgement, cursor and retry-claim test cases.

- [ ] **Step 5: Commit the store.**

```bash
git add ops-console/src/server/storage ops-console/src/shared/models.ts
git commit -m "feat(ops): persist isolated monitoring state"
```

### Task 3: Add isolated account, TOTP and session security

**Files:**
- Create: `ops-console/src/server/security/crypto.ts`, `ops-console/src/server/security/totp.ts`, `ops-console/src/server/security/auth.ts`
- Create: `ops-console/src/cli/provision-ops-user.ts`
- Test: `ops-console/src/server/security/crypto.test.ts`, `ops-console/src/server/security/totp.test.ts`, `ops-console/src/server/security/auth.test.ts`

**Interfaces:**
- Consumes `OpsStore`, `loadWebConfig` and `OPS_DATA_KEY`.
- Produces `provisionAccount`, `authenticate`, `createSession`, `requireSession`, `destroySession`, `verifyTotp` and `encryptSecret`/`decryptSecret`.

- [ ] **Step 1: Write failing crypto/TOTP/auth tests.**

```ts
const fixture = await createAuthFixture({ username: 'ops-a', password: 'correct horse battery staple', totpSeed: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' });

it('accepts RFC 6238 SHA-1 TOTP in the adjacent 30-second window', () => {
  expect(verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', new Date(59_000))).toBe(true);
});

it('rejects an expired server-side session and records a rate-limited failed login', async () => {
  await expect(fixture.auth.authenticate({ username: 'ops-a', password: 'wrong', totp: '000000' })).rejects.toThrow('Invalid credentials');
  expect(fixture.store.listAuditEvents()).toContainEqual(expect.objectContaining({ action: 'login_failed' }));
});
```

- [ ] **Step 2: Run security tests to verify they fail.**

Run: `cd ops-console && npm run test -- src/server/security`
Expected: FAIL because the security modules do not exist.

- [ ] **Step 3: Implement credential and session primitives.**

Use `crypto.scrypt` with parameters encoded in the hash string, a 16-byte salt, 64-byte derived key and `timingSafeEqual`; never log password/TOTP. Encrypt every TOTP seed with AES-256-GCM using the validated 32-byte `OPS_DATA_KEY`, a random 12-byte IV and an authenticated tag. Implement RFC 6238 HMAC-SHA1, six digits, 30-second period, accepting counters `current-1`, `current`, `current+1` exactly once per login attempt.

Create `createAuthFixture` in the test file using temporary SQLite and the fixed test data above. CLI must require TTY password input, generate a random Base32 seed, print the one-time `otpauth://totp/ThienUy%20Ops:<username>?secret=...&issuer=ThienUy%20Ops&digits=6&period=30` enrollment URI, and create an `account_provisioned` audit entry. It must refuse duplicate usernames. Browser session tokens are random 32 bytes, stored only as SHA-256 hashes, have 15-minute idle and 8-hour absolute expiry, rotate at login and carry a stored random CSRF token. Persist five failed attempts/15 minutes as a lockout and return the same `Invalid credentials` message for unknown user, password and TOTP failure.

- [ ] **Step 4: Run security gates.**

Run: `cd ops-console && npm run test -- src/server/security && npm run typecheck`
Expected: PASS; tests assert no plaintext password, TOTP seed or session cookie appears in SQLite/audit output.

- [ ] **Step 5: Commit authentication.**

```bash
git add ops-console/src/server/security ops-console/src/cli/provision-ops-user.ts
git commit -m "feat(ops): secure independent operator access"
```

### Task 4: Provision a least-privilege PostgreSQL metric surface

**Files:**
- Create: `ops-console/deploy/provision-postgres-monitor.sql`, `ops-console/deploy/provision-postgres-monitor.sh`
- Create: `ops-console/src/server/collector/postgresProbe.ts`
- Test: `ops-console/deploy/provision-postgres-monitor.test.ts`, `ops-console/src/server/collector/postgresProbe.test.ts`, `ops-console/src/server/collector/postgresProbe.contract.test.ts`

**Interfaces:**
- Produces PostgreSQL function `ops_metrics.snapshot() returns jsonb` and login role `ops_monitor`.
- Produces `probePostgres(config, now): Promise<MonitorSample>`.

- [ ] **Step 1: Write failing SQL policy and probe tests.**

```ts
it('exposes only execute on the fixed aggregate function', () => {
  const sql = readFileSync(sqlPath, 'utf8');
  expect(sql).toContain('GRANT EXECUTE ON FUNCTION ops_metrics.snapshot() TO ops_monitor');
  expect(sql).not.toMatch(/pg_monitor|GRANT\s+SELECT\s+ON\s+ALL\s+TABLES|EXECUTE\s+IMMEDIATE/i);
});

it('turns a PostgreSQL connection error into a sanitized critical sample', async () => {
  await expect(probePostgres(failingConfig, now)).resolves.toMatchObject({ monitor: 'postgres', level: 'critical', errorCode: 'database_unreachable' });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd ops-console && npm run test -- deploy/provision-postgres-monitor.test.ts src/server/collector/postgresProbe.test.ts`
Expected: FAIL because the provisioning SQL and probe do not exist.

- [ ] **Step 3: Implement idempotent root provisioning and the fixed aggregate.**

`provision-postgres-monitor.sh` must require root, read one password from `OPS_MONITOR_PASSWORD_FILE` (mode 600), invoke `runuser -u postgres -- psql` with `ON_ERROR_STOP=1`, and never echo password/URL. SQL creates `ops_metrics_owner NOLOGIN NOINHERIT` and `ops_monitor LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, revokes `PUBLIC`, creates `ops_metrics` owned by the owner role, and grants only `USAGE` schema + `EXECUTE` function to `ops_monitor`.

Define exactly one zero-argument `SECURITY DEFINER` SQL function with `SET search_path = pg_catalog` returning JSON for database size, connection state counts, active count, waiting lock count, deadlock/rollback/temp counters, user table `{table, liveTuples, deadTuples, lastAutovacuum, lastAutoanalyze}` list, and safe settings `{maxConnections, trackIoTiming, extensions}`. It must not select a business column, `pg_stat_activity.query`, WAL directory, role password, query text or dynamic object name. `postgresProbe` runs only `SELECT ops_metrics.snapshot() AS snapshot`, measures latency, validates exact fields with Zod and maps connection/validation failure to `database_unreachable`/`database_invalid_metric`.

- [ ] **Step 4: Run unit and opt-in live contract checks.**

Run: `cd ops-console && npm run test -- deploy/provision-postgres-monitor.test.ts src/server/collector/postgresProbe.test.ts`
Expected: PASS.

When a disposable PostgreSQL is supplied, run:

```bash
OPS_MONITOR_DATABASE_URL="$OPS_MONITOR_DATABASE_URL" npm run test -- src/server/collector/postgresProbe.contract.test.ts
```

Expected: `ops_monitor` can execute `ops_metrics.snapshot()` and every assertion for `has_table_privilege(..., 'SELECT')`, `has_database_privilege(..., 'CREATE')` and DML attempts is false/rejected.

- [ ] **Step 5: Commit the metric surface.**

```bash
git add ops-console/deploy/provision-postgres-monitor.* ops-console/src/server/collector/postgresProbe.*
git commit -m "feat(ops): add least-privilege postgres metrics"
```

### Task 5: Implement safe collection, parsing and incident state transitions

**Files:**
- Create: `ops-console/src/server/collector/healthProbe.ts`, `processProbe.ts`, `logTailer.ts`, `opsParsers.ts`, `redactor.ts`, `statusMachine.ts`, `collector.ts`, `collector-main.ts`
- Create: `ops-console/scripts/build-server.mjs`
- Test: matching `*.test.ts` files under `ops-console/src/server/collector/`

**Interfaces:**
- Consumes Task 2 store and Task 4 `probePostgres`.
- Produces `runCollectorCycle(deps, now)`, `redactLogLine(line)`, `tailSinceCursor(path, cursor)`, `evaluateMonitor(history, sample)` and `parseCronAndBackupState(input, now)`.

- [ ] **Step 1: Write failing source-specific tests.**

```ts
it('removes credentials, email, phone, UUID and JSON payload before fingerprinting', () => {
  const result = redactLogLine('Bearer abc.def password=x user=a@b.vn phone=0912345678 id=123e4567-e89b-12d3-a456-426614174000 {"token":"x"}');
  expect(result.safeText).not.toMatch(/abc|a@b|0912345678|123e4567|\{"token"/);
});

it('raises critical only after two failed app probes and recovers after two healthy probes', () => {
  expect(evaluateMonitor(appHistoryWithTwoFailures, failedLiveness).level).toBe('critical');
  expect(evaluateMonitor(criticalHistoryWithTwoSuccesses, healthyLiveness).transition).toBe('recovered');
});
```

- [ ] **Step 2: Run collector tests to verify they fail.**

Run: `cd ops-console && npm run test -- src/server/collector`
Expected: FAIL because collection modules are not implemented.

- [ ] **Step 3: Implement deterministic probes and redaction.**

Probe only configured loopback URLs with `AbortSignal.timeout(5_000)`; use the fixed `/api/v1/liveness` and `/api/v1/health` JSON contract. Read the configured PM2 PID file as a decimal PID, verify it through `/proc/<pid>/stat` and `/proc/<pid>/status`, and never invoke `pm2`, `ps`, a shell or a user-provided path. Tail configured logs via Node fs APIs; persist `{inode, offset}` cursor, reset offset to zero if copytruncate shrinks a file, reset on inode change, and start at EOF for a new cursor.

Redact before storage/fingerprint with explicit patterns for `Authorization/Bearer`, `token`, `secret`, `password`, `cookie`, URI credentials, email, Vietnam phone numbers, UUID and JSON object/array bodies. Return a capped 500-character excerpt and SHA-256 fingerprint over the redacted normalized line. Parse only fixed successful/failure markers emitted by `run-cron.sh` and `backup-postgres.sh`; inspect backup directory file mtime/name/paired `.sha256` via fs APIs, never decrypt archive content.

Implement every approved threshold: app/process two consecutive failures critical; Postgres two consecutive failures critical; waiting locks two snapshots warning and 5 minutes critical; connections >80%/5m warning and >90%/5m critical; backup filesystem >80% warning/>90% critical; verified encrypted backup age >26h and cron schedule+30m critical; local-only backup warning; same error fingerprint >=10/5m or new `FATAL` critical. Start at `unknown` and emit no alert until baseline exists; require two healthy samples to recover.

Add `scripts/build-server.mjs` with an esbuild ESM/Node22 bundle for `src/server/collector-main.ts`, and add `start:collector` plus `build:server` scripts. Keep `build` as `build:web` until Tasks 6 and 7 add every required server entry.

- [ ] **Step 4: Run complete collector gates.**

Run: `cd ops-console && npm run test -- src/server/collector && npm run typecheck`
Expected: PASS for copytruncate/rotation, all redaction classes, non-public probes, each threshold, stale snapshot and no historical-startup alert.

- [ ] **Step 5: Commit collection and evaluation.**

```bash
git add ops-console/src/server/collector
git commit -m "feat(ops): collect sanitized operational signals"
```

### Task 6: Persist, deduplicate and send Zalo alerts safely

**Files:**
- Create: `ops-console/src/server/alerts/alertService.ts`, `zaloBotClient.ts`, `failsafe.ts`, `failsafe-main.ts`
- Test: `ops-console/src/server/alerts/alertService.test.ts`, `zaloBotClient.test.ts`, `failsafe.test.ts`

**Interfaces:**
- Consumes collector transitions and `OpsStore` delivery queue.
- Produces `openOrUpdateIncident`, `queueTransitionDelivery`, `deliverDueAlerts`, `sendZaloText`, `sendCollectorFailureNotice`.

- [ ] **Step 1: Write failing alert tests.**

```ts
it('sends on transition, suppresses the same fingerprint for 30 minutes, then sends recovery once', async () => {
  await service.queueTransitionDelivery(criticalTransition);
  await service.queueTransitionDelivery(repeatedCriticalTransition);
  expect(sender).toHaveBeenCalledTimes(1);
  await service.queueTransitionDelivery(recoveredTransition);
  expect(sender).toHaveBeenCalledTimes(2);
});

it('never places a redacted excerpt in a Zalo message', async () => {
  await service.queueTransitionDelivery({ ...criticalTransition, safeSummary: 'Bearer [redacted]' });
  expect(sender).toHaveBeenCalledWith(expect.objectContaining({ text: expect.not.stringContaining('Bearer') }));
});
```

- [ ] **Step 2: Run alert tests to verify they fail.**

Run: `cd ops-console && npm run test -- src/server/alerts`
Expected: FAIL because alert services do not exist.

- [ ] **Step 3: Implement outbox, Zalo client and independent failsafe.**

One incident dedupe key is `<monitor>:<fingerprint-or-state>`. Queue on transition, persist delivery attempt before send, cap normal retry at five attempts with exponential delays 60s, 120s, 240s, 480s, 960s, and record `delivery_ambiguous` for network timeout. Use the proven Bot API contract:

```ts
await fetch(`https://bot-api.zaloplatforms.com/bot${token}/sendMessage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: recipientId, text }), signal: AbortSignal.timeout(timeoutMs),
});
```

Validate the `{ ok, result: { message_id } }` envelope with Zod, enforce 1–2000 chars and map 401 to non-retryable auth failure, 429/403/408/5xx to bounded retry, and invalid recipient to permanent failure. Alert text is fixed fields only: severity, monitor label, occurrence count, Vietnam-local timestamp, `https://man.thienuy.edu.vn`, and recovered state. The `OnFailure` failsafe sends only `CRITICAL: ops-collector stopped; open https://man.thienuy.edu.vn`; it does not open SQLite, tail logs or parse untrusted input.

Extend the Task 5 esbuild entry list with `src/server/alerts/failsafe-main.ts` and add `start:failsafe`; `npm run build:server` must now emit `collector-main.js` and `failsafe-main.js`.

- [ ] **Step 4: Run alert tests.**

Run: `cd ops-console && npm run test -- src/server/alerts && npm run typecheck`
Expected: PASS for transition/dedupe/cooldown/recovery, max retry, provider error mapping, ambiguous delivery and fixed failsafe payload.

- [ ] **Step 5: Commit alert delivery.**

```bash
git add ops-console/src/server/alerts
git commit -m "feat(ops): alert operators through Zalo Bot"
```

### Task 7: Serve a protected read-only API and dashboard

**Files:**
- Create: `ops-console/src/server/http/app.ts`, `authRoutes.ts`, `monitorRoutes.ts`, `web-server.ts`
- Create: `ops-console/src/web/main.tsx`, `App.tsx`, `api.ts`, `styles.css`
- Create: `ops-console/src/web/components/{LoginForm,OverviewCards,MonitorPanel,IncidentList,AcknowledgeDialog}.tsx`
- Test: HTTP `*.test.ts` and component `*.test.tsx` peers

**Interfaces:**
- Consumes Task 2–3 `OpsStore`/auth and Task 1 `DashboardOverview`.
- Produces public `POST /api/session`, `DELETE /api/session`; protected `GET /api/session`, `GET /api/overview`, `GET /api/incidents`, `POST /api/incidents/:id/ack`.

- [ ] **Step 1: Write failing HTTP and UI tests.**

```ts
it('denies monitoring API without an Ops session', async () => {
  await request(app).get('/api/overview').expect(401);
});
it('rejects an acknowledge request without the session CSRF token', async () => {
  await request(app).post('/api/incidents/i-1/ack').set('Cookie', sessionCookie).expect(403);
});
it('renders stale state instead of presenting an old healthy sample as current', () => {
  render(<OverviewCards overview={{ ...healthyOverview, collectedAt: oldTimestamp }} />);
  expect(screen.getByText(/Dữ liệu cũ/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run HTTP/UI tests to verify they fail.**

Run: `cd ops-console && npm run test -- src/server/http src/web`
Expected: FAIL because routes and React components do not exist.

- [ ] **Step 3: Implement API boundaries and browser views.**

Use `express.json({ limit: '16kb' })`, disable `x-powered-by`, trust one local proxy, set no-store on auth/API responses, and serve the Vite build only after API routes. `POST /api/session` accepts `{username,password,totp}`, returns generic 401 on every auth failure and sets `__Host-ops_session` as `Secure; HttpOnly; SameSite=Strict; Path=/`; `GET /api/session` supplies a CSRF token only to an authenticated browser. Protected APIs expose store DTOs with fixed, allowlisted fields. Acknowledge accepts a 1–500 char plain-text note, requires `X-CSRF-Token`, and creates only an Ops audit record.

Build a single responsive page: overall/stale banner; service, PostgreSQL, cron/backup cards; errors/incidents with status/filter/timeline; an acknowledge dialog. Poll `/api/overview` every 15 seconds while visible, use text content only for excerpts, expose unavailable capabilities as `Không khả dụng`, and do not render raw HTML. There are no SQL, restart, settings, account-management or EduTrack navigation controls.

Extend the Task 5 esbuild entry list with `src/server/http/web-server.ts` and the Task 3 provision CLI. Add `start:web`, `ops:provision-user`, and change `build` to `npm run build:web && npm run build:server`; it must emit `web-server.js`, `collector-main.js`, `failsafe-main.js` and `provision-ops-user.js`.

- [ ] **Step 4: Run API, UI and build gates.**

Run: `cd ops-console && npm run test -- src/server/http src/web && npm run typecheck && npm run build`
Expected: PASS; unauthenticated browser cannot access monitor data, and the built JS contains neither `OPS_` secret values nor source file paths.

- [ ] **Step 5: Commit the dashboard.**

```bash
git add ops-console/src/server/http ops-console/src/web
git commit -m "feat(ops): provide protected monitoring dashboard"
```

### Task 8: Add reproducible systemd, Nginx, TLS and PostgreSQL deployment assets

**Files:**
- Create: `ops-console/deploy/{ops.env.example,web.env.example,collector.env.example,release-ops.sh,README.md,logrotate-ops.conf}`
- Create: `ops-console/deploy/systemd/{edutrack-ops-web.service,edutrack-ops-collector.service,edutrack-ops-collector-failed@.service,edutrack-ops-backup.service,edutrack-ops-backup.timer}`
- Create: `ops-console/deploy/nginx/{bootstrap.conf,man.thienuy.edu.vn.conf,activate-host.sh}`
- Test: `ops-console/deploy/deployment-assets.test.ts`

**Interfaces:**
- Consumes the four built Node entries and Vite assets from Task 1, plus Task 4 provisioner.
- Produces root-operated release at `/srv/edutrack-ops/releases/<commit>`, atomic `current` symlink, service names and a single Nginx vhost for `man.thienuy.edu.vn`.

- [ ] **Step 1: Write failing deployment asset tests.**

```ts
it('binds only Ops Web to loopback and never starts PM2 or touches the EduTrack current symlink', () => {
  const release = readFileSync('deploy/release-ops.sh', 'utf8');
  expect(release).toContain('/srv/edutrack-ops/current');
  expect(release).not.toMatch(/pm2\s+(restart|reload|start)|\/srv\/edutrack\/current/);
});
it('uses a strict TLS vhost for man.thienuy.edu.vn only', () => {
  expect(readFileSync('deploy/nginx/man.thienuy.edu.vn.conf', 'utf8')).toContain('server_name man.thienuy.edu.vn;');
});
```

- [ ] **Step 2: Run deployment tests to verify they fail.**

Run: `cd ops-console && npm run test -- deploy/deployment-assets.test.ts`
Expected: FAIL because deployment assets do not exist.

- [ ] **Step 3: Implement hardened installation assets.**

`release-ops.sh` requires root and a verified build directory; creates `edutrack-ops-web` user and `edutrack-ops` group, adds only `deploy` and the web user to the group, creates `/srv/edutrack-ops/{releases,shared}` group-writable with setgid, atomically switches `/srv/edutrack-ops/current`, installs root-owned `/etc/edutrack-ops/{web,collector}.env` at mode 640, and restarts only the two Ops services. Web service runs as `edutrack-ops-web`; collector and failsafe run as `deploy` solely to read existing PM2/cron/backup files. Both have `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, explicit `ReadWritePaths=/srv/edutrack-ops/shared`, and fixed `ExecStart` paths. Collector has `Restart=on-failure`, `WatchdogSec=45`, `OnFailure=edutrack-ops-collector-failed@%n.service`. Backup service uses SQLite `.backup` to create a mode-0600 copy plus release metadata daily.

The Nginx bootstrap vhost permits only `/.well-known/acme-challenge/` on port 80 then redirects to HTTPS. The TLS vhost has the exact single hostname, HSTS, noindex, CSP `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`, 16 KB body limit, login rate limiting, and proxies only `/` to `127.0.0.1:3101`; it has no `/api` route to port 3000. `activate-host.sh` follows the existing webroot-Certbot flow but writes `/etc/nginx/sites-available/man.thienuy.edu.vn`, validates `nginx -t` before each reload and rolls the vhost back on failure.

- [ ] **Step 4: Run static deployment checks.**

Run: `cd ops-console && npm run test -- deploy/deployment-assets.test.ts && shellcheck deploy/release-ops.sh deploy/nginx/activate-host.sh deploy/provision-postgres-monitor.sh`
Expected: PASS; no PM2/main-app mutation path, no public listener and no source secret in an example file.

- [ ] **Step 5: Commit deployment automation.**

```bash
git add ops-console/deploy
git commit -m "feat(ops): automate isolated console deployment"
```

### Task 9: Execute staging-like verification and the guarded production release

**Files:**
- Create: `ops-console/e2e/ops-console.spec.ts`, `ops-console/deploy/release-checklist.md`
- Modify: `ops-console/deploy/README.md`
- Test: `ops-console/e2e/ops-console.spec.ts`

**Interfaces:**
- Consumes all previous task outputs.
- Produces a repeatable verification record and an explicit, reversible release procedure.

- [ ] **Step 1: Write end-to-end and checklist assertions before release.**

```ts
test('an operator completes password plus TOTP login and can acknowledge, but cannot find a destructive control', async ({ page }) => {
  await page.goto(process.env.OPS_E2E_BASE_URL!);
  await page.getByLabel('Tên đăng nhập').fill('ops-e2e');
  await page.getByLabel('Mật khẩu').fill(process.env.OPS_E2E_PASSWORD!);
  await page.getByLabel('Mã xác thực').fill(process.env.OPS_E2E_TOTP!);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('button', { name: /Xác nhận đã xem/ })).toBeVisible();
  await expect(page.getByText(/Restart|Chạy SQL/i)).toHaveCount(0);
});
```

- [ ] **Step 2: Run local integration tests to verify the E2E test fails before services are started.**

Run: `cd ops-console && OPS_E2E_BASE_URL=http://127.0.0.1:3101 npm run test:e2e -- e2e/ops-console.spec.ts`
Expected: FAIL with connection refusal until the verified local server fixture is running.

- [ ] **Step 3: Implement the fixture and exact release checklist.**

E2E fixture starts a temp SQLite web server with deterministic account/TOTP and mock sources. The checklist must require, in this order: all Task 1–8 gates green; `systemctl --failed` investigated/resolved (including existing `logrotate.service` failure); secret files and separate Ops bot secrets provisioned outside git; backup of `/srv/edutrack-ops/shared`; dry-run PostgreSQL role/function inspection; Nginx bootstrap and Certbot issuance; authenticated HTTPS SNI check; collector liveness/health/DB/cron/backup samples; one-time code link from the authenticated console to the private Ops bot chat; synthetic critical then two-sample recovery Zalo delivery to that linked chat; certificate renewal dry run; and atomic rollback to prior Ops symlink if any gate fails. The checklist explicitly forbids restarting PM2, PostgreSQL or the EduTrack service.

- [ ] **Step 4: Run final release gates and record results.**

Run:

```bash
cd ops-console
npm run typecheck
npm run test
npm run build
npm run test:e2e -- e2e/ops-console.spec.ts
sudo /srv/edutrack-ops/current/deploy/nginx/activate-host.sh man.thienuy.edu.vn
curl --fail --resolve man.thienuy.edu.vn:443:14.225.198.57 https://man.thienuy.edu.vn/api/session
sudo certbot renew --dry-run
```

Expected: all application/test gates pass; unauthenticated session endpoint returns 401 over valid TLS; renewal succeeds; a documented synthetic alert and recovery arrive only at the approved Ops recipient.

- [ ] **Step 5: Commit verification assets and release only after the checklist is signed off.**

```bash
git add ops-console/e2e ops-console/deploy
git commit -m "test(ops): verify guarded console rollout"
```

Run the production release commands only after the release checklist is completed and the user approves the actual cutover window.

## Plan self-review

### Spec coverage

- Separate runtime, loopback web, independent Ops SQLite, systemd collector and Nginx/TLS: Tasks 1, 2 and 8.
- Separate accounts, scrypt/TOTP/session, strict read-only API and audit: Tasks 3 and 7.
- PostgreSQL least privilege and aggregate-only metrics without query text/restart-required extensions: Task 4.
- 15s/60s collection, error redaction, threshold state machine, retention and current platform logs/artifacts: Task 5.
- Dashboard cards/feed/acknowledge, stale/unknown state: Task 7.
- Separate Ops bot link, encrypted recipient resolution, cooldown, retry, recovery and collector failure alert: Task 6 and Task 8.
- Tests, security checks, deployment, TLS, rollback and synthetic alert: Task 9.

### Placeholder scan

No incomplete marker, deferred implementation phrase, undefined interface or generic test instruction remains. Secrets, recipient IDs and production credential values are intentionally provisioned outside git and have explicit release gates rather than placeholders.

### Type consistency

`MonitorName`, `MonitorLevel`, `Incident`, `MonitorSample` and `OpsStore` are introduced before later Tasks consume them. All external HTTP routes, SQL function and alert function names are declared in the producing task.
