# EduTrack Ops Database Explorer Design

**Status:** Draft for review; design brief and architecture approved

**Date:** 2026-09-25

## 1. Purpose

Add a read-only **Database** area to `man.thienuy.edu.vn` so Ops users can inspect the live EduTrack Production database and the separate Ops database without receiving database credentials or a raw SQL execution surface.

The feature is for operational investigation: find a table, inspect bounded rows, follow foreign-key relationships, and understand the schema around a record. It is not an analytics tool or a database administration console.

## 2. Approved scope

### In scope

- Two isolated targets: `EduTrack Production` and `Ops Database`.
- Schema browsing for every authenticated Ops role.
- Table/view data browsing for `ops_maintainer` and `ops_owner`.
- Server-side pagination, one-column sorting, bounded column filters, primary-key lookup, large-cell inspection, and foreign-key navigation.
- A focused relationship graph centered on one relation, with incremental expansion.
- A full ERD with search, zoom/pan, and schema grouping.
- Server-side masking of PII by default.
- A reusable, ten-minute PII reveal grant after password + TOTP verification and a required reason.
- Append-only audit for schema access, row access, and PII reveal/use.

### Out of scope

- Editing, inserting, deleting, or executing DDL.
- A raw SQL editor or generated SQL visible to the browser.
- CSV or bulk export.
- Cross-database joins or queries.
- PostgreSQL system catalogs as user-selectable data tables.
- Returning credential, password, OTP, session, encryption, or provider-token values under any role or reveal state.

## 3. Current foundation

The repo already has:

- `GET /api/v1/database/schema` and PostgreSQL catalog introspection.
- A private HMAC-authenticated Unix-socket SQL worker.
- A dedicated production read connection with TLS `verify-full`, identity checks, `default_transaction_read_only=on`, maximum two connections, and bounded SQL execution primitives.
- Ops roles and `sql:read` permission.
- Reusable step-up grants and an append-only hash-chained audit ledger.

The current implementation is single-target, has no structured row-browsing command, and has no Database UI. The earlier raw-SQL workspace plan is not part of this feature.

## 4. Security model

### Access matrix

| Capability | `ops_viewer` | `ops_maintainer` | `ops_owner` |
|---|---:|---:|---:|
| List targets | Yes | Yes | Yes |
| View schemas, columns, keys, indexes, triggers, RLS | Yes | Yes | Yes |
| View relationship graphs | Yes | Yes | Yes |
| Browse non-PII rows | No | Yes | Yes |
| View masked PII | No | Yes | Yes |
| Reveal PII after step-up | No | Yes | Yes |
| View blocked secret values | No | No | No |

The API enforces this matrix before calling the worker. The worker independently rejects row commands from `ops_viewer` and never returns a blocked value.

### Column classifications

Every exposed column receives one of four classifications:

- `public`: ordinary operational data displayed directly.
- `internal`: non-PII business or operational data displayed to maintainer/owner.
- `pii`: masked by default and revealable only with an active step-up grant.
- `blocked`: structural metadata is visible, but its value is never selected or returned.

Classification comes from a checked-in policy with exact table/column overrides plus conservative name-pattern rules. A column not covered by the current schema checksum is classified `blocked` until the policy is refreshed. Exact blocked rules take precedence over PII and other rules.

Blocked examples include password hashes/salts, OTP hashes, session tokens, access/refresh tokens, private/encryption keys, encrypted MFA secrets, credential ciphertext, and raw provider secrets. PII examples include phone numbers, email addresses, personal names, addresses, free-form student/teacher content, and raw webhook payloads.

The dedicated browser database roles also lack `SELECT` privileges on blocked columns. Worker masking is therefore not the only boundary.

### PII reveal

`database_pii` is a reusable step-up capability with a ten-minute lifetime, capped by the parent session expiry. A grant is bound to user, session, IP hash, user-agent hash, and target ID. The request requires the account password, a six-digit TOTP, and a reason of 10–500 characters.

The browser never stores the password, TOTP, or a reusable bearer secret. The API keeps the grant binding server-side by session, returns only `expiresAt`, and revalidates the binding for every revealed page. Changing targets, logout, session expiry, or explicit “Hide sensitive data” revokes the active grant.

## 5. Architecture

```text
Browser
  -> Ops API: session, permission, CSRF, reveal grant, validation, audit
    -> authenticated Unix socket
      -> SQL worker target registry
        -> edutrack_production browser-reader pool
        -> ops browser-reader pool
```

The worker owns both database credentials. Each target has its own credential reference, expected database name, expected role, pool, schema cache, and data policy. Targets cannot share a connection or accept a database name supplied by the browser.

The API and worker exchange only target IDs from the closed set `edutrack_production | ops`. There is no command that accepts a connection string, arbitrary database name, or raw SQL.

## 6. Contracts and API

### Core types

```ts
type DatabaseTargetId = 'edutrack_production' | 'ops';
type DatabaseColumnClassification = 'public' | 'internal' | 'pii' | 'blocked';
type DatabaseFilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_null'
  | 'is_not_null';

type DatabaseRowsRequest = {
  targetId: DatabaseTargetId;
  schema: string;
  relation: string;
  pageSize: 25 | 50 | 100;
  cursor?: string;
  sort?: { column: string; direction: 'asc' | 'desc' };
  filters: Array<{ column: string; operator: DatabaseFilterOperator; value?: string }>;
  piiMode: 'masked' | 'revealed';
};
```

`DatabaseRowsResponse` includes column descriptors, JSON-safe row values, a `rowRef` opaque identifier, `nextCursor`, `truncated`, `encodedBytes`, `consistency: 'stable' | 'best_effort'`, and the effective PII mode. Blocked cells contain only `{ state: 'blocked' }`; masked cells contain only `{ state: 'masked', display: string }`.

### HTTP endpoints

```text
GET    /api/v1/database/targets
GET    /api/v1/database/:targetId/schema
POST   /api/v1/database/:targetId/rows/query
POST   /api/v1/database/:targetId/relations/query
POST   /api/v1/database/:targetId/pii-reveal
DELETE /api/v1/database/pii-reveal
```

Row and relation reads use `POST` because filters and opaque cursors are structured JSON; they remain read-only operations but require session CSRF to prevent cross-site triggering of sensitive reads. Responses set `Cache-Control: no-store`.

The browser sends at most five filters. Each value is at most 200 characters. Page size is 25, 50, or 100. Cursors are authenticated opaque payloads no longer than 4 KiB and expire after five minutes.

## 7. Safe query construction

Before SQL construction, the worker resolves the target from its registry and resolves schema, relation, columns, sort, and filters from the cached schema snapshot. SQL identifiers are quoted by a single helper that doubles embedded quotes. Filter values are PostgreSQL parameters; values are never concatenated into SQL.

The worker starts `BEGIN READ ONLY`, sets a 15-second statement timeout and 2-second lock timeout, fetches at most `pageSize + 1` rows, limits the encoded response to 2 MiB, and always rolls back. One page uses one checked-out connection.

Pagination rules:

- Primary key or valid non-null unique index: stable keyset pagination.
- Sort by another column: `(sort column, stable key columns)` keyset ordering.
- Relation without a stable unique key: bounded offset pagination up to 10,000 rows with `consistency: best_effort` and a UI warning.
- A view without a stable unique key follows the same best-effort rule.

Supported filters depend on PostgreSQL type. Text supports equality and contains; numeric/date/time supports equality and comparisons; boolean/enum supports equality; every type supports null checks. Unsupported operator/type combinations are rejected before a query runs.

Large scalar cells are capped at 64 KiB. `bytea` is represented by size and digest, not raw bytes. JSON/arrays remain JSON-safe and open in a bounded detail dialog.

## 8. Schema and relationship model

The target-aware schema snapshot extends existing catalog introspection with:

- target identity and display label;
- relation estimated row count and data-browsing capability;
- primary key and stable pagination key;
- per-column classification and filter operators;
- incoming and outgoing foreign-key edges;
- schema checksum and data-policy version.

PostgreSQL system and temporary schemas remain excluded. Application `_ops` structures may be shown, but policy can mark their row data unavailable. Foreign tables are schema-visible and data-disabled unless explicitly enabled by policy.

The focused graph starts with one relation and its one-hop incoming/outgoing edges. Expansion is client-side over the already-loaded snapshot. The full ERD renders all relations, groups them by schema, supports search, and initially collapses column detail to keep approximately 100 tables usable.

## 9. User experience

The `/database` page has:

1. A permanent read-only badge and target switcher.
2. A searchable schema/relation tree.
3. Tabs for `Dữ liệu`, `Cấu trúc`, `Quan hệ`, and `Toàn bộ ERD`.
4. A bounded, sticky-header data grid with server pagination, sort, filters, cell detail, and FK navigation.
5. A privacy control showing masked/revealed state and reveal countdown.

Switching target or relation clears rows, filters, cursors, selected cells, and graph focus before loading new content. It never carries a cursor or reveal grant across targets.

`ops_viewer` sees structure and graphs but receives an explanatory empty state in the Data tab. Maintainer/owner see masked data by default. Blocked columns remain present in the structure tab with a “Never exposed” badge and appear as blocked columns in the grid without a value.

## 10. Audit and observability

The API appends these actions to the existing hash-chained audit ledger:

- `database.schema_viewed`, rate-limited per actor/target/checksum.
- `database.rows_viewed` for every page, recording target, relation, page size, returned count, filter/sort fingerprints, policy version, and masked/revealed mode.
- `database.pii_reveal_granted` with target, reason, grant ID, and expiry.
- `database.pii_rows_viewed` for every revealed page.
- `database.pii_reveal_revoked` for explicit hide/logout.

Audit metadata never stores filter values, row values, PII, cursor bodies, or SQL. Failures emit stable telemetry codes with request IDs. If audit append fails, row and reveal responses fail closed.

## 11. Error behavior

Stable browser-facing codes include:

- `DATABASE_TARGET_INVALID`
- `DATABASE_TARGET_UNAVAILABLE`
- `DATABASE_SCHEMA_STALE`
- `DATABASE_RELATION_INVALID`
- `DATABASE_COLUMN_INVALID`
- `DATABASE_FILTER_INVALID`
- `DATABASE_CURSOR_INVALID`
- `DATABASE_PAGE_TOO_LARGE`
- `DATABASE_RESULT_TOO_LARGE`
- `DATABASE_DATA_PERMISSION_DENIED`
- `DATABASE_PII_REVEAL_REQUIRED`
- `DATABASE_PII_POLICY_UNAVAILABLE`
- `DATABASE_QUERY_TIMEOUT`

Target failure is isolated: failure of EduTrack Production does not prevent browsing Ops Database schema/history, and failure of Ops Database does not create a fallback path into Production.

## 12. Testing and rollout

Unit and contract tests cover target isolation, identifier quoting, value parameterization, filter/type rules, stable and best-effort pagination, byte/row/cell bounds, masking, blocked-column non-selection, reveal binding, role checks, audit fail-closed behavior, schema drift, and invalid worker responses.

UI tests cover viewer structure-only behavior, target reset, loading/error/empty states, filters, pagination, masked/revealed countdown, blocked cells, FK navigation, focused graph expansion, full-ERD search, keyboard navigation, and accessible table/graph alternatives.

Playwright covers login -> browse both schemas -> masked Production rows -> reveal with MFA/reason -> follow FK -> hide -> confirm viewer cannot fetch rows. A database-level bypass test proves browser-reader roles cannot select blocked columns or mutate either target.

Rollout remains disabled by default. Deployment first provisions and verifies both read-only roles, then enables one target at a time for a named owner, observes query latency/timeouts/audit completeness, and only then enables maintainer access.
