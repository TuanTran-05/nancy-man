# VPS cutover continuation (2026-08-19)

> Superseded on 2026-08-20. Production is already running PostgreSQL with 19
> migrations. Do not switch back to this release, reload Firebase data, or resume
> the partial shard list below. Continue with
> `docs/runbooks/vps-postgres-post-cutover-stabilization.md`.

Goal
- Continue from release: `/srv/edutrack/releases/20260819-p0-vps-test-01`
- Do not switch `/srv/edutrack/current`
- Do not restart `pm2` or `nginx`
- No local heavy tests

Pre-check on VPS host
1. Confirm lockout state:
   - No other operator is running release/pm2 changes.
   - `APP_COMMIT_SHA` in `shared/.env` matches the release you will validate.
   - `NODE_ENV=production`, `DATABASE_URL` points to staging/isolated DB.
   - `GLOBAL_WRITE_FREEZE` / payment hooks are in intended temporary mode.
2. Enter release directory:
   - `cd /srv/edutrack/releases/20260819-p0-vps-test-01`

Gate on release source
1. `git status --short`
2. `git rev-parse --short HEAD`
3. `git log -1 --oneline`
4. `npm ci`
5. `npm run typecheck`
6. `npm run test:vps`

Full Vitest remaining shards (no full-suite aggregation from partial runs)
Use same sharding pattern as earlier (20 shards total):
- `npx vitest run --shard=7/20`
- `npx vitest run --shard=8/20`
- ...
- `npx vitest run --shard=20/20`

All shard outputs must be captured and attached.

Artifact validation on this release
1. `npm run build:vps`
2. `npm run smoke:vps-build`
3. `bash db/run-migrations.sh --dry-run`
4. `bash db/run-migrations.sh`
5. `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify-schema.sql`

Parity and data validation
1. If not already loaded: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/data.sql`
2. `npm run db:materialize-documents`
3. `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify-data.sql`
4. `npm run db:check`
5. `npm run db:parity:audit-log -- <firebase-database-id> <start-date> <end-date>`
6. `npm run db:parity:operational -- <firebase-database-id>`

Restore drill (isolated restore target only, never production)
1. `AGE_IDENTITY_FILE=/secure/path/identity.txt bash deploy/vps/restore-postgres-drill.sh <backup>.dump.age '<isolated-target-database-url>'`
2. Verify verify scripts against isolate target:
   - `psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify-schema.sql`
   - `psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/verify-data.sql`

Smoke/integration evidence
- Admin/office/accounting/teacher/student/parent login smoke (if creds ready):
  - session, login/logout, guarded routes, file upload/download, billing endpoints.

Finalization
- If all commands pass, prepare final evidence bundle.
- Set `CUTOVER_SHA` to release commit after remaining P0 are on remote branch.
- Record `Go/No-Go` and rollback evidence timestamps.
