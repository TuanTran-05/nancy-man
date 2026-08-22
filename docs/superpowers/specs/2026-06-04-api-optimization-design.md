# API Optimization Design

## Context

The project already has several good performance foundations:

- Cursor-style pagination is used in the read API and selected list endpoints.
- Firestore Admin and PayOS clients are module-level singletons on warm Vercel invocations.
- There is an in-memory TTL cache with inflight de-duplication.
- Dashboard and finance reports already have read-model or aggregate paths.
- Student, parent dashboard, and payment APIs already project payloads instead of returning every stored field.

The main remaining latency risks are repeated auth Firestore reads, heavy read endpoints that still aggregate several collections at request time, optional side effects that sometimes run inside the request path, and missing production verification for compression and response size.

## Assumptions

- The first implementation pass should preserve behavior and security checks.
- We should not add Redis, Upstash, or another paid cache dependency until existing low-risk optimizations have been measured.
- Critical audit logs must remain durable before the response returns.
- Optional notifications, optional audit entries, and retryable external calls can move to outbox/background processing.
- Vercel may already compress responses, but the project should verify this with a repeatable script instead of guessing.

## Brainstormed Approaches

### Approach A: Low-risk serverless optimization first

This approach removes duplicated auth/context reads, expands the existing TTL cache and read-model usage, moves retryable side effects to the existing outbox queue, and adds measurement. It does not change storage infrastructure.

Trade-off: It produces practical wins quickly, but cache hit rates are limited to warm function instances unless backed by Firestore read models.

Recommendation: Use this approach first. It fits the current architecture and can be tested incrementally.

### Approach B: Add distributed cache and compression first

This approach adds Redis or Vercel KV, centralized cache invalidation, and explicit compression middleware.

Trade-off: It can help under high traffic, but it adds operational cost and invalidation risk before proving the bottleneck. It also does not fix duplicate auth reads or request-path side effects.

Recommendation: Defer until p95 data shows warm in-memory cache/read models are not enough.

### Approach C: Rewrite API routing around a dedicated backend framework

This approach moves Vercel functions into an Express/Fastify/Hono service with global middleware for auth, logging, compression, and connection pooling.

Trade-off: It creates a clearer middleware pipeline, but it is a large migration and would disturb many tested endpoints.

Recommendation: Not appropriate for the first pass.

## Proposed Design

### 1. Measurement First

Add small server-side timing helpers for API handlers. The first pass should measure auth verification, context loading, Firestore query blocks, external calls, serialization size, and total handler time on selected endpoints. The measurement output should be visible through `Server-Timing` headers in non-production or when an explicit diagnostic flag is enabled.

This gives a baseline before changes and lets the team verify improvements with existing k6 scripts.

### 2. Auth Context De-duplication

The read API currently calls `verifyAuthToken`, which reads the user document and sometimes the linked student document, then calls `getUserContext`, which reads the same data again. Add a new `verifyAuthContext` helper that performs the same security checks and returns both the decoded token and `UserContext` from the same snapshots.

The first consumer should be `api/read/[channel].ts`, because it is the centralized high-traffic read path. Existing `verifyAuthToken` remains available for mutation handlers to reduce blast radius.

Security rule: do not remove revocation or blocked-account checks. The optimization is read de-duplication, not weaker auth.

### 3. Cache and Read-model Expansion

Keep the current in-memory TTL cache, but use it through a read-cache helper that builds role-aware, user-aware keys. Cache only final serializable payloads, not Firestore snapshots.

Apply caching to:

- `dashboard-aggregate`: keep reading `read_models/dashboard_global`, but cache final payload briefly.
- `admin-dashboard-summary`: cache final summary payload, not query snapshots.
- `parent-dashboard`: use a short TTL keyed by uid/studentId/limit.
- Zalo token/config access: retain current module cache and avoid extra Firestore reads where a valid token is already loaded.

For larger, cross-user views, prefer Firestore read models over long in-memory cache. This keeps correctness predictable in serverless cold starts.

### 4. Async Side Effects and Logging

Use the existing outbox queue for retryable external side effects, starting with receipt payment confirmation Zalo sends. The job handler already exists for `send_zalo_receipt_confirmation`; production code should enqueue jobs instead of awaiting the Zalo call on receipt post/create-and-post paths.

For logging:

- Keep `writeCriticalAuditLog` and `writeRequiredAuditLog` awaited.
- Convert clearly optional `writeAuditLog` calls to a helper such as `writeOptionalAuditLog` that fires and records failures without blocking the response.
- Keep console logging simple for now; avoid adding a logging vendor until latency data shows it matters.

### 5. Payload Compression and Response Hygiene

Add a repeatable compression check script that calls production or preview endpoints with `Accept-Encoding: br,gzip` and records `Content-Encoding`, `Content-Length`, and downloaded byte count.

If Vercel already compresses JSON responses, do not add manual compression. If it does not, revisit a small compression layer only for large JSON endpoints. Continue payload projection work by keeping large dashboards bounded and excluding raw diagnostic fields.

### 6. Testing and Rollout

Each optimization should ship with focused unit tests and one load-test comparison:

- Unit tests for auth context de-duplication.
- Unit tests for read-cache key isolation and inflight de-duplication.
- Unit tests for outbox enqueue behavior.
- k6 smoke/load comparison for p50/p95/p99 before and after.

Roll out in this order:

1. Measurement helpers.
2. Read API auth de-duplication.
3. Read-cache payload changes.
4. Outbox for Zalo receipt confirmation.
5. Compression verification script and final p95 comparison.

## Non-goals

- Do not add Redis or a paid cache provider in the first pass.
- Do not weaken token revocation checks.
- Do not move critical audit writes to best-effort background jobs.
- Do not rewrite all APIs into a new framework.
- Do not manually compress responses until platform behavior is verified.

## Success Criteria

- Read API no longer performs duplicate user/student Firestore reads after auth.
- Hot dashboard endpoints serve from cache/read models without caching Firestore snapshot objects.
- Receipt posting no longer waits for retryable Zalo confirmation delivery.
- Compression status for deployed API JSON responses is known and documented.
- Existing tests pass, and k6 p95 for read-heavy scenarios improves or remains stable while preserving error rate thresholds.

## Design Self-review

- Placeholder scan: no placeholder requirements remain.
- Consistency check: the design preserves existing security and audit behavior while moving only retryable side effects.
- Scope check: this is one cohesive API optimization pass with independent tasks and measurable checkpoints.
- Ambiguity check: distributed cache and manual compression are explicitly deferred until measurement justifies them.
