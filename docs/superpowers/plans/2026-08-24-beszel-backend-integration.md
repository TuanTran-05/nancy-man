# Beszel Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tích hợp Beszel `v0.18.8` vào collector, state machine, Ops SQLite và authenticated HTTP API mà không cần Beszel thật trong test và không làm thay đổi hành vi khi feature flag tắt.

**Architecture:** Một adapter nhỏ dùng Node `fetch` gọi các endpoint PocketBase cố định, Zod strip mọi field ngoài contract, rồi mapper tạo đúng ba `MonitorSample`: `beszel`, `host_resources`, `host_services`. Collector chạy probe này mỗi 60 giây trong cycle 15 giây; store dùng bảng `monitor_samples` hiện có để tạo history UTC bucket; HTTP API chỉ trả projection allowlist.

**Tech Stack:** Node.js 22, TypeScript 5.8, Zod 4, Express 5, better-sqlite3 13, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-24-beszel-telemetry-integration-design.md`

## Global Constraints

- Pin Beszel đúng `v0.18.8`, runtime Hub phải trả `v=0.18.8`; không tương thích ngầm với release khác.
- Không thêm PocketBase SDK hoặc dependency production mới; dùng `fetch` và Zod đang có.
- Khi `OPS_BESZEL_ENABLED=false`, không đọc credential, không gọi Hub và hành vi collector cũ giữ nguyên.
- Khi enabled, base URL phải đúng `http://127.0.0.1:8090`; system ID phải match `^[a-z0-9]{15}$`.
- Chỉ password file regular, không symlink và nội dung sau trim không rỗng được chấp nhận.
- Token chỉ ở memory; không log token/password/response body, không persist raw Beszel record.
- Collector cycle vẫn 15 giây; Beszel cadence 60 giây; timeout `1000..10000` ms, mặc định `5000`.
- Metric dùng `number | null`; missing upstream field không được đổi thành `0`.
- `systemd_services` `v0.18.8` không có restart count; không thêm hoặc suy diễn field này.
- History chỉ đọc `host_resources`, tối đa 720 điểm, raw retention 30 ngày.
- Thực thi trong worktree cô lập theo `superpowers:using-git-worktrees`. Checkout hiện tại đang có thay đổi chưa commit chạm `collector.ts` và `store.ts`; không copy, stage hay commit chúng. Trước khi bắt đầu, owner phải cung cấp một base commit đã giải quyết các thay đổi đó.

---

## File map

- `ops-console/src/server/beszel/contracts.ts`: Zod schemas pin theo response `v0.18.8` và các type đã parse.
- `ops-console/src/server/beszel/client.ts`: auth, token cache, retry 401 đúng một lần, request timeout và endpoint cố định.
- `ops-console/src/server/beszel/mapper.ts`: đổi unit, enum, allowlist service và tạo normalized snapshot.
- `ops-console/src/server/beszel/probe.ts`: chuyển snapshot/error thành ba monitor sample hoặc một `beszel` failure sample.
- `ops-console/src/server/beszel/fixtures/*.json`: sanitized contract fixtures không chứa hostname/IP/credential thật.
- `ops-console/src/server/config.ts`: discriminated config bật/tắt Beszel.
- `ops-console/src/shared/models.ts`: monitor names và public history types.
- `ops-console/src/server/collector/statusMachine.ts`: threshold hạ tầng, reason priority và two-sample recovery.
- `ops-console/src/server/collector/collector.ts`: cadence 60 giây và persistence của effective level.
- `ops-console/src/server/collector/collector-main.ts`: tạo client/probe một lần khi enabled.
- `ops-console/src/server/storage/store.ts`: parameterized UTC history query.
- `ops-console/src/server/http/monitorRoutes.ts`: projection allowlist và history route.
- Các file `*.test.ts` cạnh module: unit, contract và integration test bằng fake HTTP server.

### Task 1: Lock the v0.18.8 contract and normalized types

**Files:**
- Create: `ops-console/src/server/beszel/contracts.ts`
- Create: `ops-console/src/server/beszel/contracts.test.ts`
- Create: `ops-console/src/server/beszel/fixtures/auth.json`
- Create: `ops-console/src/server/beszel/fixtures/info.json`
- Create: `ops-console/src/server/beszel/fixtures/system.json`
- Create: `ops-console/src/server/beszel/fixtures/system-stats.json`
- Create: `ops-console/src/server/beszel/fixtures/systemd-services.json`

**Interfaces:**
- Produces: `authResponseSchema`, `hubInfoSchema`, `systemRecordSchema`, `systemStatsListSchema`, `systemdServicesListSchema` and their `z.infer` types.
- Contract constants: `BESZEL_CONTRACT_VERSION = '0.18.8'`, state enum `0..5`, sub-state enum `0..4`.

- [ ] **Step 1: Add sanitized fixtures with exact upstream shapes**

Use these values; `unknownField` proves Zod strips additions and every fixture uses the synthetic system ID `abc123def456ghi`:

```json
{
  "token": "fixture-token-not-a-secret",
  "record": { "id": "telemetryuser01", "email": "ops-telemetry@thienuy.invalid", "role": "readonly", "unknownField": "drop-me" }
}
```

```json
{ "key": "ssh-ed25519 fixture-public-key", "v": "0.18.8", "cu": false }
```

```json
{
  "id": "abc123def456ghi",
  "status": "up",
  "info": { "t": 4, "u": 86400, "v": "0.18.8", "sv": [3, 1] },
  "updated": "2026-08-24 00:00:50.000Z",
  "host": "must-be-stripped",
  "name": "must-be-stripped"
}
```

```json
{
  "page": 1,
  "perPage": 1,
  "totalPages": 1,
  "totalItems": 1,
  "items": [{
    "created": "2026-08-24 00:00:45.000Z",
    "stats": {
      "cpu": 42.5, "cpub": [20, 10, 2, 1, 67], "la": [1.2, 0.8, 0.4],
      "m": 8, "mu": 4, "mp": 50, "mb": 1.25, "s": 2, "su": 0.5,
      "d": 48, "du": 24, "dp": 50,
      "dio": [1048576, 2097152], "dios": [1, 2, 3, 4, 5, 6],
      "b": [4096, 8192], "t": { "private-sensor": 55 }
    },
    "unknownField": "drop-me"
  }]
}
```

```json
{
  "page": 1,
  "perPage": 200,
  "totalPages": 1,
  "totalItems": 3,
  "items": [
    { "name": "nginx", "state": 0, "sub": 1, "cpu": 0.3, "memory": 33554432, "updated": 1787539245000, "cpuPeak": 1.2, "memPeak": 67108864 },
    { "name": "postgresql", "state": 2, "sub": 3, "cpu": 2.1, "memory": 134217728, "updated": 1787539245000 },
    { "name": "unapproved-unit", "state": 0, "sub": 1, "cpu": 0, "memory": 1, "updated": 1787539245000 }
  ]
}
```

- [ ] **Step 2: Write failing schema tests**

Test exact pinning, optional values, enum rejection and stripping:

```ts
expect(hubInfoSchema.parse(infoFixture)).toEqual({ v: '0.18.8', cu: false });
expect(authResponseSchema.parse(authFixture).record).toEqual({
  id: 'telemetryuser01',
  email: 'ops-telemetry@thienuy.invalid',
  role: 'readonly',
});
expect(() => hubInfoSchema.parse({ v: '0.19.0', cu: false })).toThrow();
expect(() => systemdServicesListSchema.parse({ ...servicesFixture, items: [{ name: 'nginx', state: 7, sub: 1, cpu: 0, memory: 1, updated: 1 }] })).toThrow();
expect(systemStatsListSchema.parse({ ...statsFixture, items: [{ created: '2026-08-24 00:00:45.000Z', stats: { cpu: 1, m: 1, mu: 1, mp: 1, mb: 0, s: 0, su: 0, d: 1, du: 1, dp: 1 } }] }).items[0].stats.b).toBeUndefined();
```

- [ ] **Step 3: Run the contract test and confirm RED**

Run: `cd ops-console && npm test -- src/server/beszel/contracts.test.ts`

Expected: FAIL because `contracts.ts` does not exist.

- [ ] **Step 4: Implement strict known fields with unknown-field stripping**

Use `z.object({...})` without `.passthrough()`; Zod 4 strips unknown object keys by default. Define the reusable list envelope and exact numeric tuples:

```ts
export const BESZEL_CONTRACT_VERSION = '0.18.8' as const;
const isoOrPocketBaseDate = z.string().min(20).max(40).refine((value) => Number.isFinite(Date.parse(value)));
const nonnegative = z.number().finite().nonnegative();

export const authResponseSchema = z.object({
  token: z.string().min(1).max(4096),
  record: z.object({
    id: z.string().min(1).max(64),
    email: z.string().email().max(254),
    role: z.literal('readonly'),
  }),
});

export const hubInfoSchema = z.object({
  v: z.literal(BESZEL_CONTRACT_VERSION),
  cu: z.boolean().optional(),
});

export const systemRecordSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{15}$/u),
  status: z.enum(['up', 'down', 'paused', 'pending']),
  info: z.object({
    t: z.number().int().positive().optional(),
    u: nonnegative,
    v: z.string().min(1).max(32),
    sv: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
  }),
  updated: isoOrPocketBaseDate,
});

export type HubInfo = z.infer<typeof hubInfoSchema>;
export type SystemRecord = z.infer<typeof systemRecordSchema>;
export type SystemStatsList = z.infer<typeof systemStatsListSchema>;
export type SystemdServicesList = z.infer<typeof systemdServicesListSchema>;
```

For `stats`, require `cpu,m,mu,mp,mb,s,su,d,du,dp`; keep `cpub`, `la`, `dio`, `dios`, `b` optional and tuple-sized. For service records require only `name,state,sub,cpu,memory,updated`; accept but strip `cpuPeak` and `memPeak` because v1 does not expose them.

- [ ] **Step 5: Run the contract test and full typecheck**

Run: `cd ops-console && npm test -- src/server/beszel/contracts.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the contract boundary**

```bash
git add ops-console/src/server/beszel/contracts.ts ops-console/src/server/beszel/contracts.test.ts ops-console/src/server/beszel/fixtures
git commit -m "test(ops): lock Beszel 0.18.8 contract"
```

### Task 2: Add fail-closed Beszel collector configuration

**Files:**
- Modify: `ops-console/src/server/config.ts`
- Modify: `ops-console/src/server/config.test.ts`

**Interfaces:**
- Produces: `BeszelCollectorConfig = { enabled: false } | { enabled: true; baseUrl: 'http://127.0.0.1:8090'; username: string; passwordFile: string; systemId: string; timeoutMs: number }`.
- Modifies: `CollectorConfig.beszel: BeszelCollectorConfig`.

- [ ] **Step 1: Write failing disabled/enabled config tests**

Use a temp directory and cover regular file, empty file and symlink:

```ts
expect(loadCollectorConfig({ ...collectorBase, OPS_BESZEL_ENABLED: 'false' }).beszel).toEqual({ enabled: false });

const enabled = loadCollectorConfig({
  ...collectorBase,
  OPS_BESZEL_ENABLED: 'true',
  OPS_BESZEL_URL: 'http://127.0.0.1:8090',
  OPS_BESZEL_USER: 'ops-telemetry@thienuy.invalid',
  OPS_BESZEL_PASSWORD_FILE: passwordPath,
  OPS_BESZEL_SYSTEM_ID: 'abc123def456ghi',
  OPS_BESZEL_TIMEOUT_MS: '5000',
});
expect(enabled.beszel).toMatchObject({ enabled: true, timeoutMs: 5000 });
expect(() => loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_URL: 'http://127.0.0.1:8080' })).toThrow('OPS_BESZEL_URL');
expect(() => loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_PASSWORD_FILE: symlinkPath })).toThrow('regular file');
expect(() => loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_PASSWORD_FILE: emptyPath })).toThrow('must not be empty');
```

Also assert `OPS_BESZEL_ENABLED=yes`, timeout `999/10001`, URL credentials/path/query, malformed email and malformed system ID are rejected.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd ops-console && npm test -- src/server/config.test.ts`

Expected: FAIL because `CollectorConfig` has no `beszel` property.

- [ ] **Step 3: Implement discriminated parsing**

Use `lstatSync` before `readFileSync`; never return password content:

```ts
export type BeszelCollectorConfig =
  | { enabled: false }
  | {
      enabled: true;
      baseUrl: 'http://127.0.0.1:8090';
      username: string;
      passwordFile: string;
      systemId: string;
      timeoutMs: number;
    };

function loadBeszelConfig(env: Env): BeszelCollectorConfig {
  const rawEnabled = env.OPS_BESZEL_ENABLED ?? 'false';
  if (rawEnabled !== 'true' && rawEnabled !== 'false') throw new Error('OPS_BESZEL_ENABLED must be true or false');
  if (rawEnabled === 'false') return { enabled: false };
  const baseUrl = required(env, 'OPS_BESZEL_URL');
  const parsed = new URL(baseUrl);
  if (parsed.href !== 'http://127.0.0.1:8090/') throw new Error('OPS_BESZEL_URL must be exactly http://127.0.0.1:8090');
  const passwordFile = required(env, 'OPS_BESZEL_PASSWORD_FILE');
  const stat = lstatSync(passwordFile);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('OPS_BESZEL_PASSWORD_FILE must be a regular file');
  if (!readFileSync(passwordFile, 'utf8').trim()) throw new Error('OPS_BESZEL_PASSWORD_FILE must not be empty');
  const timeoutMs = positiveInteger(env, 'OPS_BESZEL_TIMEOUT_MS', 5000);
  if (timeoutMs < 1000 || timeoutMs > 10000) throw new Error('OPS_BESZEL_TIMEOUT_MS must be between 1000 and 10000');
  const username = z.string().email().max(254).parse(required(env, 'OPS_BESZEL_USER'));
  const systemId = z.string().regex(/^[a-z0-9]{15}$/u).parse(required(env, 'OPS_BESZEL_SYSTEM_ID'));
  return { enabled: true, baseUrl: 'http://127.0.0.1:8090', username, passwordFile, systemId, timeoutMs };
}
```

Set `beszel: loadBeszelConfig(env)` in `loadCollectorConfig`.

- [ ] **Step 4: Run config tests and typecheck**

Run: `cd ops-console && npm test -- src/server/config.test.ts && npm run typecheck`

Expected: PASS after updating typed collector fixtures in failing tests with `beszel: { enabled: false }`.

- [ ] **Step 5: Commit configuration**

```bash
git add ops-console/src/server/config.ts ops-console/src/server/config.test.ts
git commit -m "feat(ops): validate Beszel collector config"
```

### Task 3: Implement the authenticated fixed-endpoint client

**Files:**
- Create: `ops-console/src/server/beszel/client.ts`
- Create: `ops-console/src/server/beszel/client.test.ts`
- Create: `ops-console/src/server/beszel/client.integration.test.ts`

**Interfaces:**
- Consumes: enabled `BeszelCollectorConfig` and schemas from Task 1.
- Produces: `BeszelRawSnapshot`, `BeszelClientError`, `createBeszelClient(config, deps).readSnapshot()`.

```ts
export interface BeszelRawSnapshot {
  hub: HubInfo;
  system: SystemRecord;
  stats: SystemStatsList['items'][number];
  services: SystemdServicesList;
}

export type BeszelErrorCode =
  | 'beszel_auth_failed'
  | 'beszel_timeout'
  | 'beszel_unreachable'
  | 'beszel_http_error'
  | 'beszel_invalid_json'
  | 'beszel_contract_invalid'
  | 'beszel_no_stats';

export type BeszelProbeErrorCode = BeszelErrorCode | 'beszel_agent_down' | 'beszel_metric_stale';
```

- [ ] **Step 1: Write fake-fetch tests for endpoint and auth behavior**

Record every URL/method/header/body and assert:

```ts
expect(calls.map(({ path }) => path)).toEqual([
  '/api/collections/users/auth-with-password',
  '/api/beszel/info',
  '/api/collections/systems/records/abc123def456ghi',
  '/api/collections/system_stats/records',
  '/api/collections/systemd_services/records',
]);
expect(JSON.parse(String(calls[0].init.body))).toEqual({
  identity: 'ops-telemetry@thienuy.invalid',
  password: 'fixture-password',
});
expect(calls.slice(1).every(({ init }) => init.headers.Authorization === 'fixture-token-not-a-secret')).toBe(true);
```

Call `readSnapshot()` twice and assert auth occurs once. Return `401` once from the info request and assert exactly one re-authentication plus one retry. A second `401` must throw `BeszelClientError('beszel_auth_failed')` without a third login.

Return an auth record whose email differs from configured `OPS_BESZEL_USER`, or a system record whose `id` differs from configured system ID; both must fail with `beszel_contract_invalid`. Return `totalItems=201` with only 200 systemd items and assert the client fails closed rather than treating a truncated page as healthy.

- [ ] **Step 2: Add error matrix tests**

Use fake responses for timeout (`AbortError`), network error, `503`, invalid JSON, schema mismatch and empty stats items. Assert only the bounded code and that `String(error)` contains neither password, token nor response body.

- [ ] **Step 3: Run the focused test and confirm RED**

Run: `cd ops-console && npm test -- src/server/beszel/client.test.ts`

Expected: FAIL because `client.ts` does not exist.

- [ ] **Step 4: Implement URL construction and redacted errors**

Use a single request helper. Never accept a path from the caller. Create one `AbortSignal.timeout(config.timeoutMs)` at the beginning of `readSnapshot()` and pass the same signal through cached auth, re-authentication and every endpoint request, so the timeout bounds the complete probe rather than each HTTP call independently:

```ts
const FIXED_PATHS = {
  auth: '/api/collections/users/auth-with-password',
  info: '/api/beszel/info',
  systems: '/api/collections/systems/records/',
  stats: '/api/collections/system_stats/records',
  services: '/api/collections/systemd_services/records',
} as const;

class BeszelClientError extends Error {
  constructor(readonly code: BeszelErrorCode) {
    super(code);
    this.name = 'BeszelClientError';
  }
}
```

For list calls construct `URLSearchParams` internally. Stats parameters are fixed to `page=1`, `perPage=1`, `sort=-created`, `filter=system="abc..." && type="1m"`, `fields=created,stats`. Services use `page=1`, `perPage=200`, `filter=system="abc..."`, `fields=name,state,sub,cpu,memory,updated`. Auth uses `Content-Type: application/json`; protected reads use `Accept: application/json`.

Read and trim `passwordFile` only while authenticating. Parse auth response before caching token. Set `Authorization` to the cached PocketBase token. On `401`, clear cached token, authenticate and replay once using the same overall deadline; set an `allowReauth` boolean to prevent a loop. Add a test where several individually fast requests exceed the shared deadline in aggregate and expect `beszel_timeout` within one configured timeout window.

- [ ] **Step 5: Parse each response before returning**

Run the four protected requests sequentially in the first implementation for deterministic retry tests. Reject empty stats with `beszel_no_stats`; return only schema outputs:

```ts
return {
  hub: hubInfoSchema.parse(infoRaw),
  system: systemRecordSchema.parse(systemRaw),
  stats: systemStatsListSchema.parse(statsRaw).items[0] ?? fail('beszel_no_stats'),
  services: systemdServicesListSchema.parse(servicesRaw),
};
```

After schema parse, require auth email and system ID to equal configured values and require `services.totalItems <= services.items.length`; mismatch/truncation maps to `beszel_contract_invalid`. Map `ZodError` to `beszel_contract_invalid`, JSON parse errors to `beszel_invalid_json`, aborts to `beszel_timeout`, fetch rejection to `beszel_unreachable`, non-2xx except 401 to `beszel_http_error`.

- [ ] **Step 6: Run client tests and typecheck**

Add a real local fake PocketBase server with `node:http`. It listens on `127.0.0.1` using an ephemeral port; the injected `fetchImpl` rewrites only the origin from the client's exact `http://127.0.0.1:8090` URL to that ephemeral listener while preserving method, path, query, headers and body. The server implements the five fixed endpoints, returns Task 1 fixtures, forces one 401 in a second case and records requests. Assert the complete round trip, query allowlist and one-retry behavior without Internet or Beszel binary.

Run: `cd ops-console && npm test -- src/server/beszel/client.test.ts src/server/beszel/client.integration.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the client**

```bash
git add ops-console/src/server/beszel/client.ts ops-console/src/server/beszel/client.test.ts ops-console/src/server/beszel/client.integration.test.ts
git commit -m "feat(ops): add pinned Beszel API client"
```

### Task 4: Normalize telemetry and create monitor samples

**Files:**
- Create: `ops-console/src/server/beszel/mapper.ts`
- Create: `ops-console/src/server/beszel/mapper.test.ts`
- Create: `ops-console/src/server/beszel/probe.ts`
- Create: `ops-console/src/server/beszel/probe.test.ts`
- Modify: `ops-console/src/shared/models.ts`

**Interfaces:**
- Produces: `NormalizedBeszelSnapshot`, `normalizeBeszelSnapshot(raw, now)`, `createBeszelProbe(client).probe(now): Promise<MonitorSample[]>`.
- Adds: monitor names `beszel`, `host_resources`, `host_services`.

```ts
export interface NormalizedBeszelSnapshot {
  hubVersion: '0.18.8';
  systemStatus: 'up' | 'down' | 'paused' | 'pending';
  agentVersion: string;
  metricObservedAt: string;
  matchedTotal: number;
  resources: Record<string, number | string | boolean | null>;
  services: Array<{
    name: string;
    state: InfrastructureServiceState;
    subState: InfrastructureServiceSubState;
    cpuPercent: number;
    memoryBytes: number;
    observedAt: string;
  }>;
}
```

- [ ] **Step 1: Add shared monitor names and normalized type**

```ts
export type InfrastructureServiceState = 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating' | 'reloading';
export type InfrastructureServiceSubState = 'dead' | 'running' | 'exited' | 'failed' | 'unknown';
```

Append the three monitor names to `MonitorName`. Define normalized service fields exactly as `name,state,subState,cpuPercent,memoryBytes,observedAt`.

- [ ] **Step 2: Write failing unit conversion and allowlist tests**

Assert exact mappings from Task 1 fixtures:

```ts
expect(result.resources).toMatchObject({
  cpuPercent: 42.5,
  cpuUserPercent: 20,
  cpuSystemPercent: 10,
  cpuIoWaitPercent: 2,
  memoryTotalBytes: 8 * 1024 ** 3,
  memoryUsedBytes: 4 * 1024 ** 3,
  swapTotalBytes: 2 * 1024 ** 3,
  swapUsedBytes: 0.5 * 1024 ** 3,
  diskReadBytesPerSecond: 1048576,
  diskWriteBytesPerSecond: 2097152,
  diskIoUtilizationPercent: 3,
  networkTransmitBytesPerSecond: 4096,
  networkReceiveBytesPerSecond: 8192,
  load1: 1.2,
  load5: 0.8,
  load15: 0.4,
  cpuThreads: 4,
});
expect(result.services.map(({ name }) => name)).toEqual(['postgresql', 'nginx']);
expect(result.services[0]).toMatchObject({ state: 'failed', subState: 'failed' });
expect(JSON.stringify(result)).not.toMatch(/private-sensor|must-be-stripped|restart/i);
```

Verify `swapPercent` is `25`, becomes `null` when swap total is zero, missing `b/dio/dios/cpub/la` becomes `null`, invalid/future `created` fails, service list truncates to 32 after failed-first/name sort.

Set service `updated` more than 120 seconds behind `now` and assert it is excluded. If `system.info.sv[0]` says matched services exist but the fresh list is incomplete, normalization must fail closed with `beszel_contract_invalid`; it must not present an empty list as healthy.

- [ ] **Step 3: Run mapper test and confirm RED**

Run: `cd ops-console && npm test -- src/server/beszel/mapper.test.ts`

Expected: FAIL because mapper is absent.

- [ ] **Step 4: Implement exact units and enum maps**

```ts
const GIB = 1024 ** 3;
const stateMap = ['active', 'inactive', 'failed', 'activating', 'deactivating', 'reloading'] as const;
const subStateMap = ['dead', 'running', 'exited', 'failed', 'unknown'] as const;
const allowedService = /^(?:nginx.*|postgresql.*|edutrack-ops-.*|pm2-.*)$/u;
const bytes = (gib: number): number => Math.round(gib * GIB);
const optionalTuple = (value: readonly number[] | undefined, index: number): number | null => value?.[index] ?? null;
```

Use `stats.b[0]=transmit`, `stats.b[1]=receive`; `stats.dio[0]=read`, `stats.dio[1]=write`; `stats.dios[2]=I/O utilization`; `stats.cpub=[user,system,iowait,steal,idle]`. Set `metricObservedAt` from stats `created`, `agentVersion` from `system.info.v`, `uptimeSeconds` from `system.info.u` and `probeOk=true`.

Convert service `updated` epoch milliseconds to ISO `observedAt`, reject future timestamps beyond five seconds, and retain only records at most 120 seconds old. Compute `expectedServiceTotal = system.info.sv?.[0] ?? freshServices.length`; if it differs from the number of fresh fetched records, throw `BeszelClientError('beszel_contract_invalid')`. Set `matchedTotal=expectedServiceTotal`, calculate all failed names from the full fresh list, then sort and truncate only the display `services` array to 32.

- [ ] **Step 5: Write failing probe tests**

On success expect monitor order and safe fields:

```ts
expect(samples.map(({ monitor }) => monitor)).toEqual(['beszel', 'host_resources', 'host_services']);
expect(samples[0]).toMatchObject({ level: 'healthy', errorCode: null, details: { probeOk: true, hubVersion: '0.18.8', systemStatus: 'up' } });
expect(samples[1].details).not.toHaveProperty('host');
```

For every `BeszelErrorCode`, expect one sample only: monitor `beszel`, raw level `critical`, `details={probeOk:false}`, and the same safe error code. For system `down` or metric age over 180 seconds, emit one `beszel` failure sample only and do not emit stale resource/service samples.

- [ ] **Step 6: Implement the probe wrapper**

```ts
export interface BeszelSnapshotReader { readSnapshot(): Promise<BeszelRawSnapshot>; }

export function createBeszelProbe(client: BeszelSnapshotReader) {
  return async function probe(now = new Date()): Promise<MonitorSample[]> {
    try {
      const normalized = normalizeBeszelSnapshot(await client.readSnapshot(), now);
      if (normalized.systemStatus !== 'up') return [failure(now, 'beszel_agent_down')];
      if (now.getTime() - Date.parse(normalized.metricObservedAt) > 180_000) return [failure(now, 'beszel_metric_stale')];
      return makeSuccessSamples(normalized, now);
    } catch (error) {
      return [failure(now, error instanceof BeszelClientError ? error.code : 'beszel_unreachable')];
    }
  };
}
```

`makeSuccessSamples` creates only allowlisted details. `host_services.details` contains `matchedTotal`, `failedServices` and `services`; `host_resources.details` contains only the spec fields.

- [ ] **Step 7: Run mapper/probe tests and typecheck**

Run: `cd ops-console && npm test -- src/server/beszel/mapper.test.ts src/server/beszel/probe.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit normalized telemetry**

```bash
git add ops-console/src/shared/models.ts ops-console/src/server/beszel/mapper.ts ops-console/src/server/beszel/mapper.test.ts ops-console/src/server/beszel/probe.ts ops-console/src/server/beszel/probe.test.ts
git commit -m "feat(ops): normalize Beszel telemetry samples"
```

### Task 5: Extend the state machine for infrastructure thresholds

**Files:**
- Modify: `ops-console/src/server/collector/statusMachine.ts`
- Modify: `ops-console/src/server/collector/statusMachine.test.ts`

**Interfaces:**
- Consumes: raw normalized monitor samples from Task 4.
- Produces: `Evaluation` with deterministic infrastructure levels/reasons, plus internal `conditionHealthy: boolean` used for correct two-sample recovery.

- [ ] **Step 1: Add table-driven failing threshold tests**

Build one sample per minute and test boundaries (`84.99/85`, `94.99/95`, `79.99/80`, `89.99/90`, normalized load). Include:

```ts
expect(evaluateMonitor(cpuHistoryAt(85, 9), resourceAt(85, 10)).level).toBe('warning');
expect(evaluateMonitor(cpuHistoryAt(95, 9), resourceAt(95, 10))).toMatchObject({ level: 'critical', dedupeKey: 'host_resources:cpu_critical' });
expect(evaluateMonitor(memoryHistoryAt(95, 4), resourceAt(undefined, 5, { memoryPercent: 95 })).level).toBe('critical');
expect(evaluateMonitor([resourceAt(undefined, 0, { diskPercent: 90 })], resourceAt(undefined, 1, { diskPercent: 90 }))).toMatchObject({ level: 'critical', dedupeKey: 'host_resources:disk_critical' });
```

For priority, use one sample satisfying disk critical, memory critical, CPU critical and load critical; expect `disk_critical`. Use a warning disk plus critical memory; expect critical memory. Network/swap/I/O values alone stay healthy.

- [ ] **Step 2: Add Beszel and systemd sequence tests**

```ts
expect(evaluateMonitor([], beszelFailure('beszel_timeout')).level).toBe('unknown');
expect(evaluateMonitor([beszelFailure('beszel_timeout')], beszelFailure('beszel_timeout'))).toMatchObject({ level: 'critical', dedupeKey: 'beszel:beszel_unavailable' });

const first = servicesSample(['nginx']);
const second = servicesSample(['nginx', 'postgresql']);
expect(evaluateMonitor([first], second)).toMatchObject({ level: 'critical', dedupeKey: 'host_services:service_failed:nginx' });
```

Two different failed names do not trigger. Two samples with every warning boundary cleared after warning/critical produce one `recovered` transition. A raw `healthy` host sample whose CPU is still `>=85`, memory `>=85`, disk `>=80`, load ratio `>=1`, or whose service list is still failed is not a recovery sample.

- [ ] **Step 3: Run status tests and confirm RED**

Run: `cd ops-console && npm test -- src/server/collector/statusMachine.test.ts`

Expected: new infrastructure cases FAIL while legacy cases remain green.

- [ ] **Step 4: Implement separate evaluators and deterministic priority**

Keep `evaluateMonitor` as dispatcher; add focused helpers:

```ts
type Candidate = { level: 'warning' | 'critical'; reason: string; priority: number };
const choose = (items: Candidate[]): Candidate | undefined => items.sort((a, b) =>
  (a.level === b.level ? a.priority - b.priority : a.level === 'critical' ? -1 : 1)
)[0];

const RESOURCE_PRIORITY = { disk: 0, memory: 1, cpu: 2, load: 3 } as const;
```

Extend `Evaluation`:

```ts
export interface Evaluation {
  level: MonitorLevel;
  transition: Transition;
  dedupeKey: string;
  safeSummary: string;
  conditionHealthy: boolean;
}
```

Use existing `sustained` with `10*60_000` or `5*60_000`. Disk requires trailing count 2. Load ratio is valid only when `cpuThreads>0`. Beszel requires two trailing failures regardless of underlying bounded code and always dedupes to `beszel:beszel_unavailable`. For services, intersect `failedServices` from the current and immediately preceding sample, sort names and use the first.

Set `conditionHealthy` independently of sustained alert level:

```ts
const resourceConditionHealthy =
  Number.isFinite(cpu) && Number.isFinite(memory) && Number.isFinite(disk) &&
  Number.isFinite(loadRatio) && cpu < 85 && memory < 85 && disk < 80 && loadRatio < 1;
const serviceConditionHealthy = failedServices.length === 0;
const beszelConditionHealthy = sample.level === 'healthy' && sample.details.probeOk !== false;
```

Treat missing/non-finite optional metrics as neutral for their own display-only dimension, but require valid `cpuPercent`, `memoryPercent`, `diskPercent`, `load5` and positive `cpuThreads` for a resource sample to count toward recovery. Use the previous history item's `details.conditionHealthy === true` and `details.effectiveLevel` to hold the previous warning/critical level on the first clear sample and emit `recovered` only on the second consecutive clear sample. While awaiting the second sample, retain the previous `details.dedupeKey`; do not create an `awaiting_recovery_baseline` incident fingerprint.

Keep recovery logic centralized after monitor-specific evaluation. For legacy monitors, `conditionHealthy` is their existing raw healthy predicate. Preserve every existing PostgreSQL, application, cron, backup and errors test unchanged.

- [ ] **Step 5: Run state and alert regression suites**

Run: `cd ops-console && npm test -- src/server/collector/statusMachine.test.ts src/server/alerts/alertService.test.ts`

Expected: PASS; Zalo text still contains monitor only and no service name/hostname/raw details.

- [ ] **Step 6: Commit thresholds**

```bash
git add ops-console/src/server/collector/statusMachine.ts ops-console/src/server/collector/statusMachine.test.ts
git commit -m "feat(ops): evaluate infrastructure incidents"
```

### Task 6: Wire the 60-second probe into collector cycles

**Files:**
- Modify: `ops-console/src/server/collector/collector.ts`
- Modify: `ops-console/src/server/collector/collector.test.ts`
- Modify: `ops-console/src/server/collector/collector-main.ts`

**Interfaces:**
- Adds to `CollectorDeps`: `lastBeszelAt?: number`, `beszelProbe?: (now: Date) => Promise<MonitorSample[]>`.
- Uses: `createBeszelClient` and `createBeszelProbe` once at process startup.

- [ ] **Step 1: Write failing cadence/isolation tests**

Run cycles at `00:00:00`, `00:00:15`, `00:00:59`, `00:01:00`; assert `beszelProbe` called at seconds `0` and `60` only. Return three samples and assert each recorded once.

Add a probe returning `[beszel failure]`; assert app, PostgreSQL, cron and backup samples are still written in the same cycle. Add a probe that resolves after other fake probes and confirm there is no duplicate metric.

- [ ] **Step 2: Add failing effective-level persistence test**

Seed histories so a host resource sample evaluates critical while raw level is healthy. After the cycle:

```ts
expect(store.readDashboardOverview().latestByMonitor.host_resources?.level).toBe('critical');
expect(deps.histories.get('host_resources')?.at(-1)?.level).toBe('healthy');
expect(deps.histories.get('host_resources')?.at(-1)?.details.effectiveLevel).toBe('critical');
```

This deliberately keeps raw level in in-memory history for two-sample recovery while persisting effective level for the UI.

- [ ] **Step 3: Run collector tests and confirm RED**

Run: `cd ops-console && npm test -- src/server/collector/collector.test.ts`

Expected: FAIL on missing cadence and effective persistence.

- [ ] **Step 4: Implement cadence and evaluated persistence**

Change `remember` to return both evaluation and the stored sample:

```ts
function remember(deps: CollectorDeps, sample: MonitorSample): { evaluation: Evaluation; stored: MonitorSample } {
  const history = deps.histories.get(sample.monitor) ?? [];
  const evaluation = evaluateMonitor(history, sample);
  const details = { ...sample.details, dedupeKey: evaluation.dedupeKey, effectiveLevel: evaluation.level, conditionHealthy: evaluation.conditionHealthy };
  const stored = { ...sample, level: evaluation.level, details };
  deps.store.recordSample(stored);
  history.push({ ...sample, details });
  deps.histories.set(sample.monitor, history.slice(-120));
  return { evaluation, stored };
}
```

Use `stored` in `CollectorTransition.sample`. Build the probe promise only when `config.beszel.enabled` and due; update `lastBeszelAt` after the attempt resolves so a failed probe does not run again at second 15.

- [ ] **Step 5: Instantiate dependencies once in collector-main**

```ts
const beszelProbe = config.beszel.enabled
  ? createBeszelProbe(createBeszelClient(config.beszel))
  : undefined;
const deps: CollectorDeps = {
  config,
  store: createOpsStore(config.dbPath),
  histories: new Map(),
  beszelProbe,
};
```

Do not catch/log raw Beszel errors in `collector-main`; probe already returns bounded samples.

- [ ] **Step 6: Run collector and legacy regressions**

Run: `cd ops-console && npm test -- src/server/collector/collector.test.ts src/server/collector/statusMachine.test.ts src/server/alerts/alertService.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit collector integration**

```bash
git add ops-console/src/server/collector/collector.ts ops-console/src/server/collector/collector.test.ts ops-console/src/server/collector/collector-main.ts
git commit -m "feat(ops): collect Beszel telemetry each minute"
```

### Task 7: Add parameterized UTC infrastructure history storage

**Files:**
- Modify: `ops-console/src/shared/models.ts`
- Modify: `ops-console/src/server/storage/store.ts`
- Modify: `ops-console/src/server/storage/store.test.ts`

**Interfaces:**
- Produces shared `InfrastructureHistoryPoint`, `InfrastructureHistoryResponse`, `InfrastructureHistoryRange`.
- Adds `OpsStore.readInfrastructureHistory(input: { from: string; to: string; resolutionSeconds: 60 | 300 | 1800 | 7200; limit: number }): InfrastructureHistoryPoint[]`.

- [ ] **Step 1: Define nullable public history types**

```ts
export type InfrastructureHistoryRange = '1h' | '24h' | '7d' | '30d';
export interface InfrastructureHistoryPoint {
  observedAt: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  load1: number | null;
  networkReceiveBytesPerSecond: number | null;
  networkTransmitBytesPerSecond: number | null;
  diskReadBytesPerSecond: number | null;
  diskWriteBytesPerSecond: number | null;
}
export interface InfrastructureHistoryResponse {
  range: InfrastructureHistoryRange;
  resolutionSeconds: 60 | 300 | 1800 | 7200;
  collectedAt: string;
  points: InfrastructureHistoryPoint[];
}
```

- [ ] **Step 2: Write failing bucket/bound/nullable tests**

Insert host samples around a UTC bucket boundary, one older than 30 days, and one with missing metrics. Assert averages, ascending time, null preservation, exclusion outside `[from,to]`, and `limit<=720`.

Also pass SQL-looking strings as `from/to`; expect `Invalid infrastructure history timestamp` before SQL executes and verify the schema remains readable.

- [ ] **Step 3: Run store tests and confirm RED**

Run: `cd ops-console && npm test -- src/server/storage/store.test.ts`

Expected: FAIL because the method is absent.

- [ ] **Step 4: Implement parameterized JSON aggregation**

Validate ISO timestamps and integer enum/limit in TypeScript. Use a constant SQL statement with named parameters; never interpolate input:

```sql
SELECT
  CAST(CAST(strftime('%s', observed_at) AS INTEGER) / @resolution AS INTEGER) * @resolution AS bucket_epoch,
  AVG(CASE WHEN json_type(details_json, '$.cpuPercent') IN ('integer','real') THEN json_extract(details_json, '$.cpuPercent') END) AS cpu_percent,
  AVG(CASE WHEN json_type(details_json, '$.memoryPercent') IN ('integer','real') THEN json_extract(details_json, '$.memoryPercent') END) AS memory_percent,
  AVG(CASE WHEN json_type(details_json, '$.diskPercent') IN ('integer','real') THEN json_extract(details_json, '$.diskPercent') END) AS disk_percent,
  AVG(CASE WHEN json_type(details_json, '$.load1') IN ('integer','real') THEN json_extract(details_json, '$.load1') END) AS load_1,
  AVG(CASE WHEN json_type(details_json, '$.networkReceiveBytesPerSecond') IN ('integer','real') THEN json_extract(details_json, '$.networkReceiveBytesPerSecond') END) AS network_receive,
  AVG(CASE WHEN json_type(details_json, '$.networkTransmitBytesPerSecond') IN ('integer','real') THEN json_extract(details_json, '$.networkTransmitBytesPerSecond') END) AS network_transmit,
  AVG(CASE WHEN json_type(details_json, '$.diskReadBytesPerSecond') IN ('integer','real') THEN json_extract(details_json, '$.diskReadBytesPerSecond') END) AS disk_read,
  AVG(CASE WHEN json_type(details_json, '$.diskWriteBytesPerSecond') IN ('integer','real') THEN json_extract(details_json, '$.diskWriteBytesPerSecond') END) AS disk_write
FROM monitor_samples
WHERE monitor = 'host_resources' AND observed_at >= @from AND observed_at <= @to
GROUP BY bucket_epoch
ORDER BY bucket_epoch ASC
LIMIT @limit
```

Map SQL `null` to JS `null`; map `bucket_epoch` with `new Date(epoch * 1000).toISOString()`.

- [ ] **Step 5: Run store tests and typecheck**

Run: `cd ops-console && npm test -- src/server/storage/store.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit history storage**

```bash
git add ops-console/src/shared/models.ts ops-console/src/server/storage/store.ts ops-console/src/server/storage/store.test.ts
git commit -m "feat(ops): store UTC infrastructure history"
```

### Task 8: Expose safe overview projections and history API

**Files:**
- Modify: `ops-console/src/server/http/monitorRoutes.ts`
- Modify: `ops-console/src/server/http/app.test.ts`

**Interfaces:**
- Adds authenticated `GET /api/infrastructure/history?range=1h|24h|7d|30d`.
- Range mapping: `1h→3600000/60`, `24h→86400000/300`, `7d→604800000/1800`, `30d→2592000000/7200`.

- [ ] **Step 1: Write failing authentication/range/no-store tests**

After login, test all four ranges and freeze the store clock. Assert invalid/missing/repeated ranges return `400 {error:'invalid_range'}`, unauthenticated returns 401, successful response has `Cache-Control: no-store`, correct resolution and at most 720 points.

- [ ] **Step 2: Write failing projection leak tests**

Record samples whose `details` contain allowed fields plus `token`, `password`, `host`, `raw`, nested service `command`, `environment`, `description`, `restartCount`. Assert `/api/overview` contains only:

```ts
expect(body.latestByMonitor.host_services.details.services[0]).toEqual({
  name: 'nginx', state: 'active', subState: 'running', cpuPercent: 0.3,
  memoryBytes: 33554432, observedAt: '2026-08-24T00:00:45.000Z',
});
expect(JSON.stringify(body)).not.toMatch(/fixture-token|password|command|environment|description|restartCount|raw/);
```

- [ ] **Step 3: Run HTTP tests and confirm RED**

Run: `cd ops-console && npm test -- src/server/http/app.test.ts`

Expected: FAIL because route and monitor-specific nested allowlist do not exist.

- [ ] **Step 4: Replace generic recursive projection for new monitors**

Keep legacy keys unchanged. Add `pickNumberOrNull`, `publicHostResources`, `publicBeszel` and `publicHostServices`. For services construct a fresh object with the six allowed fields and `slice(0,32)`; do not pass nested objects through `safeValue`.

```ts
function publicSample(sample: MonitorSample): MonitorSample {
  if (sample.monitor === 'host_resources') return { ...sample, details: publicHostResources(sample.details) };
  if (sample.monitor === 'host_services') return { ...sample, details: publicHostServices(sample.details) };
  if (sample.monitor === 'beszel') return { ...sample, details: publicBeszel(sample.details) };
  return { ...sample, details: publicLegacyDetails(sample.details) };
}
```

- [ ] **Step 5: Implement fixed range map and route**

```ts
const historyRanges = {
  '1h': { milliseconds: 60 * 60_000, resolutionSeconds: 60 as const },
  '24h': { milliseconds: 24 * 60 * 60_000, resolutionSeconds: 300 as const },
  '7d': { milliseconds: 7 * 24 * 60 * 60_000, resolutionSeconds: 1800 as const },
  '30d': { milliseconds: 30 * 24 * 60 * 60_000, resolutionSeconds: 7200 as const },
};
```

Use `z.enum(['1h','24h','7d','30d']).safeParse(request.query.range)`. Compute `to` once, derive `from`, call store with `limit:720`, and return the shared response type.

- [ ] **Step 6: Run HTTP, storage and security regression tests**

Run: `cd ops-console && npm test -- src/server/http/app.test.ts src/server/storage/store.test.ts src/server/security/auth.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit API projection**

```bash
git add ops-console/src/server/http/monitorRoutes.ts ops-console/src/server/http/app.test.ts
git commit -m "feat(ops): expose infrastructure history API"
```

### Task 9: Backend integration gate

**Files:**
- Modify only if a verification failure identifies a backend regression in files owned by Tasks 1–8.

**Interfaces:**
- Produces: a feature-flagged backend that is ready for the dashboard plan and fake-server integration.

- [ ] **Step 1: Run the full backend suite**

Run:

```bash
cd ops-console
npm test
npm run typecheck
npm run build:server
```

Expected: every command exits 0.

- [ ] **Step 2: Verify the compiled server contains no forbidden dependency or secret fixture**

Run:

```bash
test ! -d node_modules/pocketbase
! rg -n "fixture-password|fixture-token-not-a-secret|ops-telemetry@thienuy.invalid" dist/server
rg -n "beszel_contract_invalid|host_resources|infrastructure/history" dist/server
```

Expected: first two checks exit 0 and final search finds the expected bounded code/routes.

- [ ] **Step 3: Inspect commit scope**

Run: `git status --short && git log --oneline --max-count=10`

Expected: only intentional backend files are changed; original checkout's unrelated dirty files are absent because execution is in an isolated worktree.

- [ ] **Step 4: Record the gate in a final backend commit only if test-driven fixes were needed**

```bash
git add ops-console/src ops-console/deploy
git diff --cached --check
git commit -m "test(ops): complete Beszel backend gate"
```

If no verification fix was required, do not create an empty commit.

---

## Backend completion signal

The plan is complete when the feature flag defaults off, all fake Beszel tests pass without Internet, three normalized monitors are produced only once per minute, infrastructure incidents obey exact windows, history returns nullable UTC buckets, and authenticated API responses contain no raw Beszel fields or credentials. Do not enable production yet; continue with `2026-08-24-beszel-dashboard-ui.md`.
