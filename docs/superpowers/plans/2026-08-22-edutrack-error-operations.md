# EduTrack Error Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture all defined EduTrack error sources into a self-hosted, sanitized, source-mapped Error Inbox with user/request/release correlation, issue workflow, Critical/High Zalo/email alerts, and outage-safe local spooling.

**Architecture:** Publish a small versioned `@thienuy/ops-telemetry` package used by the existing browser and Node applications. Sources generate stable IDs, sanitize locally, and spool without depending on collector availability. The Ops API durably stores raw envelopes before processors normalize/group them. A notifier applies severity/dedup/escalation, while the React Ops UI consumes issue APIs and an SSE stream.

**Tech Stack:** TypeScript, Node.js 22, React 19, TanStack Query 5, Express 5, PostgreSQL 16/Drizzle, IndexedDB, source-map library, Zod, HMAC-SHA256, Zalo HTTP API, SMTP/Nodemailer, Vitest, MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-edutrack-ops-plane-design.md`

## Global Constraints

- Error telemetry is separate from business audit logging.
- Source-side sanitization happens before any disk/browser spool or network request; collector sanitizes again.
- Telemetry delivery never causes a user request or UI action to fail.
- Browser-supplied user identity is untrusted unless carried in a valid, short-lived server-signed telemetry context token.
- Browser spool is capped at 100 events, 5 MiB, and 24 hours. Server spool files are mode `0600`, bounded, rotated, and encrypted at rest by host volume policy.
- Browser ingest payload maximum is 64 KiB; server batch limits are explicit and tested.
- Raw envelopes/error occurrences are append-only and retained 90 days; issues/incidents/activities are retained two years.
- Alert text never includes raw stack, SQL, phone, email, token, cookie, request body, or student data.
- Existing cached clients keep working during the versioned API error-envelope transition.

---

### Task 1: Define telemetry contracts, IDs, and the shared SDK package

**Files:**
- Create: `edutrack-ops/packages/contracts/src/telemetry.ts`
- Create: `edutrack-ops/packages/contracts/src/problems.ts`
- Create: `edutrack-ops/packages/contracts/src/issues.ts`
- Create: `edutrack-ops/packages/contracts/src/index.ts`
- Create: `edutrack-ops/packages/telemetry-sdk/package.json`
- Create: `edutrack-ops/packages/telemetry-sdk/src/ids.ts`
- Create: `edutrack-ops/packages/telemetry-sdk/src/browser.ts`
- Create: `edutrack-ops/packages/telemetry-sdk/src/server.ts`
- Create: `edutrack-ops/packages/telemetry-sdk/src/index.ts`
- Test: matching `*.test.ts` files.
- Create: `edutrack-ops/.github/workflows/publish-telemetry-sdk.yml`

**Interfaces:**
- Produces: `TelemetryEnvelopeV1`, `ErrorOccurrenceV1`, `ApiProblem`, `createEventId`, `createRequestId`, `createBrowserTelemetry`, and `createServerTelemetry`.

- [ ] **Step 1: Define stable contracts**

```ts
export type TelemetryEnvelopeV1 = {
  schemaVersion: 1;
  eventId: `EVT_${string}`;
  idempotencyKey: string;
  capturedAt: string;
  source: 'browser' | 'api' | 'database' | 'document_store' | 'job' | 'provider' | 'process' | 'deployment' | 'synthetic';
  level: 'fatal' | 'error' | 'warning';
  error: { name: string; code: string; safeMessage: string; stack?: string; componentStack?: string };
  context: {
    requestId?: `REQ_${string}`;
    traceId?: string;
    route?: string;
    release: string;
    service: string;
    environment: 'production';
    telemetryContextToken?: string;
    tags?: Record<string, string>;
    breadcrumbs?: Array<{ at: string; category: string; message: string }>;
  };
};

export type ErrorOccurrenceV1 = {
  eventId: `EVT_${string}`;
  issueId: `ISS_${string}`;
  receivedAt: string;
  source: TelemetryEnvelopeV1['source'];
  errorCode: string;
  exceptionType: string;
  safeMessage: string;
  stackArtifactId?: string;
  requestId?: `REQ_${string}`;
  traceId?: string;
  release: string;
  service: string;
  route?: string;
  userRef?: string;
  userRole?: string;
  sessionHash?: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  tags: Record<string, string>;
};

export type ApiProblem = {
  code: string;
  message: string;
  eventId?: `EVT_${string}`;
  requestId: `REQ_${string}`;
  retryable: boolean;
};
```

- [ ] **Step 2: Write RED contract/ID tests**

Require ULID monotonic ordering, prefixes, UTC ISO timestamps, 64 KiB browser encoding limit, breadcrumb maximum 30, and compile-time rejection of arbitrary payload/body fields.

- [ ] **Step 3: Implement minimal SDK factories**

Browser and server exports share contracts/sanitizer interfaces but import no React/Express. SDK users inject transport, release, service, and identity-token supplier.

- [ ] **Step 4: Add deterministic package publishing**

Publish only from signed `telemetry-v*` tags to the private package registry. CI runs `npm pack --dry-run`, tests, typecheck, and asserts the tarball excludes fixtures/source maps/secrets.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run packages/contracts packages/telemetry-sdk
npm pack --workspace packages/telemetry-sdk --dry-run
git add packages/contracts packages/telemetry-sdk .github/workflows/publish-telemetry-sdk.yml
git commit -m "feat(telemetry): define versioned browser and server sdk"
```

---

### Task 2: Implement the two-stage sanitizer and signed browser identity

**Files:**
- Create: `edutrack-ops/packages/security/src/telemetry/sanitizer.ts`
- Create: `edutrack-ops/packages/security/src/telemetry/sanitizer.test.ts`
- Create: `edutrack-ops/packages/security/src/telemetry/sensitiveCorpus.test.ts`
- Create: `edutrack-ops/packages/security/src/telemetry/contextToken.ts`
- Create: `edutrack-ops/packages/security/src/telemetry/contextToken.test.ts`
- Modify: `edutrack-ops/packages/telemetry-sdk/src/browser.ts`
- Modify: `edutrack-ops/packages/telemetry-sdk/src/server.ts`

**Interfaces:**
- Produces: `sanitizeTelemetry`, `issueTelemetryContextToken`, and `verifyTelemetryContextToken`.

- [ ] **Step 1: Write sanitizer property/corpus tests**

The corpus includes nested/circular objects, headers, URLs/query strings, JWTs, Bearer tokens, cookies, OTPs, passwords, phone/email, face image/data URL, file body, database URL, API keys, authorization, CSRF, and assignment text. Assert none survive in serialized output.

```ts
expect(serialized).not.toMatch(/Bearer |postgres:\/\/|authorization|password|otp|data:image/i);
expect(serialized).toContain('[REDACTED]');
```

- [ ] **Step 2: Implement deny-by-default context handling**

Allow only contract fields and explicitly allowlisted tag/entity keys (`studentId`, `classId`, `invoiceId`, `jobName`) with bounded string values. Hash session identifiers with a dedicated telemetry pepper. Truncate strings/stacks and recursion depth deterministically.

- [ ] **Step 3: Write signed-context tests**

Use HMAC-SHA256 with key ID and canonical payload. Require 15-minute expiry, audience `edutrack-ops-ingest`, channel, user reference, role, safe display label, session hash, nonce, and constant-time signature verification. Tamper/expiry/wrong audience yields anonymous identity.

- [ ] **Step 4: Implement and wire both sanitizer stages**

SDK sanitizes before transport/spool. Collector reuses the same sanitizer package and records whether fields were redacted. It never attempts to restore redacted data.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run packages/security/src/telemetry packages/telemetry-sdk
git add packages/security/src/telemetry packages/telemetry-sdk
git commit -m "feat(telemetry): sanitize payloads and sign browser identity"
```

---

### Task 3: Create error-ingestion and issue database schema

**Files:**
- Create: `edutrack-ops/packages/db/src/schema/ingestion.ts`
- Create: `edutrack-ops/packages/db/src/schema/errors.ts`
- Create: `edutrack-ops/packages/db/src/schema/alerts.ts`
- Create: `edutrack-ops/packages/db/src/schema/releases.ts`
- Modify: `edutrack-ops/packages/db/src/schema/index.ts`
- Create: `edutrack-ops/packages/db/migrations/0002_error_operations.sql`
- Create: `edutrack-ops/packages/db/src/errorMigration.test.ts`

**Interfaces:**
- Produces: partitioned append-only ingest/event tables and repositories used by collector/processor/notifier.

- [ ] **Step 1: Write migration tests**

Assert creation of the error tables in the spec, monthly partitions for current/next month, unique `(ingest_client_id,idempotency_key)`, unique issue fingerprint, incident links, activity sequence, alert delivery idempotency, release/source-map uniqueness, and append-only grants.

- [ ] **Step 2: Run RED**

Run: `npx vitest run packages/db/src/errorMigration.test.ts`

- [ ] **Step 3: Implement schema**

Store raw sanitized envelope JSONB plus indexed source, received time, event ID, request ID, release, and processing state in a separate table. `error_events` stores normalized fields; large stacks/breadcrumbs use encrypted artifact references when above row limits. `error_issues` stores counts/first-last seen/affected-user estimates and current workflow state.

- [ ] **Step 4: Add append-only and partition tests**

As the runtime role, verify `UPDATE`/`DELETE` on `ingest_envelopes` and `error_events` fail. Advance the test clock/month and verify partition creation/retention does not drop active issue aggregates.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run packages/db/src/errorMigration.test.ts
git add packages/db
git commit -m "feat(db): add partitioned error operations schema"
```

---

### Task 4: Build browser/server ingestion endpoints and durable spools

**Files:**
- Create: `edutrack-ops/apps/api/src/modules/ingest/browserIngest.ts`
- Create: `edutrack-ops/apps/api/src/modules/ingest/serverIngest.ts`
- Create: `edutrack-ops/apps/api/src/modules/ingest/hmac.ts`
- Create: `edutrack-ops/apps/api/src/modules/ingest/ingestRoutes.ts`
- Test: matching `*.test.ts` files.
- Create: `edutrack-ops/packages/telemetry-sdk/src/browserSpool.ts`
- Create: `edutrack-ops/packages/telemetry-sdk/src/browserSpool.test.ts`
- Create: `edutrack-ops/packages/telemetry-sdk/src/serverSpool.ts`
- Create: `edutrack-ops/packages/telemetry-sdk/src/serverSpool.test.ts`

**Interfaces:**
- Produces: `POST /api/v1/ingest/browser`, `/server`, `/server/batch`, `BrowserSpool`, and `ServerSpool`.

- [ ] **Step 1: Write ingestion security tests**

Cover allowed/disallowed Origin, public project key scope, 64 KiB limit, rate limit by IP/session/fingerprint, HMAC canonical request, ±60-second clock skew, one-time nonce, replay, client disable/rotation, batch partial failure, idempotent retry, and `202` only after raw insert commits.

- [ ] **Step 2: Implement browser IndexedDB spool**

Keep sanitized envelopes only. Enforce 100/5 MiB/24-hour limits, oldest-first eviction, online/visibility flush, exponential backoff/jitter, and remove only after collector acknowledges the idempotency key.

- [ ] **Step 3: Implement Node spool**

Use mode-`0600` files under an explicit allowlisted directory, atomic rotate/rename, one JSON envelope per line, 64 MiB total limit, oldest-first retention, lock file, and HMAC batch flush. `captureException` generates/returns the event ID before local append and never waits for remote delivery.

- [ ] **Step 4: Implement routes**

Validate, sanitize again, verify identity/HMAC, insert raw envelope and processing state transactionally, then return:

```json
{ "accepted": true, "eventId": "EVT_01K3...", "duplicate": false }
```

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/api/src/modules/ingest packages/telemetry-sdk/src/browserSpool.test.ts packages/telemetry-sdk/src/serverSpool.test.ts
git add apps/api/src/modules/ingest packages/telemetry-sdk
git commit -m "feat(ingest): durably collect telemetry with bounded spools"
```

---

### Task 5: Implement normalization, source maps, fingerprinting, and issue lifecycle

**Files:**
- Create: `edutrack-ops/apps/processor/src/normalize/normalizeEvent.ts`
- Create: `edutrack-ops/apps/processor/src/normalize/normalizeEvent.test.ts`
- Create: `edutrack-ops/apps/processor/src/sourceMaps/sourceMapService.ts`
- Create: `edutrack-ops/apps/processor/src/sourceMaps/sourceMapService.test.ts`
- Create: `edutrack-ops/apps/processor/src/issues/fingerprint.ts`
- Create: `edutrack-ops/apps/processor/src/issues/fingerprint.test.ts`
- Create: `edutrack-ops/apps/processor/src/issues/processEnvelope.ts`
- Create: `edutrack-ops/apps/processor/src/issues/processEnvelope.test.ts`
- Create: `edutrack-ops/apps/processor/src/index.ts`

**Interfaces:**
- Produces: `normalizeEvent`, `symbolicateStack`, `fingerprintEvent`, and idempotent `processEnvelope`.

- [ ] **Step 1: Write normalization/fingerprint tests**

Assert volatile IDs/timestamps/user values do not change fingerprint, while stable error code/service/exception/top app frames/route/job do. Exclude browser-extension/vendor frames and normalize minified frames after source mapping.

- [ ] **Step 2: Write issue-state tests**

First event creates `NEW`; repeats increment counts/last seen/affected user estimate; resolved repeat creates `REGRESSED` activity exactly once; ignored issues still count but do not notify; concurrent processing cannot double-increment.

- [ ] **Step 3: Implement source-map lookup**

Resolve maps by release/build/file digest from private object storage, verify checksum, cap CPU/time and stack frames, cache safely, and mark `symbolicationStatus` without dropping the event on failure.

- [ ] **Step 4: Implement idempotent processor loop**

Claim processing state with `FOR UPDATE SKIP LOCKED`, normalize, insert occurrence, upsert issue/activity in one transaction, enqueue an alert candidate, and mark processing state. On failure increment attempts and dead-letter after the configured maximum.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/processor/src
git add apps/processor
git commit -m "feat(errors): group source mapped occurrences into issues"
```

---

### Task 6: Build Error Inbox, issue detail, incidents, releases, and SSE

**Files:**
- Create: `edutrack-ops/apps/api/src/modules/issues/issueRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/issues/issueRoutes.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/incidents/incidentRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/incidents/incidentRoutes.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/events/eventStream.ts`
- Create: `edutrack-ops/apps/api/src/modules/events/eventStream.test.ts`
- Create: `edutrack-ops/apps/web/src/pages/ErrorInboxPage.tsx`
- Create: `edutrack-ops/apps/web/src/pages/IssueDetailPage.tsx`
- Create: `edutrack-ops/apps/web/src/pages/LiveEventsPage.tsx`
- Create: `edutrack-ops/apps/web/src/pages/IncidentsPage.tsx`
- Create: `edutrack-ops/apps/web/src/pages/ReleasesPage.tsx`
- Create: `edutrack-ops/apps/web/src/features/errors/*`
- Test: matching `*.test.tsx` files.

**Interfaces:**
- Produces: issue/incident APIs, `/api/v1/operations/events/stream`, and the complete Error Operations UI.

- [ ] **Step 1: Write API authorization/workflow tests**

Viewer may list/view redacted records; maintainer may assign/acknowledge/investigate/resolve/ignore/comment/link incident; owner has no hidden ability to reveal source secrets. Invalid transitions return `409`. Every mutation appends activity and audit.

- [ ] **Step 2: Write SSE tests**

Authenticate session, limit one connection/session, send heartbeat every 20 seconds, resume from `Last-Event-ID`, expose issue summaries only, and fall back to TanStack Query polling after disconnect.

- [ ] **Step 3: Build Inbox and filters**

Implement severity/status/service/release/assignee/time filters, search by issue/event/request ID, first/last seen, occurrence count, affected users, regression indicator, and keyboard navigation.

- [ ] **Step 4: Build Issue Detail and incident flow**

Show safe stack/component stack, breadcrumbs, request timeline, affected users, route/release, similar occurrences, activity, assignment, resolution note, incident link, and read-only SQL handoff. Encrypted/raw artifacts are fetched only on an explicit authorized action and still return sanitized content.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/api/src/modules/issues apps/api/src/modules/incidents apps/api/src/modules/events apps/web/src/features/errors apps/web/src/pages
npm run build --workspace apps/web
git add apps/api/src/modules apps/web/src
git commit -m "feat(errors): add error inbox incidents and live events"
```

---

### Task 7: Implement severity, alert deduplication, Zalo/email, and escalation

**Files:**
- Create: `edutrack-ops/apps/notifier/src/severity/classifySeverity.ts`
- Create: `edutrack-ops/apps/notifier/src/severity/classifySeverity.test.ts`
- Create: `edutrack-ops/apps/notifier/src/policy/alertPolicy.ts`
- Create: `edutrack-ops/apps/notifier/src/policy/alertPolicy.test.ts`
- Create: `edutrack-ops/apps/notifier/src/channels/zalo.ts`
- Create: `edutrack-ops/apps/notifier/src/channels/email.ts`
- Create: `edutrack-ops/apps/notifier/src/channels/channels.test.ts`
- Create: `edutrack-ops/apps/notifier/src/worker.ts`
- Create: `edutrack-ops/apps/notifier/src/worker.test.ts`
- Create: `edutrack-ops/apps/web/src/pages/AlertSettingsPage.tsx`

**Interfaces:**
- Produces: severity classification, deduplicated delivery jobs, provider adapters, reminders/escalation, and alert configuration UI.

- [ ] **Step 1: Write deterministic severity tests**

Rules include database unavailable/login outage/data-loss/recovery failure -> Critical; finance/core multi-user/new regression -> High; isolated retryable -> Medium; non-core handled -> Low. Explicit rule overrides are versioned/audited.

- [ ] **Step 2: Write alert-window tests**

Require one immediate notification per new Critical/High issue, High aggregation over five minutes, Critical reminder at five minutes unacknowledged, owner escalation at 15 minutes, resolved notification, regression notification, and idempotent delivery keys.

- [ ] **Step 3: Implement safe provider adapters**

Send only severity, issue ID, safe title, service/release, count, first/last time, and HTTPS link. Enforce provider timeouts, retry/backoff, response redaction, and circuit breakers. A final delivery failure creates/updates a provider issue through a non-recursive internal path.

- [ ] **Step 4: Build settings with dry-run test**

Owner configures recipient IDs/addresses through secret-backed references, not plaintext DB secrets. “Send test alert” creates an audited synthetic delivery and shows channel results.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/notifier apps/web/src/pages/AlertSettingsPage.test.tsx
git add apps/notifier apps/web/src/pages/AlertSettingsPage.tsx
git commit -m "feat(alerts): notify and escalate critical error issues"
```

---

### Task 8: Add release registration and private source-map upload

**Files:**
- Create: `edutrack-ops/apps/api/src/modules/releases/releaseRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/releases/releaseRoutes.test.ts`
- Create: `edutrack/scripts/publish-ops-release.mjs`
- Create: `edutrack/scripts/publish-ops-release.test.mjs`
- Modify: `edutrack/vite.config.ts`
- Modify: `edutrack/vite.esp.config.ts`
- Modify: `edutrack/scripts/build-server.mjs`
- Modify: `edutrack/.github/workflows/ci.yml`
- Modify: `edutrack/deploy/vps/activate-host.sh`

**Interfaces:**
- Produces: signed release manifest/source-map upload and public artifacts without `.map` files.

- [ ] **Step 1: Write Ops upload API tests**

Require HMAC-authenticated release client, release/build/commit IDs, schema manifest checksum, per-file SHA-256, size/type limits, object encryption, idempotent re-upload of identical maps, and conflict on same key/different digest.

- [ ] **Step 2: Write app publisher tests**

Given fixture `dist`/`dist-esp`/`dist-server`, assert manifest lists maps and bundle digests, upload happens before deletion, failed upload leaves release activation blocked, logs contain names/digests only, and final public static directories contain no `.map`.

- [ ] **Step 3: Enable hidden frontend and server source maps**

Set Vite production source maps to `hidden`; keep esbuild server source maps. The publisher uploads maps privately, verifies readback/checksum, removes frontend maps from deploy artifacts, and records release metadata.

- [ ] **Step 4: Add CI/release gate**

Build -> publish release/maps -> verify -> strip public maps -> package artifacts. PR CI tests the script with a fake server; only protected deployment jobs receive release HMAC credentials.

- [ ] **Step 5: Run and commit in both repositories**

```bash
npx vitest run apps/api/src/modules/releases
git add apps/api/src/modules/releases
git commit -m "feat(releases): accept private source maps"
```

In `edutrack`:

```bash
npx vitest run scripts/publish-ops-release.test.mjs
npm run build:vps
npm run build:esp
git add scripts/publish-ops-release.mjs scripts/publish-ops-release.test.mjs vite.config.ts vite.esp.config.ts scripts/build-server.mjs .github/workflows/ci.yml deploy/vps/activate-host.sh
git commit -m "feat(telemetry): publish release metadata and private source maps"
```

---

### Task 9: Instrument Express, API errors, process context, and compatibility envelope

**Files:**
- Create: `edutrack/server/api/lib/telemetry/requestContext.ts`
- Create: `edutrack/server/api/lib/telemetry/requestContext.test.ts`
- Create: `edutrack/server/api/lib/telemetry/serverTelemetry.ts`
- Create: `edutrack/server/api/lib/telemetry/serverTelemetry.test.ts`
- Create: `edutrack/server/api/telemetry/route.ts`
- Test: `edutrack/server/api/telemetry/route.test.ts`
- Modify: `edutrack/server/http/app.ts`
- Modify: `edutrack/server/http/app.test.ts`
- Modify: `edutrack/server/http/routes.ts`
- Modify: `edutrack/server/api/lib/http/apiResponse.ts`
- Modify: `edutrack/server/api/lib/http/apiResponse.test.ts`
- Modify: `edutrack/server/index.ts`
- Modify: `edutrack/deploy/vps/nginx.conf`
- Modify: `edutrack/.env.example`
- Modify: `edutrack/package.json`
- Modify: `edutrack/package-lock.json`

**Interfaces:**
- Produces: AsyncLocalStorage request context, signed telemetry identity endpoint, captured final/API/process errors, and versioned problem envelopes.

- [ ] **Step 1: Add pinned SDK dependency and write request-context tests**

Validate incoming `X-Request-Id` against bounded ASCII format or generate `REQ_` ID; always return it. Require isolation across concurrent requests and propagation through promises/background boundaries.

- [ ] **Step 2: Write final-handler and envelope tests**

For v2 header, expect nested `ApiProblem`; for old clients, expect existing `error` string/`errorCode`. Internal 500 message/stack is never public. Captured `eventId` and `requestId` are present in v2.

- [ ] **Step 3: Implement server telemetry and context endpoint**

Configure SDK from `OPS_INGEST_URL`, client ID/key, release, service, and `/srv/edutrack/shared/spool/ops-telemetry`. `/api/v1/telemetry/context` requires normal session and returns a 15-minute signed minimal token.

- [ ] **Step 4: Instrument app/process boundaries**

Add request middleware before `/api`, capture route/final exceptions, and register `unhandledRejection`/`uncaughtException` capture before controlled shutdown. Prevent duplicate capture by carrying `eventId` on the error/problem context.

- [ ] **Step 5: Forward request ID on both Nginx vhosts**

Set `X-Request-Id $request_id` for staff and ESP proxies; Express still validates/generates its own ID.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run server/api/lib/telemetry server/api/telemetry server/http/app.test.ts server/api/lib/http/apiResponse.test.ts server/index.test.ts
npm run typecheck
git add server package.json package-lock.json deploy/vps/nginx.conf .env.example
git commit -m "feat(telemetry): correlate and capture api process errors"
```

---

### Task 10: Instrument database, document store, jobs, background tasks, and providers

**Files:**
- Create: `edutrack/server/db/instrumentedPool.ts`
- Create: `edutrack/server/db/instrumentedPool.test.ts`
- Modify: `edutrack/server/db/client.ts`
- Modify: `edutrack/server/api/lib/jobs/jobStore.ts`
- Modify: `edutrack/server/api/lib/jobs/jobStore.test.ts`
- Modify: `edutrack/server/runtime/backgroundTasks.ts`
- Create: `edutrack/server/runtime/backgroundTasks.test.ts`
- Modify: `edutrack/server/api/lib/zalo/zaloHelper.ts`
- Modify: provider adapters under `edutrack/server/api/lib/payments/`, `storage/`, and `zalo-bot/`
- Create: `edutrack/server/api/lib/telemetry/providerBoundary.ts`
- Create: `edutrack/server/api/lib/telemetry/providerBoundary.test.ts`
- Create: `edutrack/server/api/lib/telemetry/documentStoreBoundary.ts`
- Create: `edutrack/server/api/lib/telemetry/documentStoreBoundary.test.ts`

**Interfaces:**
- Produces: one capture boundary for PostgreSQL queries/pool, document-store operations, jobs/background tasks, and external providers.

- [ ] **Step 1: Write database instrumentation tests**

Require failed queries capture SQLSTATE, operation/fingerprint, duration, request/job context, and safe table tag when known, but not raw parameter values or full SQL containing literals. Idle pool errors are captured as database source.

- [ ] **Step 2: Implement an instrumented Pool**

Wrap `Pool.query`/client checkout used by Drizzle and direct callers, time operations, capture rejection once, and preserve exact pg call/return/error semantics. Do not swallow or convert domain errors.

- [ ] **Step 3: Instrument tracked jobs/background tasks**

On failure, keep current job status behavior, capture `jobName`, job/run ID, request context, and rethrow where current semantics require. Replace background `console.error` with capture plus sanitized structured log.

- [ ] **Step 4: Instrument provider/document-store adapters**

Wrap provider calls with provider name/operation/status/timeout/retry tags. Wrap the document-store boundary centrally; do not edit every business handler independently. Redact URLs/tokens/payloads.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run server/db/instrumentedPool.test.ts server/api/lib/jobs server/runtime/backgroundTasks.test.ts server/api/lib/telemetry
npm run typecheck
git add server/db server/api/lib/jobs server/runtime server/api/lib/telemetry server/api/lib/zalo server/api/lib/payments server/api/lib/storage server/api/zalo-bot
git commit -m "feat(telemetry): capture database job and provider failures"
```

---

### Task 11: Instrument staff and ESP browsers

**Files:**
- Create: `edutrack/src/lib/telemetry/browserTelemetry.ts`
- Create: `edutrack/src/lib/telemetry/browserTelemetry.test.ts`
- Create: `edutrack/src/lib/queryClient.ts`
- Create: `edutrack/src/lib/queryClient.test.ts`
- Modify: `edutrack/src/components/common/ErrorBoundary.tsx`
- Create: `edutrack/src/components/common/ErrorBoundary.test.tsx`
- Modify: `edutrack/src/lib/api/apiClient.ts`
- Modify: `edutrack/src/lib/api/apiClient.test.ts`
- Modify: `edutrack/src/App.tsx`
- Modify: `edutrack/src/main.tsx`
- Modify: `edutrack/src/esp/main.tsx`
- Modify: `edutrack/.env.example`

**Interfaces:**
- Produces: browser telemetry singleton, global browser/runtime/query/API capture, and backend-event enrichment.

- [ ] **Step 1: Write browser boundary tests**

Cover ErrorBoundary, `window.error`, `unhandledrejection`, QueryCache/MutationCache, offline/timeout/fetch failures, duplicate backend `eventId` enrichment, route/navigation breadcrumbs, identity token refresh, IndexedDB retry, and consent-independent operational capture with privacy policy.

- [ ] **Step 2: Replace audit misuse in ErrorBoundary**

Remove dynamic `logAuditActivity('system_crash')`. Call `browserTelemetry.captureException(error,{componentStack})`; retain safe fallback/reload UI and avoid recursive capture when telemetry itself fails.

- [ ] **Step 3: Create shared QueryClient factory**

Configure global query/mutation error hooks and reuse from staff `App.tsx` and ESP `main.tsx`. Capture only terminal failures after library retries and skip deliberate cancellations.

- [ ] **Step 4: Upgrade ApiError and compatibility parsing**

`ApiError` exposes `code`, `eventId`, `requestId`, `retryable`, `status`, and safe data. Send `X-Error-Envelope-Version: 2`; parse both v2 and legacy. Network errors create a browser occurrence; backend event IDs are enriched, not duplicated.

- [ ] **Step 5: Install global listeners once**

Initialize before React render in both entrypoints, remove listeners in tests, cap breadcrumbs, and never capture password/OTP/input values.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run src/lib/telemetry src/lib/queryClient.test.ts src/components/common/ErrorBoundary.test.tsx src/lib/api/apiClient.test.ts
npm run typecheck
npm run build
npm run build:esp
git add src .env.example
git commit -m "feat(telemetry): capture staff and esp browser errors"
```

---

### Task 12: Add heartbeat, retention, synthetic canary, and end-to-end gates

**Files:**
- Create: `edutrack-ops/apps/processor/src/jobs/retention.ts`
- Create: `edutrack-ops/apps/processor/src/jobs/retention.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/operations/heartbeatRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/operations/heartbeatRoutes.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/synthetic/syntheticRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/synthetic/syntheticRoutes.test.ts`
- Create: `edutrack/e2e/error-pipeline.spec.ts`
- Create: `edutrack-ops/e2e/error-operations.spec.ts`
- Create: `edutrack-ops/docs/runbooks/error-operations.md`

**Interfaces:**
- Produces: heartbeat/watchdog, retention, controlled canary, and full-pipeline evidence.

- [ ] **Step 1: Write retention/heartbeat tests**

Drop only expired monthly occurrence partitions; retain issues/incidents/activities; preserve source maps while referenced. Heartbeat marks service unhealthy after three missed intervals and creates one deduplicated issue.

- [ ] **Step 2: Implement controlled synthetic events**

Canary endpoints require a scoped HMAC/owner action, tag events `synthetic=true`, support browser/API/database/job/provider scenarios, and never mutate business data. The checker waits for Inbox grouping and expected alert delivery.

- [ ] **Step 3: Write Playwright pipeline tests**

Verify browser render/runtime/API failure, signed user identity, request/release/source-map details, Critical alert test delivery, issue acknowledgement/resolution/regression, collector outage with spool retry, and no duplicate after retry.

- [ ] **Step 4: Run full verification**

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

Run equivalent commands in `edutrack` plus `npm run build:vps`, `npm run build:esp`, and its Error Pipeline E2E target.

- [ ] **Step 5: Commit and dark-launch**

```bash
git add apps packages e2e docs/runbooks/error-operations.md
git commit -m "feat(errors): verify and operate the complete error pipeline"
```

Deploy ingestion with outbound alert rules disabled for seven days. Review sampled redaction/fingerprints, then enable Critical and High notifications only after the acceptance gates pass.

**Exit gate:** every required synthetic source appears with correct time/code/user/request/release, symbolication works, alert SLO is proven, collector outage is fail-open for app traffic, and no known secret/PII appears in searchable telemetry.
