# Ops Variables and Access Management Design

**Status:** Approved on 2026-08-31.

**Primary host:** `man.thienuy.edu.vn`

**Design surfaces:** `/variables`, `/users`, `/bootstrap/mfa`

**Related Superdesign targets:** `/variables` and `/users` in `.superdesign/resume.json`

## 1. Purpose

Extend the existing Thien Uy Ops Console with two connected capabilities:

1. **Variables** inventories the active application configuration on the VPS, shows every authorized operator the complete variable name and value, explains which app and function consume it, and safely stages, validates, applies, health-checks, and rolls back changes.
2. **User administration** lets the current owner, `tuan.dev`, create Ops accounts, issue one-time enrollment links, assign roles, lock access, recover a locked account through re-enrollment, and permanently revoke an account.

The work also completes the migration of the monitoring dashboard from its legacy SQLite login to the canonical PostgreSQL-backed `/api/v1` authentication system.

The Variables feature is intentionally not a generic root shell, file editor, process explorer, or host-wide environment viewer. It is an allowlisted configuration control plane for known applications and known active configuration sources.

## 2. Approved decisions

- Only active application configuration is inventoried. Backups of configuration files, Linux/system variables, transient shell variables, and PM2 internal variables are excluded.
- Variable names and values are displayed in full after a password-and-TOTP step-up. Values are not masked or truncated in the unlocked workspace.
- Variables are grouped and filterable by application and functional category, with a clear description of what each variable does.
- All **active Ops accounts**, regardless of `ops_viewer`, `ops_maintainer`, or `ops_owner` role, may read, stage, edit, delete optional variables, and apply configuration changes. This is deliberate because Ops account creation itself is the authorization gate.
- Only `ops_owner` may create, change, lock, recover, or revoke Ops accounts.
- `tuan.dev` becomes the canonical `ops_owner`. `ops-admin` is enrolled as `ops_maintainer` before legacy auth is removed.
- New accounts default to `ops_maintainer`; an owner may deliberately choose `ops_viewer` or `ops_owner`.
- Required variables cannot be deleted in the UI, API, or privileged agent. Optional variables may be deleted. Unknown variables are read-only until classified in the catalog.
- A change follows `Draft -> Validate -> Save -> Apply -> Health-check -> Completed`. Any failed apply automatically starts rollback.
- Changes with build-time effects, including Vite `VITE_*` variables, rebuild and redeploy from the currently active Git SHA in an isolated clean build directory.
- The privileged implementation is a local **Config Agent** reached through a Unix socket. The public Ops API never gains unrestricted root filesystem or process-control privileges.
- Values are never written to Ops PostgreSQL, audit events, application logs, metrics, traces, URLs, or error payloads.
- Encrypted staged values and encrypted rollback snapshots live only in the agent-owned state directory and expire automatically.
- Account creation returns a single-use HTTPS enrollment link that expires after 24 hours. The new user sets their own password and enrolls TOTP.
- Lock is reversible only through fresh enrollment. Revoke is terminal and cannot be undone.
- An owner cannot lock or revoke their own current account, and the final active owner cannot be demoted, locked, or revoked.
- The canonical PostgreSQL authentication system replaces the legacy SQLite login; the two authentication systems are not bridged by copying or trusting legacy sessions.

## 3. Scope and non-scope

### In scope

- Canonical Ops login, session, CSRF, role, account status, enrollment, and TOTP flows for the whole Ops web application.
- Owner-only account list, creation, role assignment, one-time enrollment links, lock, recovery, revoke, and audit history.
- Active-variable discovery from explicitly registered application sources.
- Full value display after step-up, application/function classification, source and consumer metadata, effective-value precedence, and apply-impact labeling.
- Drafted edits and optional deletes; conflict detection; validation; encrypted staging; apply; restart, next-job, credential restart, or rebuild/redeploy; health checks; automatic rollback.
- Read-only rollout first, followed by guarded mutation and apply phases.
- Audit metadata and operational status that never contain a value or reversible value fragment.
- Migration of `tuan.dev` and `ops-admin` before the legacy login is retired.

### Out of scope

- Arbitrary browsing or editing of `/etc`, `/srv`, home directories, or the process environment.
- Linux OS variables, SSH configuration, sudoers, Nginx configuration, firewall rules, kernel parameters, package configuration, or unrelated service configuration.
- PM2-generated/internal variables and ephemeral values inherited from an administrator shell.
- Old `.env` copies, deployment backups, release archives, rollback snapshots, or any non-active source.
- A generic secret manager, secret sharing system, or external secret synchronization product.
- Editing a variable whose source, parser, consumer, or apply behavior is unknown.
- Executing browser-supplied commands, paths, service names, scripts, health-check URLs, or shell fragments.
- Automatically emailing enrollment links. Phase one displays the link once for the owner to copy through an approved communication channel.
- Automatically undoing external side effects already produced with an old configuration, such as a payment or notification already sent.

Active configuration used by a backup job remains in scope; backup **copies of configuration files** do not.

## 4. Current-state constraints

### 4.1 Authentication split

The current host has two authentication domains:

- `/api/v1/**` reaches the canonical Ops API on `127.0.0.1:3100`, backed by PostgreSQL and the `__Host-ops-session` cookie.
- `/api/**` and the monitoring UI reach the legacy web process on `127.0.0.1:3101`, backed by SQLite and the `__Host-ops_session` cookie.

The React monitoring UI is currently a single-page component without a route structure. Canonical auth already models the roles `ops_viewer`, `ops_maintainer`, and `ops_owner`, and the account states `pending_mfa`, `active`, `locked`, and `revoked`.

The legacy SQLite account store currently contains `tuan.dev` and `ops-admin`, but it has no equivalent role model. A legacy cookie must never be accepted as proof of canonical identity.

### 4.2 Active configuration sources

The initial allowlisted inventory is:

| Application | Active source | Consumer | Source adapter | Apply behavior |
|---|---|---|---|---|
| EduTrack Platform | `/srv/edutrack/shared/.env` | PM2 application process, jobs, and Vite build | `node_env_file` | Runtime restart, next job, or build/redeploy by catalog entry |
| EduTrack PM2 declarations | `/srv/edutrack/current/deploy/vps/ecosystem.config.cjs` | PM2 application process | `pm2_ecosystem_static` | Observe explicit `env` entries and precedence; change through a reviewed code release |
| Ops Console API | `/etc/edutrack-ops/api.env` | `ops-api.service` | `systemd_environment_file` | Restart affected unit |
| Ops Console Web | `/etc/edutrack-ops/web.env` | `ops-web.service` and Vite build | `systemd_environment_file` | Restart or build/redeploy by catalog entry |
| Ops Collector | `/etc/edutrack-ops/collector.env` | collector service | `systemd_environment_file` | Restart affected unit |
| Ops SQL Worker | `/etc/edutrack-ops/sql-worker.env` | `ops-sql-worker.service` | `systemd_environment_file` | Restart affected unit |
| Ops credentials | `/etc/edutrack-ops/credentials/*` | Explicit systemd credential mappings | `systemd_credential_file` | Restart only declared consumers |
| Beszel Hub | `/etc/beszel/hub/hub.env` | Beszel Hub service | `dotenv` | Restart affected unit |
| Beszel Agent | `/etc/beszel/agent/agent.env` | Beszel Agent service | `dotenv` | Restart affected unit |
| Thien Uy Website | None | Static files | `none` | Displayed as zero runtime variables |

The agent reads these sources with the privileges needed for their existing ownership and mode. The unprivileged web/API processes do not receive broader read access.

EduTrack currently starts Node with `--env-file=/srv/edutrack/shared/.env`, while PM2 explicitly supplies `NODE_ENV`, `HOST`, and `PORT` from the active release's ecosystem file. These are application declarations, not PM2-generated internal variables, so they appear in inventory and precedence details. They are release-managed/read-only in this feature because editing code inside an active release would break release immutability. Inline PM2 values can take precedence, so duplicate names must be displayed as separate definitions with the effective definition identified. Node documents the `--env-file` precedence behavior in the [Node CLI reference](https://nodejs.org/api/cli.html), while PM2 describes its injected environment in the [PM2 environment documentation](https://pm2.keymetrics.io/docs/usage/environment/).

Vite replaces `VITE_*` values at build time and exposes them in the client bundle. These values are therefore treated as public build inputs and require a rebuild/redeploy, consistent with the [Vite environment-variable documentation](https://vite.dev/guide/env-and-mode.html).

## 5. Target architecture

```text
Browser
  │ HTTPS + canonical session + CSRF
  │ password + TOTP step-up for values/apply/account mutation
  ▼
Ops Web ───────────────► Ops API /api/v1
                             │
                 ┌───────────┴────────────┐
                 │                        │
                 ▼                        ▼
        Ops PostgreSQL              Unix socket
   users, metadata, audit     fixed versioned protocol
                                          │
                                          ▼
                                  Privileged Config Agent
                           ┌──────────────┼───────────────┐
                           ▼              ▼               ▼
                     env/credentials   PM2/systemd   release builder
                           │              │               │
                           └──────────────┴───────┬───────┘
                                                ▼
                                      health-check + rollback
```

### 5.1 New deployable components

- `apps/config-agent`: local privileged daemon with no public TCP listener.
- `packages/config-contracts`: shared request/response types, enums, limits, and schema validators for the API-agent boundary.
- `apps/api/src/modules/variables`: inventory, step-up enforcement, draft metadata, orchestration, and audit integration.
- `apps/api/src/modules/accounts`: owner-only account lifecycle and enrollment-link management.
- `apps/web/src/web/pages/VariablesPage.tsx`: approved Variables workspace.
- `apps/web/src/web/pages/UsersPage.tsx`: approved owner-only account workspace.
- `config/variables/catalog.yaml`: version-controlled metadata with no values.
- `/etc/edutrack-config-agent/manifest.yaml`: root-owned deployed allowlist of source IDs, exact paths, expected owners/modes, adapters, consumers, actions, and health-check IDs.

The manifest is generated/reviewed from version-controlled deployment inputs and installed by deployment automation. It is never writable through the browser.

### 5.2 Config Agent isolation

- Socket: `/run/edutrack-config-agent/agent.sock`.
- The socket is owned by a dedicated group containing only the canonical Ops API service account.
- The agent runs under systemd with a private temporary directory, a strict filesystem view, an explicit `ReadWritePaths` allowlist, restricted address families, bounded resources, and no interactive shell.
- The agent uses library/process APIs with fixed arguments. It never evaluates a shell string.
- Browser/API input selects stable IDs only: `sourceId`, `variableName`, `changeId`, `actionId`, and `healthCheckId`.
- Paths, unit names, PM2 app names, commands, release roots, and URLs are resolved only from the root-owned manifest.
- The agent rejects path traversal, symlinks, changed ownership/mode, unexpected hard links, oversized files, unsupported encodings, duplicate ambiguous definitions, and manifest drift.
- Protocol requests are size-limited, schema-validated, correlated, and bound to an authenticated API caller identity. Protocol responses never contain diagnostic dumps of process environments.

## 6. Authorization and step-up

### 6.1 Capability matrix

| Capability | Viewer | Maintainer | Owner |
|---|---:|---:|---:|
| Enter Variables after password+TOTP | Yes | Yes | Yes |
| Read full values | Yes | Yes | Yes |
| Create/edit draft | Yes | Yes | Yes |
| Delete optional variable | Yes | Yes | Yes |
| Validate/save/apply | Yes | Yes | Yes |
| View configuration audit metadata | Yes | Yes | Yes |
| List and create Ops users | No | No | Yes |
| Change role, lock, recover, revoke | No | No | Yes |

Existing permissions for errors, incidents, SQL, recovery, and other Ops modules remain unchanged.

### 6.2 Variables secret capability

Opening `/variables` presents a step-up screen even when the user already has an authenticated Ops session. The user must submit:

- Their current password.
- A current TOTP code from an active factor.

On success, the API creates a server-side `variables_secret` capability bound to user, session, IP hash, user-agent hash, and a random nonce. It lasts 10 minutes and cannot outlive the parent session. No reusable bearer token is exposed to JavaScript.

While unlocked:

- API responses use `Cache-Control: no-store, private` and `Pragma: no-cache`.
- Values live only in React memory and rendered DOM.
- Values never enter local storage, session storage, IndexedDB, service-worker caches, query persistence, analytics, replay tools, telemetry, or error payloads.
- The Variables route has a strict CSP with no third-party scripts and `connect-src 'self'`.
- Clicking **Khóa giá trị**, logging out, losing session validity, changing route, or capability expiry clears the in-memory inventory and removes values from the DOM.
- A background tab does not silently refresh the capability.

Every Apply requires an explicit confirmation step. A password-and-TOTP reauthentication creates a one-use `variables_apply` authorization bound to the saved change and its current digest. It expires after five minutes and is consumed whether Apply succeeds or fails. This prevents an unattended unlocked page from applying changes.

Account mutations use the same pattern with an `accounts_write` step-up. They cannot reuse a Variables apply authorization.

## 7. Account lifecycle

### 7.1 Account creation

Only an active owner with a recent `accounts_write` step-up may create an account.

Required input:

- Unique username.
- Display name.
- Unique email.
- Role, defaulting to `ops_maintainer`.

The server creates a `pending_mfa` user and a random enrollment token. Only a keyed hash of the token is stored. The clear token appears once in an HTTPS URL under `/bootstrap/mfa`, expires after 24 hours, and is invalidated on first successful enrollment, account lock, revoke, replacement-link generation, or expiry.

The enrolling user sets a password and enrolls TOTP in one transaction. The account becomes `active` only after both the password credential and TOTP factor are valid. Failure leaves the account non-active and does not create a session.

### 7.2 Lock and recovery

An owner-initiated administrative lock is reversible but immediately:

- Changes the account to `locked`.
- Revokes all sessions, MFA/login challenges, step-up grants, and pending enrollment tokens.
- Prevents login and use of any previously issued token.

**Khôi phục truy cập** does not simply flip the status back to active. It creates a new one-time 24-hour enrollment link, supersedes the previous password credential, requires a new password and TOTP, and moves the account through `pending_mfa` before it can become active again.

Administrative lock is distinct from the existing automatic failed-login cooldown. The current implementation changes the account to `locked` with a 30-minute `locked_until`; this must be separated during implementation so the meanings cannot be confused:

- A rate-limit/security cooldown uses a dedicated `login_blocked_until` (or equivalent throttle record), expires automatically, and does not require re-enrollment.
- An owner-initiated administrative lock uses terminal-until-recovered account state, has no automatic expiry, revokes sessions, and requires the recovery enrollment flow above.

The Users page and audit reason code always identify which kind of restriction is active.

### 7.3 Permanent revoke

Revoke requires:

- A fresh owner `accounts_write` step-up.
- Exact typing of the target username.
- A second server-side check that the actor is not the target and that another active owner remains when the target is an owner.

Revoke immediately invalidates all access and changes the account to terminal `revoked`. A revoked record cannot be reactivated; its username and identity record remain reserved so audit history cannot be confused with a later account. A replacement person receives a new account identity.

### 7.4 Owner invariants

- An owner cannot lock, revoke, or demote their current account.
- The last active owner cannot be locked, revoked, or demoted.
- Creating or promoting another owner is allowed only after an explicit least-privilege warning and fresh owner step-up.
- All invariants are enforced in a PostgreSQL transaction and repeated at the API service boundary; disabled UI controls are informational only.

## 8. Variable catalog and inventory

### 8.1 Catalog ownership

The catalog contains metadata, never values. Each known definition declares:

```yaml
id: edutrack.database_url
name: DATABASE_URL
appId: edutrack-platform
sourceId: edutrack.shared_env
consumerIds: [edutrack-web, scheduled-jobs]
category: database
description: Primary application PostgreSQL connection
sensitivity: secret
requirement: required
mutability: managed
applyStrategy: runtime_restart
validatorId: postgres_url
```

Initial functional categories are:

- Database.
- Authentication and security.
- Payments.
- Storage.
- Integrations.
- Telemetry.
- Backup jobs.
- Feature flags.
- Email and notifications.
- Runtime and networking.
- Build/public frontend.

Initial sensitivity levels are `public`, `internal`, and `secret`. Sensitivity affects UI warnings, audit policy, and build eligibility; it does not cause masked display after a successful step-up.

Requirement is one of:

- `required`: editable, never deletable.
- `optional`: editable and deletable.
- `unknown`: discovered but absent from the catalog; read-only.

Mutability is independent of requirement:

- `managed`: may be edited through Variables; delete still depends on requirement.
- `observed`: known and fully displayed but read-only because it belongs to an immutable release or needs a coordinated code/infrastructure change.

The explicit PM2 ecosystem declarations are initially `observed`. PM2-generated/internal variables remain excluded entirely.

### 8.2 Inventory record

Every displayed definition contains:

- Full `name` and full active `value`.
- `appId`, display app name, and consuming service/job/build IDs.
- Source ID, authorized path label, and source adapter.
- Functional category and human description.
- Sensitivity and requirement.
- Apply strategy and expected effect.
- Related or duplicate definitions.
- Effective/non-effective precedence status.
- Source content fingerprint.
- Value fingerprint for change/audit comparison.
- Source modification time when reliable.
- Last Ops actor/change ID when the latest write was made through this system.

Definitions with the same name are not collapsed. Each source appears separately, and the effective definition is calculated from the declared runtime precedence. Deleting an optional higher-precedence definition must warn when it exposes a lower-precedence value.

Fingerprints exposed to the API, browser, PostgreSQL, or audit are keyed digests, not raw hashes:

```text
source_fingerprint = HMAC-SHA-256(agent_fingerprint_key, source_id || exact_source_bytes)
value_fingerprint  = HMAC-SHA-256(agent_fingerprint_key, catalog_id || exact_value_bytes)
change_digest      = HMAC-SHA-256(agent_fingerprint_key, canonical_validated_patch)
```

The versioned fingerprint key is agent-only and separate from staging/snapshot encryption keys. This prevents offline dictionary checks against short booleans, ports, IDs, or other low-entropy values. The agent may use an internal unexposed content hash for efficient comparison.

### 8.3 Source adapters

Adapters parse and serialize according to the actual consumer:

- `node_env_file` follows Node dotenv/`--env-file` syntax.
- `systemd_environment_file` follows systemd EnvironmentFile quoting and escaping.
- `systemd_credential_file` treats each manifest-declared credential file as an opaque UTF-8 or binary-safe value according to its catalog type.
- `dotenv` follows the declared Beszel-compatible syntax.
- `pm2_ecosystem_static` parses only the literal `env` object in the allowlisted ecosystem file and is observation-only.

Serialization preserves comments, ordering, unrelated definitions, line endings, file owner/group, and file mode. Only selected definitions change. A parser must round-trip an unchanged fixture byte-for-byte before that adapter is enabled for writes.

### 8.4 Coverage and catalog generation

“All project variables” is proven by a repeatable, value-free coverage job rather than an assumed hand-written list. For every deployed application it combines:

- Names found in allowlisted active sources.
- Static consumer references such as `process.env`, `import.meta.env`, environment validation lists, systemd credential/environment declarations, PM2 literal `env`, and scheduled-job launch configuration.
- Manual catalog metadata for description, category, sensitivity, requirement, mutability, validator, precedence, and apply strategy.

The report has four explicit sets:

- Active source definitions that are cataloged.
- Active source definitions that are unknown and therefore read-only.
- Required consumer references missing from active sources.
- Catalog entries no longer referenced or active.

The job scans names and relationships only and must never print or persist values. Read-only rollout is accepted only after every active definition appears in either the cataloged or explicit unknown set, and every required missing reference has been resolved or approved as a known disabled feature.

## 9. Draft, validation, and save

### 9.1 Change grouping

A change may contain several related items and several sources, but all items must belong to one declared application change group. Cross-application changes use separate changes so that health, rollback, and locking remain deterministic.

Each edit/delete request includes the source fingerprint observed when the inventory was loaded. The API records only metadata and fingerprints, then sends the value-bearing patch to the agent over the Unix socket.

### 9.2 Validation layers

Validation runs without modifying the active source:

1. API schema, length, encoding, and operation validation.
2. Authorization and secret/apply capability validation.
3. Catalog validation: known variable, source, requirement, consumer, validator, and strategy.
4. Current source fingerprint comparison.
5. Source parser and round-trip validation.
6. Per-variable validator, such as URL, integer range, enum, JSON, key/certificate structure, or non-empty constraint.
7. Cross-variable rules, such as paired credentials and mutually required endpoints.
8. Application-level validation in a fixed manifest-declared validator process with a minimal environment.
9. Build-public check for any value entering a client bundle.
10. Impact plan generation listing exact restart, job, credential, or redeploy actions.

An external fingerprint mismatch returns `409 CONFIG_SOURCE_CHANGED`. There is no force-overwrite action. The operator must reload, inspect the new active value, and deliberately restage.

### 9.3 Encrypted save

Save creates an encrypted staged envelope under the agent-owned directory:

`/var/lib/edutrack-config-agent/staged/<change-id>.enc`

The envelope contains the validated patch, source fingerprints, catalog/manifest versions, change digest, and expiry. It is protected with authenticated encryption using an agent-only, versioned staging key supplied as a systemd credential. The snapshot key, staging key, and fingerprint key are separate. Directory mode is `0700`; files are `0600`. Drafts expire after 24 hours and are deleted by a scheduled cleanup; confidentiality does not depend on filesystem block overwrite because the retained bytes are ciphertext under a rotatable key.

Ops PostgreSQL stores only:

- Change ID, actor, app, state, reason, timestamps, and expiry.
- Variable/source IDs and operation type.
- Old/new value fingerprints and source fingerprints.
- Catalog/manifest versions and impact plan.
- Agent envelope identifier and non-secret digest.

The clear old or new value is never stored in PostgreSQL.

## 10. Apply transaction

### 10.1 State machine

```text
DRAFT
  -> VALIDATING -> INVALID | READY
READY
  -> SAVED
SAVED
  -> APPLYING
       -> SNAPSHOTTED
       -> WRITTEN
       -> ACTION_RUNNING
       -> HEALTH_CHECKING
       -> COMPLETED
       -> ROLLING_BACK -> ROLLED_BACK
                       -> ROLLBACK_FAILED
```

Terminal states are `INVALID`, `COMPLETED`, `ROLLED_BACK`, `ROLLBACK_FAILED`, `EXPIRED`, and `CANCELLED`. State transitions are monotonic and idempotent. The same change ID cannot launch two applies.

### 10.2 Locks and preconditions

- The API acquires a PostgreSQL advisory/application lock for the application change group.
- The agent acquires a filesystem lock for every affected source and action group.
- Only one Apply may run per application.
- The agent reloads the staged envelope and verifies its digest, expiry, catalog version, manifest version, and every active source fingerprint.
- Apply stops before writing if any precondition changed.

### 10.3 Snapshot and atomic write

Before the first write, the agent creates an encrypted snapshot containing exact source bytes, file metadata, active release identity, and process/service state. Snapshots are retained for 30 days.

For each source, the agent:

1. Opens the allowlisted parent and target without following symlinks.
2. Verifies expected type, device, ownership, group, mode, and hard-link count.
3. Writes the complete new content to a sibling temporary file.
4. Applies the original owner/group/mode.
5. `fsync`s the temporary file.
6. Atomically renames it over the target.
7. `fsync`s the parent directory.
8. Reopens, reparses, and verifies the expected content fingerprint.

Partial multi-source writes immediately enter rollback.

### 10.4 Apply strategies

| Strategy | Use | Action | Success evidence |
|---|---|---|---|
| `no_runtime_action` | Consumer reads value per request | Atomic write only | Parser and application-specific probe |
| `next_job` | Cron/job reads source at launch | Atomic write; do not restart unrelated services | Parser/validator success and next-run annotation |
| `runtime_restart` | Node/PM2/systemd process reads at startup | Exact allowlisted restart/reload | Process active plus readiness/synthetic probe |
| `credential_restart` | systemd credential consumer | Exact allowlisted unit restart | Unit active plus credential-aware readiness probe |
| `build_redeploy` | Vite/build-time or release-bound value | Isolated build, release activation, process reload | Build, release, readiness, and public smoke checks |

The catalog selects the strategy. The browser cannot override it.

### 10.5 Build and redeploy

For `build_redeploy`:

- The builder starts from the Git SHA of the currently active release, never the mutable working tree.
- It creates an isolated clean build directory and verifies there are no untracked or modified source inputs.
- Only catalog entries marked `public` and `buildAllowed: true` enter a frontend build. Secret/internal values are denied even if their name begins with `VITE_`.
- The build receives a minimal deterministic environment rather than the agent or API process environment.
- A bundle scan rejects known secret fingerprints and disallowed configuration names.
- The release identity is `<git-sha>-cfg-<config-digest>`. Existing release parsing that assumes a bare 40-character SHA must be updated before this strategy is enabled.
- `APP_COMMIT_SHA` remains the exact 40-character source SHA for source maps and source correlation. A separate `APP_RELEASE_ID` and `APP_CONFIG_DIGEST` represent the configuration-derived release.
- Activation uses the normal atomic release switch, then the exact PM2/systemd reload declared by the manifest.
- The previous release remains available until health checks complete and snapshot retention is established.

### 10.6 Health checks

Every action has manifest-declared checks with fixed targets and timeouts:

- Process/unit is active and stable for a minimum observation window.
- Local readiness endpoint succeeds.
- Public HTTPS smoke endpoint succeeds when applicable.
- The active release reports the expected release ID/config digest without exposing values.
- Critical downstream dependency probes succeed when safe and non-mutating.
- The Config Agent and Ops API remain healthy.

No health URL or command is accepted from the browser. A `next_job` change is explicitly reported as “takes effect on next run”; it does not claim execution before that job runs.

### 10.7 Automatic rollback

Any write, action, timeout, or health failure starts rollback automatically:

1. Restore exact source bytes and metadata atomically from the encrypted snapshot.
2. Restore the previous release link when a release changed.
3. Repeat the required restart/reload action.
4. Run the rollback health-check set.
5. Record `ROLLED_BACK` when the previous state is healthy.

If rollback or rollback health fails:

- Record `ROLLBACK_FAILED` with non-secret diagnostics.
- Block subsequent applies for the application until an owner acknowledges and clears the incident after remediation.
- Create a Critical Ops incident and alert through configured channels.
- Preserve snapshot and staged evidence beyond normal cleanup until the incident is resolved.

## 11. API contracts

Exact route naming may be adjusted to match repository conventions, but the capability boundaries are fixed.

### 11.1 Authentication and step-up

- `POST /api/v1/auth/variables/unlock` — current password + TOTP; creates 10-minute secret capability.
- `DELETE /api/v1/auth/variables/unlock` — explicitly locks values and revokes the capability.
- `POST /api/v1/auth/variables/apply-authorization` — password + TOTP + change digest; creates one-use apply authorization.
- `POST /api/v1/auth/accounts/authorization` — owner password + TOTP; creates one-use/short-lived account mutation authorization.

All mutation routes require the canonical session, strict Origin validation, CSRF, and the matching server-side capability.

### 11.2 Variables

- `GET /api/v1/variables` — unlocked active inventory with full values.
- `GET /api/v1/variables/catalog` — non-value filters and descriptions.
- `POST /api/v1/config-changes` — create metadata record.
- `PUT /api/v1/config-changes/:changeId/items` — replace staged item set in agent storage.
- `POST /api/v1/config-changes/:changeId/validate` — validate and return impact plan.
- `POST /api/v1/config-changes/:changeId/save` — seal encrypted staged envelope.
- `POST /api/v1/config-changes/:changeId/apply` — consume apply authorization and begin transaction.
- `GET /api/v1/config-changes/:changeId` — value-free status.
- `GET /api/v1/config-changes/:changeId/events` — SSE progress with value-free events.
- `DELETE /api/v1/config-changes/:changeId` — cancel an unapplied draft and remove staged envelope.

No value appears in a path, query string, SSE event, or redirect.

### 11.3 Users

- `GET /api/v1/users` — owner-only account list and non-secret status metadata.
- `POST /api/v1/users` — create pending user and return enrollment link once.
- `PATCH /api/v1/users/:userId/role` — change role subject to owner invariants.
- `POST /api/v1/users/:userId/lock` — lock and revoke access.
- `POST /api/v1/users/:userId/recover` — issue new recovery enrollment link once.
- `POST /api/v1/users/:userId/revoke` — terminal revoke with exact username confirmation.

Enrollment and recovery responses are `no-store`; clear tokens are not returned on later GET requests.

### 11.4 Config Agent protocol

The versioned Unix-socket protocol exposes only fixed operations:

- `inventory.read`
- `change.validate`
- `change.save`
- `change.apply`
- `change.cancel`
- `change.status`
- `application.clearApplyBlock`

Requests carry the API-generated actor/audit context, but the agent independently resolves sources/actions and verifies the manifest. Unknown fields and protocol versions fail closed.

## 12. Persistence and audit

### 12.1 PostgreSQL metadata

New/extended tables include:

- `ops_secret_elevations`: capability type, user/session binding, digest binding, expiry, consumed/revoked timestamps.
- `ops_config_changes`: actor, application, reason, state, digest, impact plan, catalog/manifest versions, timestamps, envelope ID.
- `ops_config_change_items`: source/variable IDs, operation, requirement, strategy, old/new value fingerprints; no values.
- `ops_config_runs`: state transitions, action IDs, health summaries, snapshot reference, rollback result.
- `ops_config_application_blocks`: application apply block following rollback failure.
- `ops_account_events`: creation, role change, lock, recovery enrollment, revoke, and invariant rejection.

Existing `ops_users`, sessions, password credentials, MFA factors, enrollment tokens, and the append-only Ops audit chain remain canonical.

### 12.2 Audit events

At minimum, audit:

- Variables unlock success/failure/expiry/manual lock.
- Inventory read, including actor, app/source IDs, and count, never names plus values as a combined payload.
- Draft creation/update/cancel/expire.
- Validation outcome and rule IDs.
- Save and staged-envelope expiry.
- Apply authorization success/failure.
- Every apply transition, action, health result, rollback, and rollback failure.
- Account list, create, enrollment-link generation, role change, lock, recovery, revoke, and rejected self/last-owner operations.
- Agent manifest/catalog version mismatch and external source conflicts.

Audit fields use variable IDs and one-way fingerprints. They never contain raw values, clear enrollment tokens, current passwords, TOTP codes, credential file bytes, or reversible prefixes/suffixes.

### 12.3 Logging and telemetry rules

- Request/response logging is disabled or field-redacted for all value-bearing and enrollment routes.
- Error helpers receive typed reason codes, not request bodies.
- Traces contain route templates, change IDs, states, timing, and result codes only.
- Metrics use low-cardinality app/action/result labels; variable names and source paths are not metric labels.
- Agent stdout/stderr is structured and value-free.
- Crash handlers must not dump environments or request objects.

## 13. User experience

### 13.1 Navigation

The existing shell gains:

- `Tổng quan`
- `Variables`
- `Người dùng` for owners; non-owners may receive a hidden link and still get `403` if they request the route directly.

The web app gains a real route structure while retaining the current dark navy/cyan/mint design system.

### 13.2 Variables workspace

After step-up, the page shows:

- Full name and value with safe wrapping and no ellipsis.
- App and functional filters.
- Source, consumer, description, sensitivity, requirement, effective precedence, and apply-impact badges.
- Edit action for known variables.
- Delete action only for optional variables.
- Read-only explanation for unknown variables.
- A staged-change panel, validation result, external-change warning, impact plan, Apply confirmation, live progress, and rollback result.
- A visible capability countdown and **Khóa giá trị** action.

Long values grow/wrap rather than silently truncate. Usability controls such as copy may exist, but copy actions do not bypass step-up or caching rules.

### 13.3 Users workspace

The owner page shows:

- Username, display name, email, role, account status, MFA state, creation time, and last login.
- Active, pending MFA, locked, and revoked terminal states.
- Owner-protection reason in the current/last-owner row.
- New-user form and one-time enrollment result.
- Reversible lock and recovery-through-re-enrollment language.
- High-friction permanent revoke confirmation with exact username input.
- Recent account access/audit events.

The approved visual state is stored as the `/users` Superdesign target.

## 14. Canonical-auth migration

Migration must preserve an available recovery path while avoiding a dual-trust system.

### Phase A — prepare canonical accounts

1. Deploy account-management APIs and owner invariants behind host-local/feature-gated access.
2. Create canonical `tuan.dev` as `ops_owner` through an offline bootstrap/enrollment flow.
3. Enroll a new password and TOTP; do not copy the legacy SQLite password/session.
4. Create and enroll canonical `ops-admin` as `ops_maintainer`.
5. Verify canonical login, logout, CSRF, expiry, lockout, owner recovery, and audit.

The old login remains available during this phase only as an operational fallback.

### Phase B — move the monitoring UI

1. Add web routes and migrate browser calls to canonical `/api/v1` endpoints.
2. Move existing monitoring operations into the canonical Ops API, or temporarily call the legacy monitoring backend through an internal loopback adapter authenticated by the Ops API.
3. The compatibility adapter accepts no public browser cookie. The Ops API performs canonical session, role, Origin, CSRF, and audit checks before an internal request.
4. Smoke-test the dashboard as both canonical accounts.

### Phase C — cut over Nginx

1. Route all browser API traffic through `/api/v1`.
2. Stop accepting `__Host-ops_session` as authentication.
3. Remove public `/api/**` legacy-auth behavior or return a migration-safe error.
4. Retain the legacy SQLite file read-only for a short rollback window, inaccessible to application auth.
5. After the rollback window and verified canonical recovery, archive/delete it through a separate approved operational task.

Rollback before Phase C completion restores the previous Nginx/UI release. Rollback after canonical accounts have been used never restores trust in a copied canonical session; users log in again.

## 15. Delivery phases

### Phase 1 — identity and web shell

- Canonical login for the whole dashboard.
- Route structure and owner-aware navigation.
- `tuan.dev` owner and `ops-admin` maintainer enrollment.
- User create/list/lock/recover/revoke with audit.
- Legacy auth cutover after smoke tests.

### Phase 2 — read-only Variables

- Config Agent and root-owned manifest.
- Source adapters and catalog.
- Full inventory behind password+TOTP step-up.
- App/function/source/impact metadata and duplicate precedence.
- No edit/save/apply endpoint enabled.

### Phase 3 — staged edits

- Draft/edit/optional-delete UI.
- Conflict and validation pipeline.
- Encrypted 24-hour staging.
- Audit metadata and cancellation/expiry.
- Apply remains disabled until adapter round-trip and failure tests pass.

### Phase 4 — runtime and job apply

- Atomic writes, encrypted snapshots, app locks.
- `no_runtime_action`, `next_job`, `runtime_restart`, and `credential_restart` strategies.
- Health-check, automatic rollback, Critical incident on rollback failure.

### Phase 5 — build/redeploy

- Clean-SHA isolated builder.
- Public-build allowlist and bundle secret scan.
- Config-digest release identity and required release-script changes.
- Release activation, smoke checks, and previous-release rollback.

Each phase has a separate feature flag and can be disabled without weakening canonical account security.

## 16. Failure behavior

| Failure | Required behavior |
|---|---|
| Step-up password/TOTP invalid | No inventory/value response; rate-limit and audit failure without credential data |
| Capability expires while page is open | Clear values from browser memory/DOM and return to locked screen |
| Source changed outside Ops | Return conflict; never overwrite; require reload/restage |
| Required delete requested | Reject in UI, API, and agent |
| Unknown edit requested | Reject until cataloged and deployed |
| Parser/validator fails | Active source unchanged; draft remains fixable |
| Agent unavailable | Active app unchanged; report control-plane degraded state |
| Atomic write/action fails | Restore snapshot and health-check previous state |
| New health check fails | Automatic rollback |
| Rollback health fails | Block application applies, create Critical incident, retain evidence |
| Apply caller disconnects | Server/agent continues transaction; status is resumable by change ID |
| API restarts during apply | Reconcile from agent status and idempotent change/run IDs |
| Enrollment link reused/expired | Reject generically; do not disclose account state |
| Owner targets self/last owner | Transaction rejects; sessions and role remain unchanged |

## 17. Testing strategy

### 17.1 Unit tests

- Role/capability matrix and owner invariants.
- Enrollment token hashing, expiry, single use, and replacement.
- Step-up binding, expiry, one-use apply authorization, and parent-session revocation.
- Catalog/schema parsing and cross-variable rules.
- Every source adapter against valid, quoted, multiline, duplicate, Unicode, malformed, and round-trip fixtures.
- Precedence calculation and delete-exposes-lower-value warning.
- Change and apply state-machine transition/idempotency rules.
- Audit/error sanitizers proving values and tokens cannot enter structured output.

### 17.2 Integration tests

- API with PostgreSQL for account lifecycle, locks, transactions, and audit.
- API-agent protocol over a test Unix socket with strict schema/version/size rejection.
- Agent against an isolated fixture filesystem with expected modes and owners.
- External edit between inventory, save, and apply.
- Symlink, hard-link, traversal, ownership/mode drift, and manifest-tampering attempts.
- Simulated PM2/systemd action success, timeout, crash, and health failure.
- Multi-source partial-write failure and rollback.
- API/agent restart and state reconciliation during Apply.

### 17.3 Build/redeploy tests

- Build uses the active Git SHA and rejects dirty source.
- Only public allowlisted values enter the build environment.
- Secret/internal variables and known secret fingerprints fail bundle scanning.
- Release ID accepts `<git-sha>-cfg-<config-digest>` throughout deployment tooling.
- Failed readiness/public smoke restores the prior release and source snapshot.

### 17.4 Browser and security tests

- Canonical session/CSRF/Origin enforcement on every mutation.
- Non-owner receives `403` from user APIs even if UI controls are forged.
- Values never persist in Web Storage, IndexedDB, service workers, URL/history, logs, telemetry, or error reports.
- Route change, lock, expiry, logout, and session revoke remove values from the DOM and query cache.
- XSS payloads in names/descriptions/values render only as text.
- CSP blocks third-party script and network exfiltration from sensitive routes.
- Enrollment URL is displayed once, never cached, and absent from later account responses.

### 17.5 VPS drills

- Read every registered active source and compare inventory to the consumer definition without printing values to test output.
- Apply and roll back a harmless runtime variable in a sandbox service.
- Inject restart failure and health-check failure.
- Inject rollback failure and verify Critical incident/application block.
- Complete a Vite public-variable rebuild from a clean SHA and roll back release.
- Complete canonical auth cutover and Nginx rollback rehearsal.

## 18. Acceptance criteria

The feature is complete only when:

1. `tuan.dev` is an active canonical owner with fresh password and TOTP; `ops-admin` is an active canonical maintainer.
2. The dashboard no longer trusts the legacy SQLite cookie.
3. Every active Ops account can enter Variables only after password+TOTP and then see complete active names/values.
4. Inventory covers every allowlisted active source, identifies app/function/source/consumer/effect, and shows duplicates/effective precedence correctly.
5. Coverage reports account for every active definition and required consumer reference; explicit PM2 declarations appear as observed while PM2-generated internals remain excluded.
6. Required deletes and unknown/observed edits fail independently in UI, API, and agent.
7. External source changes cannot be overwritten through a stale draft.
8. Values and enrollment tokens are absent from PostgreSQL, audit, logs, metrics, traces, URLs, and persisted browser storage.
9. Runtime/systemd/job changes apply with the declared action and health evidence.
10. Vite/build-time changes rebuild from the active clean Git SHA and activate a config-digest release while preserving the exact `APP_COMMIT_SHA`.
11. Every injected apply failure rolls back automatically; every injected rollback failure creates a Critical incident and blocks further applies.
12. Only an owner can administer users; self/last-owner protection holds under concurrent requests.
13. New, recovered, administratively locked, rate-limited, and revoked account lifecycles behave exactly as specified without conflating lock types.
14. Read-only mode can be enabled independently, and every mutation/apply strategy has its own server-side rollout gate.

## 19. Operational documentation required before write enablement

- Config Agent installation, manifest deployment, and recovery runbook.
- Catalog change review checklist.
- Variables apply and rollback operator guide.
- Rollback-failed incident runbook and application unblock procedure.
- Canonical auth cutover/rollback runbook.
- Owner loss and offline additional-owner bootstrap procedure.
- Enrollment-link handling guidance.
- Snapshot/staged-envelope key rotation and retention cleanup procedure.

No mutation rollout flag may be enabled until the corresponding runbook and failure drill are complete.
