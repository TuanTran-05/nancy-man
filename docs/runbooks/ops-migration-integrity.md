# Ops migration integrity

## Released-source baseline state

The parent of released Ops SHA
`8096aa24bb13f524394b4a5cdb9415ce82ee4004` historically recorded
`migrationBaseline.state` as `not_deployed`. That released SHA records the
subsequent checked-in `captured` baseline: 21 canonical migration IDs and the
recorded SHA-256 digest
`81eeffb7fd077714c30a19682551a64e62cd021c88c1e1628f450179799875fd`.

This is repository evidence of the reviewed baseline transition, not a fresh
database query or an assertion about live production state today. The captured
record remains subject to the exact field, ordering, count, and digest contract
below. Treat any missing or invalid capture as a blocking condition, never as
proof that the PostgreSQL history is empty. A later remediation candidate must
preserve this chronology and must not retroactively describe the released SHA
as formatting-clean.

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

`scripts/consolidation/opsDisposition.mjs --capture` recaptures
the frozen source universe while preserving the reviewed `migrationBaseline` record:
historically the exact `not_deployed` discriminator, and after the approved
baseline transition, the reviewed `captured` state.

### Captured baseline contract

The approved `captured` transition records the live PostgreSQL migration state
with the following exact field and digest contract:
- `state`: `'captured'`
- `evidence`: `{ credentialResolver: 'deployed', legacyRuntime: 'sqlite_web_collector_only', postgresApiPlane: 'deployed' }`
- `ids`: strictly ordered, non-empty list of unique migration IDs matching `^\d{4}_[A-Za-z0-9_]+$`
- `count`: positive integer equal to `ids.length`
- `sha256`: 64-hex SHA-256 digest of the exact newline-terminated sorted IDs (`${ids.join('\n')}\n`)
- `capturedAt`: ISO 8601 UTC timestamp
- `requiredBeforeCutover`: preserves the canonical 4-tuple of cutover requirements

`opsDisposition.mjs --capture` preserves the captured record after this reviewed transition.


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
