# Workstream D Production Safety Remediation Design

**Date:** 2026-08-09

**Status:** Architecture approved on 2026-08-09; awaiting review of this written specification

**Scope:** Workstream D mutation containment, health evidence, maintenance transitions, projection rebuild, smoke probes, retirement controls, operational CLIs, architecture enforcement, and runbook parity

## Decision

The eight verified Workstream D findings will be repaired as staged vertical slices. Each slice starts with a regression that reproduces the unsafe behavior, replaces the incomplete production path, and then passes its focused and cross-slice gates. The order follows the dependency chain: trusted command execution, mutation containment, health evidence, release gating, projection and smoke evidence, retirement, then repository enforcement.

The TypeScript-AST pre-cutover policy will run through `prebuild`. Therefore every `npm run build`, including a Vercel build that honors package lifecycle scripts, must pass `check:student-identity-architecture` before compilation begins.

Existing package command names and runbook flags remain stable. The repair does not execute a production audit, maintenance transition, projection rebuild, smoke run, retirement operation, deployment, or data write.

## Verified failure baseline

| ID | Existing behavior | Required result |
|---|---|---|
| D-F1 | Six operational scripts export parsers or helpers but never initialize Firebase, call their service, write an artifact, or set a failure exit code. Unknown flags exit with code 0. | Every package command reaches a real `main` boundary. Help is read-only, unknown flags fail before Firebase initialization, and write modes require exact target and evidence confirmations. |
| D-F2 | The mutation inventory loses route dimensions such as the finance resource, registered finance actions are classified as unguarded, and the mutation lease has no production caller. | The inventory classifies the complete route key, unknown in-scope writes fail closed, every Firestore business transaction freshly reads maintenance, and external or long work holds an actor-bound lease. |
| D-F3 | Health collection converts source-read failures to empty collections, hardcodes three checks, and can report green when money or projection evidence is false. | Required source failures produce named blockers. All counters and invariants come from real collectors, and each mode has an explicit green policy. |
| D-F4 | The exit gate trusts status strings and accepts empty queue and smoke objects. It does not revalidate the full evidence binding. | One transaction re-reads and validates the active run, target, digests, commit, export, journals, queues, leases, read mode, money, projection evidence, health, smoke completeness, age, and digests before release. |
| D-F5 | Projection rebuild writes version-3 placeholders and omits dashboard and class evidence. Smoke accepts caller-supplied evidence instead of performing probes. | Projection rebuild invokes the existing accounting rebuild and canonical dashboard/class derivations. Smoke executes all ten authenticated read probes and expected-503 mutation probes, then stores immutable evidence. |
| D-F6 | Retirement accepts an arbitrary operation and caller identity, treats any journal as applied, and cannot reach credential deletion through the planner. | Only an operation from an exact approved retirement plan can run. Journal resume checks state and fingerprints. Disabled credential tombstones have a defined eligibility path and irreversible boundary. |
| D-F7 | A health record at an existing `auditId` can be overwritten. | Health runs and date/run markers are create-only. A same-digest retry is idempotent; a different digest creates a conflict record and fails. |
| D-F8 | The architecture command is absent from CI and build lifecycle enforcement, while parity tests inspect names and prose instead of exercising commands. | `prebuild` runs the scanner. Scanner fixtures cover indirect syntax used by the repository, and executable parity tests verify package commands, flags, orchestration, exit codes, and read-only modes. |

## Scope boundary

This remediation changes only Workstream D files and the integration points explicitly assigned to Workstream D by `2026-08-06-student-profile-production-cutover-retirement.md`. Those integration points include shared API route entry points, scheduled jobs, Firestore rules for D evidence collections, `package.json`, the D runbook, and focused tests.

Workstreams A, B, and C remain providers of stable contracts. D may call their maintenance primitive, canonical read control, reference inventory, verifier, accounting rebuild, dashboard aggregate, enrollment model, and reviewed-plan types. D will not change their identity selection, normalization decisions, financial facts, enrollment semantics, or data schemas unless a compile-time adapter is required at a D-owned boundary.

Task 7B fallback removal is outside this pre-cutover repair. Its production code changes remain tied to a separately approved retirement window after the retirement writer has verified field removal. The current work may test the post-retirement policy and verify that retirement blocks while a forbidden reader remains, but it will not delete the compatibility branches now.

Unrelated dirty files, broad refactors, UI changes, and production operations are excluded.

## Safety contract

The repaired implementation must enforce these properties:

1. A command that parses successfully must either perform its documented orchestration or return a nonzero exit code. It cannot silently do nothing.
2. Each script defaults to read-only behavior when invoked without a write verb. A package alias may include its documented write verb, but it still requires exact project and database confirmation before initializing a write adapter.
3. Run-bound writes also require the active run ID, actor, plan digest, approval digest, source commit, export operation, and any prerequisite evidence named by the runbook.
4. A student-linked Firestore transaction reads `_maintenance/student_identity` inside that transaction before its first write. A route-level check is an early rejection, not write authorization.
5. External or multi-transaction work acquires a lease while maintenance is `normal`, heartbeats it while active, and releases it in a `finally` path. Expired active leases remain blockers until reviewed resolution.
6. Missing, unreadable, malformed, stale, incomplete, or digest-invalid evidence fails closed. Empty objects never mean zero or pass.
7. Full reports and evidence records are immutable. Mutable `current` pointers may refer to an immutable record but cannot replace it.
8. A stored `status: "green"` or `status: "pass"` is insufficient. The consumer validates the fields that justify that status.
9. Local and Firestore artifacts contain bounded counts, IDs, reason codes, timestamps, and non-sensitive digests. They exclude credentials, tokens, password material, and raw private profiles.
10. Maintenance release, release-proof creation, `maintenanceLiftedAt`, and generation change occur in one compare-and-set transaction.

## Architecture

### 1. Trusted command runtime

Each operational script exposes a dependency-injected `main(argv, environment, adapters)` and invokes it from a guarded executable entry point. The entry point maps results to process exit codes; services remain importable without process side effects in unit tests.

The common runtime performs the same sequence for all six commands:

```text
argv -> strict parse -> semantic validation -> target confirmation
     -> named Firebase Admin database -> service orchestration
     -> canonical artifact serialization -> optional immutable write
     -> explicit exit code
```

Strict parsing rejects unknown, duplicate, conflicting, and value-less flags. `--help` exits 0 without loading credentials or Firebase. Parse and confirmation failures exit 2. Policy, invariant, probe, target, and operational failures exit 1. A red health report may still be written to the requested local output before `--assert-green` returns 1.

The runtime reuses Workstream C canonical JSON and reviewed-artifact validation where their contracts match. Local output uses an atomic same-directory temporary file and rename, refuses an accidental overwrite unless the command contract explicitly permits an idempotent same-digest retry, and creates no invented default path.

The following scripts receive real entry points:

- `scripts/check-student-identity-health.ts`
- `scripts/set-student-identity-maintenance.ts`
- `scripts/set-canonical-student-read-mode.ts`
- `scripts/rebuild-student-identity-projections.ts`
- `scripts/run-student-identity-smoke.ts`
- `scripts/retire-legacy-student-profiles.ts`

Their existing package aliases remain the operator interface. The implementation plan will add subprocess contract tests for `--help` and an invalid flag, plus dependency-injected orchestration tests for every documented mode.

### 2. Exhaustive mutation containment

Mutation classification uses the complete dispatch identity instead of a flattened action string:

```ts
type StudentIdentityMutationLookup = {
  surface: StudentIdentityMutationSurface;
  resource?: string;
  action: string;
  method: string;
};
```

For example, finance dispatch preserves both `resource: "receipts"` and `action: "create"`; PayOS preserves its handler action and HTTP method. Every registered action is explicitly classified as guarded mutation or read-only. An unclassified write-shaped request under an in-scope route returns `STUDENT_IDENTITY_MUTATION_UNCLASSIFIED` before handler invocation. It cannot fall through as unguarded.

All D-listed API families call the classifier before dispatch. Focused completeness tests derive cases from each route registry so that adding a new action without an inventory entry fails the suite.

Write authorization moves to a transaction wrapper that reads maintenance as the first transactional read and then runs the business callback. Existing services that already use a transaction receive the guard read in that transaction. A multi-transaction or external operation acquires `StudentIdentityMutationLease` in a transaction that races correctly with maintenance entry. PayOS processing, general outbox jobs, receipt notification outbox work, Zalo bulk jobs, and password-reset work use the lease boundary where they can outlive one Firestore transaction or cross an external API.

Maintenance entry first changes the generation and mode to `read_only`, preventing new leases. Drain evidence then records the exact required queue keys, pause watermarks, active lease count, and stale lease count. Missing keys are invalid; they are not normalized to zero.

### 3. Fail-closed health collection

Every health source returns a typed result:

```ts
type HealthSourceResult<T> =
  | { ok: true; value: T; observedAt: string; sourceDigest: string }
  | { ok: false; source: string; code: string; detail: string };
```

Required source failures become sorted `HEALTH_SOURCE_UNAVAILABLE` or `HEALTH_SOURCE_INVALID` blockers. No catch block converts a failed Firestore read to `[]`, `0`, `false`, or `null`.

The service composes read-only providers already owned by A, B, and C:

- Workstream C typed reference inventory and verifier for unknown references, mutable legacy ownership, journal state, operation counts, source drift, and money evidence;
- the accounting source-version-3 audit and full rebuild result for missing, orphan, stale, queued, and failed summaries;
- canonical profiles and open enrollments for dashboard freshness and class roster parity;
- maintenance, read-control, queue, mutation-lease, alias, registry, linked-user, credential, and run records for the remaining counters.

`unknownReferences`, `classRosterCountMismatches`, and `dashboardStale` are derived values with fixtures that make each one nonzero or true. They are never constants.

Mode policy is evaluated from the complete report after all collectors finish. Daily mode allows ordinary pending normal-mode queue work but rejects failed jobs, stale leases, identity/read/auth violations, and stale or incomplete projections. Cutover mode requires exact run binding, `canonical_required`, zero pending queues and leases, zero pending or failed operations, exact money set to true, and complete version-3 projections. Retirement mode adds zero legacy projection fields, verified retirement stages, and preservation evidence for aliases, code registry, run journals, health, smoke, and release records. A cutover or retirement report with `monetaryTotalsMatchReviewedPlan !== true` or `projectionRebuildComplete !== true` is red even when its blocker input was empty.

The digest is recomputed from canonical serialization after blockers are sorted. Report construction rejects sensitive keys and unbounded document payloads.

### 4. Immutable health and evidence repositories

`writeStudentIdentityHealthReport` runs in a transaction. It recomputes the report digest and reads the immutable run document plus the applicable daily or cutover marker.

If no record exists, the transaction creates the full report and marker, then updates the mutable current pointer. If the same ID already stores the same digest, the call succeeds idempotently and returns the existing identity. If either the run record or marker exists with a different digest, the transaction leaves both untouched, creates or reuses a deterministic conflict alert, and returns `STUDENT_IDENTITY_HEALTH_IMMUTABLE_CONFLICT`.

Smoke, projection, drain, retirement verification, rollback verification, and release proof follow the same create-only rule. Each repository verifies that an ID and digest agree with canonical content before persistence. Firestore rules continue denying client writes to all evidence paths.

### 5. Transactional cutover gate

The exit gate loads a typed evidence bundle inside the release transaction. It rejects absent documents, unknown fields where strict schemas apply, empty maps, missing required keys, and non-canonical digests.

For `verified_cutover`, the transaction validates:

- maintenance mode, generation, active run, actor, target, plan and approval digests, source commit, and managed export;
- reviewed normalization run state, planned/applied/verified/failed totals, every journal state, immutable drain evidence, all six queue counts, and active/stale lease counts;
- server read control at `canonical_required`, bound to the same run and digests;
- a green post-apply health record whose detailed counts, money invariant, projection invariant, target, run, commit, export, read mode, digest, and timestamp satisfy cutover policy;
- immutable projection evidence bound to the same inputs with a complete accounting rebuild, zero queued/failed/missing/orphan/stale summaries, a fresh dashboard model, and zero class mismatches;
- immutable smoke evidence created after the read-mode transition and projection rebuild, no older than 60 minutes, containing exactly the ten required read surfaces and the required expected-503 mutation probes, all passing with valid response-shape digests.

`verified_retirement`, `aborted_before_apply`, and `verified_rollback` use discriminated validators and cannot borrow fields or proofs from another exit reason. Retirement requires the verified retirement run and preservation evidence. Abort requires zero applied journals. Rollback requires exact restored counts, before-state and money validation, matching after-fingerprints, and `maintenanceLiftedAt === null`.

Only after validation does the transaction create an immutable release proof, stamp the active run, increment generation, clear the active maintenance fields, and set mode to `normal`. A concurrent change causes the transaction to retry and revalidate.

### 6. Real projection rebuild and smoke execution

`rebuildStudentIdentityProjections` first validates read-only maintenance, active run binding, and `canonical_required`. It delegates accounting work to the existing full summary rebuild path used by `scripts/rebuild-accounting-student-summaries.ts`; it does not create placeholder money documents. Dry-run reports planned rebuild and prune work. Apply performs the existing source-derived rebuild and prunes alias or tombstone summaries only through the approved accounting path.

The same operation recomputes the dashboard model and class counts from canonical profiles and open enrollments through existing B-owned derivations. It compares stored and derived models, writes only D-owned projection evidence, and reports any repair backlog, stale model, or class mismatch. The evidence binds run, target, plan and approval digests, commit, export, read mode, source version, component results, timestamps, and a canonical digest.

`runStudentIdentitySmoke` owns probe execution. Its input names reviewed fixtures and credentials through environment or a secret provider; those values never enter output. An injected HTTP/probe adapter makes tests deterministic, while the production adapter sends authenticated requests to the configured deployment.

The runner executes exactly these read surfaces: `auth`, `profile`, `class_roster`, `attendance`, `wallet`, `receipt`, `invoice`, `payment`, `reporting`, and `realtime_recipients`. The realtime result must be nonempty and equal the canonical enrollment recipient set for its fixture. A versioned `REQUIRED_STUDENT_IDENTITY_MUTATION_PROBES` set contains at least one non-destructive request for every mutation surface in the inventory. The runner executes that exact set and requires status 503 with `STUDENT_IDENTITY_MAINTENANCE` before handler invocation; the exit gate rejects missing, duplicate, or unknown probe IDs.

Every read result records status code, reason code, and a digest of an allowlisted response shape. A missing, duplicate, skipped, unexpected, secret-bearing, or caller-prepopulated result fails the run. Successful evidence is persisted immutably and its ID and digest are attached to the active run.

### 7. Reviewed retirement engine

Retirement uses the Workstream C discriminated `legacy_retirement` run and retirement-only stages. The CLI supports preliminary audit, final audit, approval, apply or resume, and verify. It also provides `--rollback-plan`, `--rollback-approve`, `--rollback-apply`, and `--rollback-verify` for the permitted pre-irreversible rollback path; matching package aliases and runbook commands are added. Each write mode loads a reviewed artifact rather than accepting a free operation object.

The final plan has canonical JSON, `planDigest`, target, commit, managed export, latest health audit, seven daily audit IDs, candidates, blockers, and deterministic operations. Approval adds distinct authorized reviewer records and `approvalDigest`; it does not mutate the plan content covered by `planDigest`.

The writer API receives a reviewed plan and operation ID. It finds the exact operation in that plan, verifies target, active maintenance run, actor, digests, stage, export, source fingerprints, and current reference closure, then executes one exact-fingerprint transaction. Caller-supplied operation content is ignored or rejected.

Journal handling distinguishes `planned`, `applying`, `applied`, `verified`, and `failed`. An existing journal is idempotent only when its plan binding and before/after fingerprints match and the current database state proves the recorded state. A partial operation resumes from its verified boundary. A failed or mismatched journal blocks the run.

Credential state is explicit. An active credential or linked user on a legacy identity remains a blocker. A credential document that Workstream C disabled, detached from every login path, bound to the merge run, and marked as an inaccessible credential tombstone may become a deletion candidate after 30 Vietnam calendar days and seven consecutive immutable green daily audits. Its plan contains metadata and a non-secret fingerprint only.

Profile and projection-field operations remain reversible while their before-images and after-fingerprints are verified. Starting the secret-bearing credential deletion stage writes an immutable irreversible-boundary record and closes automated retirement rollback. The run must then resume or forward-repair under read-only maintenance until verification passes. The engine never deletes aliases, code reservations, merge runs, journals, health/smoke/release evidence, or release history.

Post-retirement verification proves every planned operation, zero legacy projection fields, zero remaining mutable or unknown references, canonical authentication, and preservation counts/digests. The maintenance exit gate consumes that immutable proof. It cannot infer success from the retirement run status alone.

### 8. Architecture and command-parity enforcement

The scanner retains the path, node kind, and normalized AST fingerprint allowlist. Its production discovery covers application code and every Firestore-writing script. Fixtures must cover direct call chains, aliased collection references, fluent query chains, statically resolvable object variables, spreads that introduce forbidden projection fields, and both `students.where("classId", ...)` and `users.where("classId", ...)`. A syntax shape that cannot be classified safely in a known write boundary reports a review-required violation instead of disappearing from the scan.

`package.json` adds:

```json
"prebuild": "npm run check:student-identity-architecture"
```

The existing `check:student-identity-architecture` command remains the pre-cutover policy entry point. The implementation records scanner duration during verification, but the approved decision is to keep it on the build path.

Runbook parity is executable. Tests parse every package command and flag used by `docs/runbooks/canonical-student-profile-cutover.md`, call each command's injected `main` with valid read-only fixtures, and assert the expected service orchestration. Subprocess tests run `--help` and an invalid flag for all six entry points. Write-mode tests prove that a missing or mismatched target, run, digest, commit, export, actor, or prerequisite evidence prevents adapter invocation. Text presence alone is not accepted as parity proof.

## Cutover data flow

```text
reviewed Workstream C run + managed export
  -> maintenance enter transaction
  -> immutable drain evidence with all named queues and leases at zero
  -> Workstream C apply and verify
  -> canonical_preferred to canonical_required compare-and-set
  -> source-derived accounting/dashboard/class rebuild evidence
  -> fail-closed cutover health evidence
  -> ten-surface smoke and expected-503 evidence
  -> one exit transaction revalidates every binding
  -> immutable release proof + maintenance normal
```

Any failure after maintenance entry leaves mode at `read_only`. The operator either fixes and resumes the same reviewed run, uses the approved pre-release rollback path, or records an incident decision. No command translates a failed verification into release permission.

## Retirement data flow

```text
30 calendar days + seven immutable green daily markers
  -> preliminary read-only audit
  -> new managed export + final deterministic retirement plan
  -> role approvals and approval digest
  -> retirement maintenance enter and drain
  -> reversible profile and projection-field stages
  -> irreversible credential-deletion boundary when applicable
  -> exact journal resume and global verification
  -> Task 7B deployment in its separately approved window
  -> post-retirement AST, projections, health, and smoke
  -> verified-retirement exit transaction
```

The current remediation implements and tests the engine but does not perform this operational sequence or Task 7B.

## Error and recovery behavior

All public failures have a stable reason code and bounded context. Expected operator errors do not print stacks by default; unexpected failures include a stack in local stderr but never in persisted evidence. Firebase initialization, source reads, artifact validation, transaction conflicts, HTTP probes, and local writes propagate failure rather than returning empty success values.

Dry-run and read-only commands can be retried. Create-only evidence writes are idempotent only for identical canonical content. Transactional mutation writes and retirement operations resume through their exact journal identity. An unknown after-state, fingerprint drift, or conflicting immutable record requires a new reviewed decision or forward repair; it is never overwritten.

## Test strategy

Every production change follows red-green-refactor. The first test for each finding reproduces the observed unsafe case: invalid CLI flag exits 0, finance create bypasses the guard, failed collection reads produce green health, empty evidence releases maintenance, projection placeholders pass, arbitrary retirement operations apply, a health ID overwrites, or build omits the AST gate. The test must fail for the expected reason before implementation changes.

Unit tests cover parsers, canonical serialization, blocker policy, classifier keys, evidence schemas, digest validation, eligibility, journal states, scanner syntax fixtures, and response redaction. Route tests prove early maintenance rejection and normal delegation. Transaction tests prove fresh maintenance reads, entry-versus-lease races, immutable conflicts, compare-and-set transitions, release atomicity, and retirement resume behavior.

CLI contract tests use spawned `tsx` processes for help and parse failures. Orchestration tests use injected Firebase, filesystem, clock, secret, probe, and service adapters so they can assert exact calls without production access. A local Firestore emulator fixture rehearses the cutover state machine, failure-blocked release, rollback-before-release, post-release rollback rejection, daily-marker conflict, partial retirement resume, irreversible boundary, and preservation checks.

The final D gate runs the focused suites from Task 9, Firestore rules, typecheck, the pre-cutover scanner, `prebuild` through the production build, and `git diff --check`. It also runs the command/runbook parity suite. No test receives production credentials or invokes a deployed endpoint.

## Compatibility and rollout

Package script names from the D plan remain unchanged. Kebab-case CLI values map once at parsing to the existing snake-case persisted values. Existing read-only service exports stay available for focused tests and other D modules.

Tasks 1–4 remain compatible with the already deployed A/B observation-window design. The implementation plan may split large files into D-owned helpers, but it cannot move or rename A/B/C public contracts as cleanup. Route behavior in `normal` mode remains unchanged except that an unclassified in-scope write now fails with a configuration error and emits no business write.

The repair lands as code and local verification only. Production target confirmation is deliberately impossible in automated tests without explicit injected fixtures. Deployment and production cutover require a later operational approval using the exact reviewed artifacts described in the runbook.

## Acceptance criteria

The remediation is complete when all of the following are proven on the final branch:

- All six operational scripts execute their documented service path, reject unknown flags with a nonzero exit, keep help/read-only modes free of Firebase writes, and enforce every documented confirmation before a write adapter runs.
- Inventory completeness includes every registered D mutation route and the finance resource/action dimension; no in-scope write defaults to unguarded.
- Every D-listed business transaction has a focused test for a fresh maintenance read, and every external or long-running D-listed processor has a lease lifecycle test and production call site.
- Health source failures are red, the three formerly hardcoded values are exercised with non-green fixtures, and cutover/retirement cannot be green when money or projection evidence is not true.
- Health runs, daily/cutover markers, drain evidence, projection evidence, smoke evidence, retirement verification, rollback verification, and release proofs are immutable with same-digest idempotency and different-digest conflict behavior.
- The cutover gate rejects missing queue keys, an empty smoke result, any missing smoke surface, stale evidence, a digest mismatch, nonzero pending or failed work, a read-mode mismatch, false money, incomplete projections, wrong target/run/digests/commit/export, and a concurrent generation change.
- Projection apply calls the existing accounting rebuild and canonical dashboard/class derivations, creates no placeholder summary, and persists a bound result with zero backlog required for release.
- Smoke performs all ten reads and the exact versioned mutation-probe set itself; it cannot persist caller-fabricated results or secrets.
- Retirement apply accepts only exact operations from a reviewed plan, resumes only verified journal states, exposes an eligible disabled credential-tombstone path, enforces the irreversible boundary, and preserves aliases, codes, runs, journals, and evidence.
- The scanner detects the required direct and indirect syntax fixtures, `npm run build` invokes it through `prebuild`, and executable parity tests cover every D runbook command and flag.
- Task 7B production fallback removal is unchanged in this repair, and no file outside D or its named integration points is modified.

Required final commands include:

```powershell
npx.cmd vitest run server/api/lib/maintenance/studentIdentityMutationInventory.test.ts server/api/lib/maintenance/studentIdentityMutationLease.test.ts server/api/lib/student/studentIdentityHealthService.test.ts server/api/lib/student/studentIdentityHealthRepository.test.ts server/api/lib/maintenance/studentIdentityCutoverGate.test.ts server/api/lib/maintenance/studentIdentityMaintenance.test.ts server/api/lib/student/canonicalStudentReadControl.test.ts scripts/check-student-identity-health.test.ts scripts/set-student-identity-maintenance.test.ts scripts/set-canonical-student-read-mode.test.ts scripts/rebuild-student-identity-projections.test.ts scripts/run-student-identity-smoke.test.ts scripts/student-profile-retirement scripts/retire-legacy-student-profiles.test.ts scripts/student-identity-architecture.test.ts api/audit/daily-maintenance.test.ts api/audit/outbox-process.test.ts server/api/lib/jobs/outbox.test.ts server/api/zalo/handlers/bulkNotificationJobs.test.ts
npm.cmd run test:rules
npm.cmd run typecheck
npm.cmd run test:student-identity-architecture -- --policy pre-cutover
npm.cmd run build
git diff --check
```

Operational completion evidence such as a production health digest, managed export, maintenance duration, or retirement proof is not fabricated by this code repair. Those records exist only after a separately authorized production run.
