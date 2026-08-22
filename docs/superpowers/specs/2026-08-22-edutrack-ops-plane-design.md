# EduTrack Operations Plane Design

**Status:** Approved design, consolidated from the maintenance-system design review completed on 2026-08-22.

**Primary host:** `man.thienuy.edu.vn`

**Related but out-of-scope host:** `dev.thienuy.edu.vn`

## 1. Purpose

Build an independent operations plane for the team that maintains EduTrack. It has two product surfaces:

1. **Error Operations** captures, groups, alerts, investigates, and resolves failures from the user-facing applications, API, PostgreSQL, the transitional document store, background jobs, and external providers.
2. **Database Console** lets an authorized maintainer inspect PostgreSQL and execute raw SQL, including DML, DDL, and cluster-level commands, through a controlled server-side execution pipeline with preview, audit, recovery evidence, and measured disaster recovery.

This is not an admin screen inside the user application. It is a separate security and availability domain with separate accounts, sessions, database, deployment, and operational credentials.

## 2. Approved decisions

- `man.thienuy.edu.vn` is a separate internal operations application.
- Maintenance accounts are independent from EduTrack user/staff accounts.
- Authorized maintainers may execute raw SQL on production, including DML and DDL. Cluster-level commands remain available through an explicit break-glass runner.
- A second-person approval is not mandatory. High-risk execution still requires recent MFA, a reason, an exact confirmation phrase, and a recoverability gate.
- Every SQL action is audited and linked to its preview, actor, effect, verification, and recovery metadata.
- Recovery objective for the production PostgreSQL database is **RPO <= 60 seconds** and **RTO <= 15 minutes**, proven by drills.
- Every captured error goes to Error Inbox. Critical issues alert immediately through Zalo and email. High issues are deduplicated and batched over a five-minute window.
- Error telemetry is self-hosted. Sensitive payloads do not go to a third-party observability service.
- `man` manages production errors and production PostgreSQL. Dev/test tooling belongs at `dev.thienuy.edu.vn` and uses a completely separate database.
- The selected architecture is an independent Ops Plane, not a module inside the existing monolith and not a collection of unrelated database/error tools.

## 3. Current-state constraints

The reference source snapshot inspected for this design is `/home/deploy/edutrack-esp-dark-launch-20260822`.

The current application is React 19 + Vite 6, Express 5, Node.js 22, PostgreSQL/Drizzle, and a transitional document-store compatibility layer. Relevant integration points are:

- Express construction and final error handler: `server/http/app.ts`
- Process start/shutdown: `server/index.ts`
- API route resolution: `server/http/routes.ts`
- PostgreSQL pool/Drizzle bootstrap: `server/db/client.ts`
- Structured console logger and sanitizer: `server/api/lib/logging/logger.ts`, `server/api/lib/logging/logSanitizer.ts`
- API error helper: `server/api/lib/http/apiResponse.ts`
- Background task boundary: `server/runtime/backgroundTasks.ts`
- Tracked scheduled jobs: `server/api/lib/jobs/jobStore.ts`
- React crash boundary: `src/components/common/ErrorBoundary.tsx`
- Frontend HTTP client: `src/lib/api/apiClient.ts`
- TanStack Query bootstrap: `src/App.tsx`, `src/esp/main.tsx`
- Production Vite build: `vite.config.ts`
- Nginx, PM2, cron, logical backup, and restore drill: `deploy/vps/*`
- Schema verification: `db/verify-schema.sql`, `db/verify-data.sql`

Observed gaps that this design closes:

- Backend errors are mainly sanitized JSON written to PM2 files; they do not have a durable event ID or complete request correlation.
- The Express fallback returns only a safe message and does not capture the event.
- React render failures are currently written into the business audit stream.
- Browser runtime, unhandled promise, TanStack Query, fetch/network, pool/query, process, and many job failures are not collected into one inbox.
- Frontend production source maps are not prepared for private upload to an operations service.
- Nginx sends `X-Request-Id` on the ESP vhost but the main staff vhost does not consistently propagate one.
- Current PostgreSQL protection is a nightly encrypted logical dump plus isolated restore drill. That is useful but cannot meet RPO <= 60 seconds.
- The application still has document-store calls during the transition. Error telemetry covers those calls; the SQL console does not pretend to edit that store.

## 4. Scope and non-scope

### In scope

- Separate Ops authentication, mandatory MFA, roles, sessions, elevation, and security audit.
- Operations overview, Error Inbox, issue/incident workflow, releases, source maps, live events, notification policy, and service heartbeat.
- Browser, server, job, provider, PostgreSQL, document-store, deployment, and synthetic-canary telemetry.
- PostgreSQL schema browser, raw SQL workspace, history, preview, execution, cancellation, result artifacts, recovery center, and schema drift.
- Continuous WAL archiving, warm standby, isolated restore environment, recovery orchestration, runbooks, and recurring drills.
- Integration changes to the existing EduTrack repository.

### Out of scope

- Dev/test environment management at `dev.thienuy.edu.vn`.
- A generic editor for Firestore/document-store records. Transitional document-store failures are observed, but mutation tooling targets PostgreSQL only.
- Feature flags, test-data generation, QA automation, and staging deployments.
- Automatic rollback of messages already sent to Zalo/email or any external side effect.
- Automatic production cutover after PITR. A human verifies the restored database and explicitly authorizes cutover.

## 5. System topology

```text
User browsers ── browser SDK ───────────────────────────────┐
EduTrack API ── server SDK + local spool ──────────────────┤
Cron/jobs/providers ── server SDK + local spool ───────────┤
                                                            ▼
                                                   Ingestion Gateway
                                                            │ durable append
                                                            ▼
                                                    Ops PostgreSQL
                                                            │
                                       ┌────────────────────┴─────────────────┐
                                       ▼                                      ▼
                                Error Processor                        Alert Worker
                                       │                                      │
                                       ▼                                      ├── Zalo
Browser ── MFA session ──► man.thienuy.edu.vn                                └── Email
                               │
                    ┌──────────┴───────────┐
                    ▼                      ▼
                 Ops API             SQL Worker (private)
                                           │ mTLS/IP allowlist
                                           ▼
                                  Production PostgreSQL
                                           │
                      ┌────────────────────┴─────────────────────┐
                      ▼                                          ▼
               warm standby                             pgBackRest/WAL archive
                                                        on a separate host
```

Deployable processes on the `man` host:

- `ops-web`: static React/Vite application.
- `ops-api`: authenticated API, ingestion endpoints, SSE feed, and orchestration.
- `ops-processor`: event normalization, fingerprinting, grouping, regression, retention, and release processing.
- `ops-notifier`: alert deduplication, Zalo/email delivery, reminders, and escalation.
- `ops-sql-worker`: private process with production database credentials; it exposes no public network listener.

The Ops PostgreSQL database, object storage credentials, auth state, and alert configuration never live in production PostgreSQL. The only Ops-owned objects inside production are the `_ops` journal/registry schema and database roles required by the SQL pipeline.

## 6. Trust boundaries and network rules

1. Public ingress exposes only TLS endpoints on `man`.
2. `/api/v1/ingest/browser` accepts browser events from an explicit origin allowlist and has no read capability.
3. `/api/v1/ingest/server` accepts HMAC-authenticated server batches with timestamp, nonce, and replay protection.
4. Authenticated maintenance APIs require a host-only Ops session cookie and CSRF token.
5. `ops-sql-worker` accepts commands only over a Unix socket or mutually authenticated private connection from `ops-api`.
6. Production PostgreSQL accepts the SQL worker only from the private Ops host address with TLS client authentication and explicit `pg_hba.conf` rules.
7. Browser code never receives `DATABASE_URL`, database credentials, WAL credentials, object-store credentials, source maps, raw encrypted fields, or provider secrets.
8. Error collection failure never changes the success/failure outcome of a user request. Events are spooled and retried.
9. Production database failure must not prevent Ops login, viewing previous errors, viewing runbooks, or starting a recovery workflow.
10. `dev.thienuy.edu.vn` has no network route or credential that can write to production PostgreSQL.

## 7. Operations identity and authorization

### Roles

| Role | Capabilities |
|---|---|
| `ops_viewer` | View operations health, issues, incidents, redacted events, releases, SQL history, recovery status, and audit verification. Cannot execute SQL or change configuration. |
| `ops_maintainer` | All viewer actions; assign/resolve issues; unlock SQL workspace; execute read, DML, transactional DDL, and approved break-glass workflows. |
| `ops_owner` | All maintainer actions; create/revoke Ops accounts, configure MFA recovery and alert channels, rotate ingest clients, and authorize cluster-level break-glass use. |

### Authentication requirements

- Passwords use Argon2id with parameters calibrated on the Ops host and stored with algorithm/version metadata.
- MFA is mandatory. Passkey/WebAuthn is primary; TOTP and single-use hashed recovery codes are fallback factors.
- There is no public registration or public password reset.
- The first owner is bootstrapped through an offline CLI on the Ops host, receives a single-use enrollment link, and must register MFA before normal access.
- Cookie: host-only `man.thienuy.edu.vn`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`.
- Session idle timeout: 30 minutes. Absolute lifetime: 12 hours.
- SQL elevation idle timeout: 15 minutes. Absolute lifetime: 30 minutes.
- High-risk and break-glass execution requires MFA performed within the last five minutes.
- Five failed login attempts in 15 minutes create a 30-minute lock. Progressive IP/account rate limits remain independent to avoid account-lockout abuse.
- Login, logout, failed login, lock, session revoke, MFA registration/recovery, SQL elevation, and break-glass access create security audit entries.

Authorization is checked in the API and enforced again in the worker request contract. UI visibility is not a security boundary.

## 8. Audit integrity

`ops_audit_entries` is append-only and forms a hash chain:

```text
entry_hash = SHA-256(previous_hash || canonical_json(entry_payload))
```

Additional controls are required because an attacker with database authority could otherwise rewrite and rehash the chain:

- A signing key not stored in Ops PostgreSQL signs rolling checkpoints.
- Checkpoints are copied at least every five minutes to an off-host append-only audit receiver/object bucket.
- High-risk SQL creates and anchors a signed pre-execution receipt before privileged credentials are used.
- If the off-host receipt cannot be anchored, DML/DDL/cluster-level execution is blocked. Read-only SQL may continue and records a degraded-audit health event.
- `ops_maintainer` and `ops_owner` database roles cannot update/delete audit tables.
- A scheduled verifier checks chain continuity, signatures, missing sequence numbers, clock anomalies, and off-host anchors.

Every SQL audit record includes actor, role, session, IP, user agent, MFA age, original encrypted SQL, redacted SQL, normalized fingerprint, reason, risk classification, preview ID/checksum, confirmation, start/end time, affected rows, schema and row evidence, WAL LSN, restore point, result, verification, linked issue/incident, and recovery executions.

## 9. Error capture contract

### Required sources

- React render failures.
- `window.error` and `unhandledrejection`.
- HTTP/network/timeout and canonical `ApiError` failures.
- TanStack Query global query/mutation failures.
- Express route and final middleware exceptions.
- PostgreSQL pool errors, query rejections, timeout, deadlock, and constraint failures.
- Transitional document-store query/write failures.
- Tracked cron/background job failures.
- Zalo, email, payment, storage, and other provider failures.
- `uncaughtException`, `unhandledRejection`, startup failure, and graceful-shutdown failure.
- Deployment health/smoke failures and controlled synthetic canaries.
- Collector, processor, notifier, SQL worker, backup, standby, and audit-anchor health failures.

### IDs and correlation

- IDs are sortable ULIDs with prefixes: `EVT_`, `ISS_`, `INC_`, `REQ_`, `SQL_`, `PRV_`, and `RCV_`.
- Nginx forwards `X-Request-Id`; Express validates it or generates a new ID.
- The API stores request context in `AsyncLocalStorage` and propagates request ID, W3C trace ID, release, actor, route, and execution/job ID.
- The same IDs appear in the API error envelope, structured logs, error occurrence, database query context, job run, and provider call.
- If the backend already generated `eventId`, the browser enriches that occurrence with sanitized browser context instead of creating a duplicate root issue.

### Signed browser identity

The public browser ingestion key is not trusted to assert user identity. After app authentication, the EduTrack API issues a short-lived signed telemetry-context token containing only user reference, role, safe display label, session hash, issued/expiry time, and channel. The collector validates the signature before storing “who encountered the error.” A missing/invalid token produces an anonymous browser event rather than trusting client-supplied identity.

### Canonical API problem envelope

```json
{
  "success": false,
  "error": {
    "code": "STUDENT_UPDATE_CONFLICT",
    "message": "Dữ liệu học sinh vừa được thay đổi. Vui lòng tải lại.",
    "eventId": "EVT_01K3...",
    "requestId": "REQ_01K3...",
    "retryable": true
  }
}
```

Rollout is backward compatible: the new frontend advertises `X-Error-Envelope-Version: 2`. During the compatibility window the server returns the nested envelope to v2 clients and the existing top-level `error`/`errorCode` fields to old cached clients. Compatibility is removed only after two stable releases and cache expiry evidence.

### Durable/non-blocking delivery

- Sources generate `eventId` before attempting network delivery.
- Server capture sanitizes then appends to a mode-`0600`, bounded, encrypted local spool and returns control without waiting for the collector.
- Browser capture sanitizes then uses a bounded IndexedDB spool (maximum 100 events, 5 MiB, 24-hour age).
- Batch retry uses exponential backoff, jitter, idempotency key, and a per-service HMAC signature.
- Collector validates size/schema/rate limits, sanitizes again, durably inserts the raw envelope, then returns `202`.
- Processing status is stored separately; the raw occurrence is never mutated.
- Dead-letter records keep the validation reason and a safely truncated payload.

## 10. Sanitization and privacy

The deny policy removes or masks keys and patterns for passwords, password hashes, OTPs, recovery codes, cookies, authorization, CSRF, API/provider/database tokens, private keys, phone numbers, emails, face images, file bodies, assignment content, request/response bodies, and arbitrary input values unless explicitly allowlisted.

Sanitization runs:

1. At the source before spooling.
2. At the collector before durable storage.
3. At presentation/export time according to viewer role.

The error store keeps a minimal signed identity snapshot; it does not copy a student/parent profile. Alert messages contain only severity, issue ID, safe summary, count, service/release, and a link to `man`.

Retention:

- Raw and normalized error occurrences: 90 days.
- Issues, activities, incidents, release aggregates, and alert delivery metadata: 2 years.
- SQL/audit metadata: at least 2 years.
- Encrypted row before/after recovery artifacts: 90 days unless an incident/legal hold extends them.
- Production `_ops.row_change_journal`: retained until encrypted export and integrity verification, then at most 7 days.
- Source maps: retained while any occurrence references the release, then removed by retention job.
- WAL/base backups: minimum 35 days, subject to capacity monitoring and successful restore verification.

## 11. Error processing and workflow

Fingerprint inputs:

- Stable application error code.
- Service/module.
- Exception type.
- Top application stack frames after source-map resolution.
- Frontend route/API route/job name.

Volatile values, user IDs, generated database values, timestamps, and request IDs are excluded from the fingerprint.

Issue lifecycle:

```text
NEW -> ACKNOWLEDGED -> INVESTIGATING -> RESOLVED
                              \-> IGNORED
RESOLVED + new matching occurrence -> REGRESSED
```

Severity policy:

| Severity | Example | Notification |
|---|---|---|
| Critical | login outage, database unavailable, data-loss signal, broad failure, failed recovery/backup chain | Inbox + immediate Zalo/email; remind after 5 minutes; escalate after 15 minutes |
| High | core workflow or finance job failing for multiple users; new regression | Inbox + first/regression alert; repeats aggregated in 5-minute window |
| Medium | isolated request/user failure with recovery/retry | Inbox + digest |
| Low | non-core degradation or known handled failure | Store and report only |

Resolve requires a resolution note and release/execution reference when applicable. A new occurrence after resolution automatically marks regression and re-alerts according to severity.

## 12. Operations UI information architecture

The UI is desktop-first, responsive down to a tablet, keyboard accessible, and deliberately dense. Production context is always visible. Destructive controls never rely on color alone.

Primary navigation:

- Operations Overview
- Error Inbox
- Live Events
- Incidents
- Releases
- Database / Schema Browser
- Database / SQL Workspace
- Database / Execution History
- Recovery Center
- Alert Settings
- Maintenance Accounts
- Security Audit

Key flows:

1. **Issue investigation:** Inbox -> Issue Detail -> request timeline/user/release -> read-only entity query -> incident or resolution.
2. **Data correction:** Issue Detail -> prefilled read-only SQL -> edit SQL -> reason -> preview -> confirmation/MFA -> execute -> verify -> link execution -> resolve.
3. **Rollback:** Execution History -> recovery eligibility -> reverse preview/selective restore/PITR -> verify -> new recovery execution -> incident timeline.
4. **Critical incident:** alert link -> acknowledge -> incident -> affected issues/services -> runbook -> recovery -> verification -> close/postmortem.

The SQL workspace always shows a fixed `PRODUCTION` target banner, current role, elevation expiry, statement classification, recoverability badge, and active issue/incident link. It never displays a database credential.

## 13. Ops data model

### Auth/security

- `ops_users`
- `ops_password_credentials`
- `ops_mfa_factors`
- `ops_recovery_codes`
- `ops_sessions`
- `ops_login_events`
- `ops_elevation_events`
- `ops_audit_entries`
- `ops_audit_checkpoints`

### Ingestion/errors

- `ingest_clients`
- `ingest_nonces`
- `ingest_envelopes` (monthly partitioned, append-only)
- `ingest_processing_state`
- `ingest_dead_letters`
- `error_events` (monthly partitioned, append-only)
- `error_issues`
- `error_issue_activity`
- `incidents`
- `incident_issues`
- `releases`
- `source_map_objects`
- `alert_rules`
- `alert_deliveries`
- `service_heartbeats`

### Database/recovery

- `sql_executions`
- `sql_statements`
- `sql_impact_previews`
- `sql_restore_points`
- `sql_schema_snapshots`
- `sql_result_artifacts`
- `recovery_jobs`
- `recovery_verifications`

### Production-only `_ops` schema

- `_ops.execution_registry`
- `_ops.row_change_journal`
- `_ops.journaled_tables`

Important invariants:

- Occurrences and audit entries are append-only.
- Issue workflow updates are separate activity entries.
- SQL encrypted text/result/recovery artifact keys are in object storage metadata, not plaintext columns.
- A DML transaction cannot commit if journaling is required but expected journal evidence is missing.
- Journal triggers cover cascaded changes on every registered business table.

## 14. Internal API surface

### Authentication/security

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/mfa/webauthn/options
POST   /api/v1/auth/mfa/webauthn/verify
POST   /api/v1/auth/mfa/totp/verify
POST   /api/v1/auth/logout
POST   /api/v1/auth/elevate
GET    /api/v1/auth/session
GET    /api/v1/security/audit
POST   /api/v1/accounts
POST   /api/v1/accounts/:id/revoke
```

### Ingestion/error operations

```text
POST   /api/v1/ingest/browser
POST   /api/v1/ingest/server
POST   /api/v1/ingest/server/batch
GET    /api/v1/issues
GET    /api/v1/issues/:issueId
PATCH  /api/v1/issues/:issueId/status
POST   /api/v1/issues/:issueId/assign
POST   /api/v1/issues/:issueId/comments
POST   /api/v1/incidents
POST   /api/v1/incidents/:incidentId/issues
GET    /api/v1/events/:eventId
GET    /api/v1/releases
POST   /api/v1/releases/:releaseId/source-maps
GET    /api/v1/operations/health
GET    /api/v1/operations/events/stream
```

### Database/recovery

```text
GET    /api/v1/database/schema
POST   /api/v1/sql/classify
POST   /api/v1/sql/preview
POST   /api/v1/sql/execute
POST   /api/v1/sql/:executionId/cancel
GET    /api/v1/sql/executions
GET    /api/v1/sql/executions/:executionId
POST   /api/v1/sql/:executionId/rollback-preview
POST   /api/v1/sql/:executionId/rollback
POST   /api/v1/recovery/selective
POST   /api/v1/recovery/pitr
GET    /api/v1/recovery/:recoveryId
```

All authenticated mutations require a synchronizer CSRF token. SQL execution never accepts client flags that disable audit, preview, restore points, journaling, or verification.

## 15. SQL classification and roles

The worker parses PostgreSQL syntax and classifies every statement. Parsing is a usability/risk mechanism, not the only security boundary; transaction read-only mode and database roles enforce capability.

| Class | Examples | Database role | Recovery |
|---|---|---|---|
| `READ` | `SELECT`, `SHOW`, `EXPLAIN` without `ANALYZE` mutation | `ops_readonly` | None required |
| `DML` | `INSERT`, `UPDATE`, `DELETE`, `MERGE` | `ops_dml` | Row journal + reverse/selective/PITR |
| `TRANSACTIONAL_DDL` | supported `CREATE`, `ALTER`, `DROP` | `ops_ddl` | Transaction preview + restore point + schema snapshot/PITR |
| `NON_TRANSACTIONAL` | `VACUUM`, `REINDEX/CREATE INDEX CONCURRENTLY`, selected maintenance commands | special runner | PITR/runbook; no fake one-click undo |
| `CLUSTER_LEVEL` | database/role/replication/system commands | sealed break-glass role | Off-host receipt + backup/restore gate + runbook |
| `UNPARSED_BREAK_GLASS` | valid PostgreSQL syntax unsupported by the UI parser | sealed break-glass role | `PITR_ONLY`; exact warning |

Commands that can undermine evidence—modifying `_ops`, disabling journal triggers, changing `session_replication_role`, loading unsafe extensions, `COPY ... PROGRAM`, or audit-role manipulation—are never silently treated as ordinary DDL. They require `ops_owner`, recent MFA, off-host receipt, explicit `PITR_ONLY` acknowledgement, and the break-glass runner.

## 16. SQL execution pipeline

```text
Draft
 -> parse and classify each statement
 -> provide reason and issue/incident reference
 -> risk checks and read/write role selection
 -> preview in bounded transaction
 -> present rows/schema/locks/triggers/recoverability
 -> recent MFA and exact phrase when required
 -> anchor pre-execution audit receipt off-host
 -> create/verify restore point when required
 -> begin real transaction
 -> re-execute and compare actual journal checksum with preview
 -> rollback on drift; otherwise run post-checks
 -> commit
 -> export journal/evidence
 -> append final audit and issue timeline
```

Preview settings default to `statement_timeout=30s`, `lock_timeout=3s`, result limit 500 rows/10 MiB, and read-only transaction for `READ`.

For DML, the “revalidation” is the real transaction: the worker executes the statements with journaling, computes the affected-row identity/before-state checksum, and compares it to the approved preview before commit. A mismatch rolls back and requires a new preview. There is no unsafe second mutation inside the same transaction.

Batch rules:

- Transaction-compatible statements run atomically; one failure rolls back the batch.
- Non-transactional and cluster-level statements are isolated into separate executions.
- A batch takes the risk/recovery class of its most dangerous statement.
- Result rows and artifacts are bounded, encrypted, and access controlled.
- Long-running queries have server-side cancel and timeout; connection termination is the final cancellation mechanism.

## 17. Row journal and reverse recovery

Before/after triggers on registered business tables read `ops.execution_id` from transaction-local settings and append:

- sequence, execution ID, transaction ID, commit timestamp/WAL LSN when available;
- schema/table/operation;
- primary-key JSON;
- complete `OLD` and `NEW` row JSON with generated/large fields handled by policy;
- before/after hashes;
- actor and statement index.

Reverse behavior:

- Original `INSERT`: delete only when current row hash equals the original after-hash.
- Original `UPDATE`: restore the before-image only when current row hash equals the original after-hash.
- Original `DELETE`: reinsert the before-image only when the key is still absent and constraints allow it.
- Cascades are replayed in reverse journal order with foreign-key aware verification.
- A reverse action is a new SQL execution with its own preview, reason, audit, journal, verification, and possible rollback.

If optimistic checks fail, the UI does not overwrite newer data. It starts selective recovery: restore production to an isolated database at the pre-change LSN, compare current and restored rows, generate parameterized repair operations, preview, and apply as a new execution.

## 18. DDL, schema drift, and external effects

- Transactional DDL is previewed in a rollback transaction where supported.
- Every high-risk DDL receives a named restore point and before/after schema snapshot.
- After DDL the worker runs schema/data verification and compares production to the source-controlled Drizzle/migration manifest published with the current release.
- A mismatch creates `SCHEMA_DRIFT`, a High issue, and an incident task to add the equivalent migration to the EduTrack repository.
- Non-transactional commands show `PITR_ONLY` or `NO_AUTOMATIC_UNDO`; the UI never promises reverse SQL.
- Database recovery cannot retract email, Zalo, payment-provider calls, file exports, or any side effect that escaped the transaction. Execution preview lists known outbox/triggers and requires acknowledgement.

## 19. Disaster recovery design

The existing encrypted nightly `pg_dump` remains a logical/export layer, but it is not the RPO/RTO mechanism.

Required PostgreSQL protection:

- pgBackRest full weekly and differential daily backups to a separate self-hosted backup host.
- Continuous WAL archive with `archive_timeout=60s` and monitoring of archive lag/failures.
- Streaming warm standby on infrastructure independent from the production VPS.
- A ready isolated recovery host/database that cannot resolve to the production database identity.
- Named restore points before high-risk SQL.
- Encrypted repositories, independent credentials, checksum verification, retention policy, and capacity alerts.

The Ops PostgreSQL database uses its own pgBackRest stanza and WAL archive on the backup host. Its operational target is RPO <= 5 minutes and RTO <= 60 minutes, with a monthly isolated restore that verifies migrations, audit-chain continuity, issue/incident aggregates, and artifact references. This target is separate from—and must never weaken—the production database objective.

Definitions:

- **RPO** is the gap between the last recoverable committed transaction and the incident recovery target. Gate: <= 60 seconds in drills.
- **RTO** starts when recovery is declared and ends when the verified database endpoint is ready for controlled application cutover. Gate: <= 15 minutes in drills.

Recovery levels:

1. Reverse DML from journal.
2. Selective repair from isolated point-in-time restore.
3. Full PITR to an isolated instance, verify, then explicit cutover.
4. Warm-standby promotion for primary host loss, followed by reconciliation of archive/replication state.

No automated workflow may point the app at a restored database until schema checks, data checks, smoke tests, recovery-target evidence, and a human cutover confirmation all pass.

## 20. Availability and failure behavior

| Failure | Required behavior |
|---|---|
| Collector unavailable | User requests continue; browser/server spool and retry; watchdog alerts independently. |
| Ops processor unavailable | Raw envelopes remain durable and are reprocessed idempotently. |
| Alert provider unavailable | Delivery becomes an issue; alternate channel still attempts; no silent drop. |
| Production DB unavailable | Ops login/history/runbooks still work; SQL execution disabled; recovery UI available. |
| Ops DB unavailable | SQL mutation disabled; source telemetry spools; local emergency audit records append. |
| Backup/audit host unavailable | DML/DDL/break-glass blocked; read-only SQL may continue in degraded mode. |
| SQL worker unavailable | Error Operations remains available; database console shows unhealthy. |
| `man` host unavailable | Source spools preserve events within bounds; host recovery runbook restores Ops services independently. |

## 21. Release and source maps

Every EduTrack deployment publishes:

- commit/source fingerprint;
- build ID and deploy time;
- service versions;
- frontend hidden source maps to private Ops object storage;
- expected PostgreSQL schema manifest/checksum;
- canary result.

Source maps are removed from the public static artifact after upload verification. Server bundles retain local source-map support but private maps/artifacts remain access controlled.

## 22. Security and safety tests

- Auth/MFA/session fixation/CSRF/CORS/brute force/account recovery.
- Cross-cookie and cross-domain rejection between user app, ESP, `man`, and `dev`.
- Ingestion replay, schema abuse, rate-limit, oversized payload, forged identity, and deduplication.
- Sanitizer property tests with nested/circular data and secret/PII corpus.
- Source-map, result-artifact, before-image, and incident authorization.
- SQL parser bypass, stacked statements, comments, dollar quoting, Unicode, transaction control, role switching, trigger disabling, and `COPY PROGRAM`.
- Read-only database role proves mutation impossible even if classifier is bypassed.
- Journal completeness for direct and cascaded insert/update/delete.
- Preview drift, concurrent edits, timeouts, cancellation, and worker crash before/after commit.
- Audit chain rewrite/deletion/missing entry and off-host anchor mismatch.
- Restore target identity guard prevents accidental restore into production.

## 23. Rollout gates

1. DR infrastructure and drills meet RPO/RTO before any production mutation path is enabled.
2. Ops auth/audit foundation is deployed and independently reachable.
3. Error ingestion dark launch runs without alerts; sanitizer/fingerprint are tuned.
4. Synthetic browser/API/database/job/provider errors reach Inbox and source-map correctly.
5. Critical/High alerting is enabled and delivery SLO is proven.
6. SQL read-only is enabled and database role bypass tests pass.
7. DML is enabled for one maintainer after journal/reverse/selective drills.
8. Transactional DDL is enabled after DROP/TRUNCATE recovery drills.
9. Cluster-level/unparsed break-glass is enabled last.
10. A 14-day observation review approves broader account access.

## 24. Acceptance criteria

- 100% of controlled synthetic capture tests pass on every release.
- Critical alert reaches Zalo/email within 60 seconds when providers are healthy.
- Every issue can be traced to request, release, time, source, and validated user reference when available.
- No secret is present in searchable telemetry or alert text.
- Collector outage does not fail user requests and retried events do not duplicate occurrences.
- No SQL mutation commits without execution audit, required journal evidence, and post-check result.
- Every data correction has actor, reason, preview, diff, verification, and recovery reference.
- Read-only SQL remains technically read-only if classification code is bypassed.
- DML reverse operations refuse to overwrite later changes.
- DROP/TRUNCATE/full-host drills prove recovery, RPO <= 60 seconds, and RTO <= 15 minutes.
- `man` remains usable when the user app or production database is down.
- Ops and user sessions/credentials cannot be used across systems.
- `dev.thienuy.edu.vn` has a separate database and no production write path.

## 25. Implementation plan set

1. `docs/superpowers/plans/2026-08-22-edutrack-ops-plane-program.md`
2. `docs/superpowers/plans/2026-08-22-edutrack-ops-dr-foundation.md`
3. `docs/superpowers/plans/2026-08-22-edutrack-ops-foundation.md`
4. `docs/superpowers/plans/2026-08-22-edutrack-error-operations.md`
5. `docs/superpowers/plans/2026-08-22-edutrack-ops-database-readonly.md`
6. `docs/superpowers/plans/2026-08-22-edutrack-ops-database-mutations-recovery.md`
7. `docs/superpowers/plans/2026-08-22-edutrack-ops-hardening-rollout.md`
