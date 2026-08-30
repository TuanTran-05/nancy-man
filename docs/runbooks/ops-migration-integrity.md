# Ops migration integrity

## Current production-baseline state

The consolidation input record currently declares `migrationBaseline.state` as
`not_deployed`. This is a discriminated state, not an empty PostgreSQL
migration history: the live legacy Ops plane is SQLite web/collector only, and
there is no deployed canonical Ops PostgreSQL API/migration service or
credential resolver.

The record intentionally contains no PostgreSQL migration IDs, count, or
digest. Treat a missing capture as a blocking condition, never as proof that
the PostgreSQL history is empty.

## Mandatory cutover preflight

Before a canonical Ops PostgreSQL cutover, an operator must:

1. Deploy the canonical Ops PostgreSQL endpoint and its dedicated,
   credential-resolved migration identity.
2. Use that identity's systemd credential boundary to execute one read-only,
   sorted `migration_id` capture from `ops_schema_migrations`.
3. Validate each returned identifier, then persist only the sorted identifier
   list, its count, and a SHA-256 digest of newline-terminated IDs. Never
   print or store a database URL, credential, or arbitrary database row.
4. Compare the captured history with the release's exact migration manifest.
   Abort the cutover if credential resolution/capture is unavailable, an ID is
   unknown, a predecessor is missing, or a checksum differs.

Until those steps produce a real metadata capture, cutover is fail-closed.

`scripts/consolidation/opsDisposition.mjs --capture` currently recaptures
only the frozen source universe and preserves the exact existing
`not_deployed` discriminator. It must not turn that state into empty or
invented capture data. Once the endpoint exists, an approved follow-up must
introduce a reviewed `captured` baseline state with the authenticated ID list,
count, and digest before this capture command is allowed to transition the
record.

## Runner behavior

`migrateOpsDatabase` runs only under the explicit outer advisory lock held by
the migration CLI. It creates the `checksum char(64)` column additively when
needed, validates all recorded migration IDs against the ordered canonical
manifest, backfills a null checksum only for a recognized exact migration,
and then makes the column non-null.

Each newly applied canonical SQL migration and its `(migration_id, checksum)`
record are committed in the same transaction. The runner rejects unknown IDs,
checksum mismatches, and missing predecessors before it executes any new
canonical migration SQL.

## Stop conditions

Do not edit historical SQL files to make a database history appear valid. On
any validation failure, stop migration/cutover work, preserve the existing
runtime and data, and investigate the independently captured metadata before
an approved remediation plan is made.
