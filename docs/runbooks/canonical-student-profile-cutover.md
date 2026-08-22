# Canonical student profile cutover and retirement

The procedure for normalizing duplicate student profiles in production,
reopening writes, and — thirty days later — deleting what is left.

Read this once end to end before starting anything. The window targets thirty
minutes and must not exceed sixty without an explicit abort or incident
decision, and the decisions that matter are the ones you make before writes are
blocked, not while they are.

## What this is protecting

Fifty-nine student codes exist twice in production. Each pair is one child with
two profile documents, created by a class promotion that cloned the profile
instead of moving the enrollment. Their money is split across the two ids,
their attendance is split, and whichever half an operator opens looks like the
whole story.

Normalizing them means choosing a surviving profile for each pair, moving every
reference to it, and retiring the other. None of that is reversible once writes
reopen, because by then receipts have printed and parents have been told
balances.

## Before you begin

Every one of these must be true. Confirm them, do not assume them.

- Phase 0 discovery complete, with a frozen baseline you can compare against.
- The `admissionSearch*` backfill verified at zero missing.
- Workstreams A, B1, and B2 deployed and observed stable, with the server read
  control at `canonical_preferred`.
- Workstream D Tasks 1–4 deployed: the mutation guard, the health audit, the
  daily streak, and the maintenance gate.
- Workstream C snapshot rehearsal passed on a production-derived export,
  including the `HS260167`, different-code, legacy soft-merge, mixed-timestamp,
  and high-reference fixtures.
- `npm run check:student-identity-architecture` clean.
- `npm run typecheck`, `npm run build:vps`, `npm run test:vps`, and the focused
  suites all passing on the commit you are about to deploy.
- The deployed commit contains no clone-based promotion path.
- Named operator and reviewer identities, and their availability for the whole
  window.

Set the environment first, and assert every variable is non-empty before you
run anything:

```powershell
$runStamp = Get-Date -Format 'yyyyMMddTHHmmss'
$runId = "student-profile-normalization-$runStamp"
$sourceSha = git rev-parse HEAD
$projectId = [string]$env:FIREBASE_PROJECT_ID
$databaseId = [string]$env:FIRESTORE_DATABASE_ID
$bucket = [string]$env:FIREBASE_STORAGE_BUCKET
$migrationActor = [string]$env:STUDENT_PROFILE_MIGRATION_ACTOR_ID
$identityReviewer = [string]$env:STUDENT_PROFILE_IDENTITY_REVIEWER_ID
$financeReviewer = [string]$env:STUDENT_PROFILE_FINANCE_REVIEWER_ID
```

`STUDENT_PROFILE_ROLLBACK_KEY_BASE64` must also exist. Confirm its presence
without printing or copying its value — it is read by the artifact module from
the environment and has no command-line form, because argv is visible in
process listings and shell history.

## 1. Preliminary audit, and the review

```powershell
$preliminaryDir = Join-Path 'scratch' "student-profile-normalization/$runId/preliminary"
npm.cmd run audit:student-profile-normalization -- --run-id $runId --report-dir $preliminaryDir --source-commit $sourceSha
$reviewDecisions = Join-Path $preliminaryDir 'student-profile-review-decisions.json'
```

The preliminary output must say `applyable: false` and contain zero executable
operations. If it does not, stop: something has already decided more than it
should have.

Copy the generated decision template to `$reviewDecisions` and review it
**outside** this document. Reviewing inside an executable plan is how a
decision gets made by whoever is typing rather than whoever is responsible.

Check the candidate and blocker counts, the canonical-selection reason for each
pair, the enrollment/finance/auth evidence, the unknown-reference count, the
expected canonical and physical counts, and the target and commit. Any
unexplained change from the frozen baseline stops the window. Retain the
candidate fingerprints; the final audit binds to them.

## 2. Managed export, then the final manifest

The export is what rollback restores from. Without one completed immediately
before the manifest, there is no rollback at all.

```powershell
$snapshotTime = (Get-Date).ToUniversalTime().AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:00Z')
$snapshotStamp = $snapshotTime.Replace(':', '').Replace('-', '')
$exportUri = "gs://$bucket/student-profile-normalization/$runId/$snapshotStamp"
$exportStartJson = gcloud firestore export $exportUri --snapshot-time=$snapshotTime --async --project=$projectId --database=$databaseId --format=json
$exportStart = $exportStartJson | ConvertFrom-Json
$exportOperationId = [string]$exportStart.name
```

Poll every fifteen seconds with a visible elapsed time:

```powershell
gcloud firestore operations describe $exportOperationId --project=$projectId --database=$databaseId --format=json
```

Stop immediately on an operation error, a target mismatch, a snapshot mismatch,
or an output URI mismatch. Never sleep past the sixty-minute incident limit.
Persist the final JSON beside the report.

If any observed source update time is later than `$snapshotTime`, discard the
final artifact and take a new run-specific export. This check is never waived:
an export taken before a write it does not contain restores a database that
never existed.

```powershell
$finalDir = Join-Path 'scratch' "student-profile-normalization/$runId/final"
$rollbackArtifact = Join-Path $finalDir 'student-profile-rollback-before-images.enc'
npm.cmd run audit:student-profile-normalization:final -- --run-id $runId --report-dir $finalDir --source-commit $sourceSha --review-decisions $reviewDecisions --export-operation $exportOperationId --export-uri $exportUri --rollback-artifact $rollbackArtifact

$finalPlan = Join-Path $finalDir 'student-profile-plan.json'
$finalPlanJson = Get-Content -Raw -LiteralPath $finalPlan | ConvertFrom-Json
$planDigest = [string]$finalPlanJson.planDigest
$identityApprovedPlan = Join-Path $finalDir 'student-profile-approved-identity.json'
$reviewedPlan = Join-Path $finalDir 'student-profile-reviewed.json'
npm.cmd run approve:student-profile-normalization -- --plan $finalPlan --approval-role identity_technical --reviewer-id $identityReviewer --confirm-plan-digest $planDigest --output $identityApprovedPlan
npm.cmd run approve:student-profile-normalization -- --plan $identityApprovedPlan --approval-role finance --reviewer-id $financeReviewer --confirm-plan-digest $planDigest --output $reviewedPlan
$reviewedPlanJson = Get-Content -Raw -LiteralPath $reviewedPlan | ConvertFrom-Json
$approvalDigest = [string]$reviewedPlanJson.approvalDigest
```

If the final plan declares auth or security approval required, run the same
command with `--approval-role auth_security` and a distinct authorized reviewer
before assigning `$reviewedPlan`. Approval never receives `--review-decisions`:
the person approving must not also be the person deciding.

Recheck `applyable: true`, the required roles, the artifact digest, the
operation and money totals, the project and database, the commit, the export,
`planDigest`, and `approvalDigest`.

Register the reviewed run as create-only control metadata. This is the record
the maintenance gate binds to; it does not change student business data.

```powershell
npm.cmd run prepare:student-profile-normalization -- --reviewed-plan $reviewedPlan --rollback-artifact $rollbackArtifact --confirm-plan-digest $planDigest --confirm-approval-digest $approvalDigest --confirm-project $projectId --confirm-database $databaseId --confirm-commit $sourceSha --confirm-export $exportOperationId --actor-id $migrationActor
```

## 3. Enter maintenance and drain the queues

```powershell
$maintenanceBefore = Join-Path $finalDir 'student-identity-maintenance-before.json'
npm.cmd run maintenance:student-identity -- --show --output $maintenanceBefore
$maintenanceGeneration = [int](Get-Content -Raw -LiteralPath $maintenanceBefore | ConvertFrom-Json).generation
npm.cmd run maintenance:student-identity -- --enter --expected-generation $maintenanceGeneration --run-id $runId --actor-id $migrationActor --plan-digest $planDigest --approval-digest $approvalDigest --source-commit $sourceSha --export-operation-id $exportOperationId --confirm-project-id $projectId --confirm-database-id $databaseId

$maintenanceActive = Join-Path $finalDir 'student-identity-maintenance-active.json'
npm.cmd run maintenance:student-identity -- --show --output $maintenanceActive
$activeGeneration = [int](Get-Content -Raw -LiteralPath $maintenanceActive | ConvertFrom-Json).generation

$drainEvidence = Join-Path $finalDir 'student-identity-drain-evidence.json'
npm.cmd run maintenance:student-identity -- --verify-drain --expected-generation $activeGeneration --run-id $runId --actor-id $migrationActor --plan-digest $planDigest --approval-digest $approvalDigest --output $drainEvidence
```

Then confirm by hand, not by assumption:

- A representative mutation on each route family returns
  `503 STUDENT_IDENTITY_MAINTENANCE`.
- Reads still work. They are supposed to; parents and teachers are still using
  the system.
- The active run and actor in the control document match yours.
- Every named queue is paused and drained to zero: `outbox_jobs`,
  `accounting_finance_outbox`, receipt notification outbox, Zalo bulk jobs,
  PayOS processors, password-reset work.
- Active and stale mutation leases are both zero.

A stale lease is **not** something to clear. It means a heartbeat stopped while
external work may still be running — a Zalo batch mid-send, a PayOS reconcile
that has read the provider's ledger and not yet written ours. Resolve it with
the team that owns that job, or abort the window.

## 4. Apply

```powershell
$applyDir = Join-Path 'scratch' "student-profile-normalization/$runId/apply"
npm.cmd run apply:student-profile-normalization -- --reviewed-plan $reviewedPlan --rollback-artifact $rollbackArtifact --confirm-plan-digest $planDigest --confirm-approval-digest $approvalDigest --confirm-project $projectId --confirm-database $databaseId --confirm-commit $sourceSha --confirm-export $exportOperationId --actor-id $migrationActor --drain-evidence $drainEvidence --report-dir $applyDir
```

If preflight aborts with an applied count of zero, exit through
`--reason aborted-before-apply` and nothing else. If **any** operation applied,
keep maintenance held and go to verification — the abort path is not available
any more, and using it would lift the window over half-applied work.

## 5. Verify, switch reads, rebuild, and prove it

```powershell
npm.cmd run verify:student-profile-normalization -- --reviewed-plan $reviewedPlan --confirm-plan-digest $planDigest --confirm-approval-digest $approvalDigest --confirm-project $projectId --confirm-database $databaseId --run-id $runId

$readModeState = Join-Path $applyDir 'canonical-read-mode-before.json'
npm.cmd run transition:canonical-student-read-mode -- --show --output $readModeState
$readModeJson = Get-Content -Raw -LiteralPath $readModeState | ConvertFrom-Json
$readModeGeneration = [int]$readModeJson.generation
npm.cmd run transition:canonical-student-read-mode -- --from canonical-preferred --to canonical-required --expected-generation $readModeGeneration --run-id $runId --actor-id $migrationActor --plan-digest $planDigest --approval-digest $approvalDigest --confirm-project-id $projectId --confirm-database-id $databaseId

$projectionEvidence = Join-Path $applyDir 'student-identity-projection-evidence.json'
npm.cmd run repair:student-identity-projections -- --run-id $runId --output $projectionEvidence
$projectionEvidenceJson = Get-Content -Raw -LiteralPath $projectionEvidence | ConvertFrom-Json
$projectionRebuildEvidenceId = [string]$projectionEvidenceJson.evidenceId

$healthEvidence = Join-Path $applyDir 'health/student-identity-health.json'
npm.cmd run verify:student-identity-cutover -- --write --run-id $runId --plan-digest $planDigest --approval-digest $approvalDigest --export-operation-id $exportOperationId --confirm-project-id $projectId --confirm-database-id $databaseId --output $healthEvidence

$smokeEvidence = Join-Path $applyDir 'student-identity-smoke-evidence.json'
npm.cmd run smoke:student-identity -- --run-id $runId --projection-evidence $projectionEvidence --output $smokeEvidence

$healthJson = Get-Content -Raw -LiteralPath $healthEvidence | ConvertFrom-Json
$healthAuditId = [string]$healthJson.auditId
$healthDigest = [string]$healthJson.digest
$smokeJson = Get-Content -Raw -LiteralPath $smokeEvidence | ConvertFrom-Json
$smokeEvidenceId = [string]$smokeJson.evidenceId
```

The order is not arbitrary. Reads switch before the rebuild, because rebuilding
under the old read mode writes the old answer back into the projection and
calls it repaired. Smoke runs after both, because probes taken earlier tested a
system that no longer exists.

All ten read surfaces must pass, including `realtime_recipients`. That one
exists because a regression in recipient resolution produces an empty list with
no error and no failed job — every other failure in this program is loud, and
that one is silent. Every expected-503 mutation probe must also pass: a write
that succeeded during the window means the guard is not holding, and everything
verified before it is in doubt.

Confirm the parsed ids and digests are non-empty and match the active run.

## 6. Release

```powershell
$maintenanceBeforeExit = Join-Path $applyDir 'student-identity-maintenance-before-exit.json'
npm.cmd run maintenance:student-identity -- --show --output $maintenanceBeforeExit
$exitGeneration = [int](Get-Content -Raw -LiteralPath $maintenanceBeforeExit | ConvertFrom-Json).generation
npm.cmd run maintenance:student-identity -- --exit --expected-generation $exitGeneration --reason verified-cutover --run-id $runId --actor-id $migrationActor --health-audit-id $healthAuditId --health-digest $healthDigest --smoke-evidence-id $smokeEvidenceId --projection-rebuild-evidence-id $projectionRebuildEvidenceId --confirm-project-id $projectId --confirm-database-id $databaseId
```

Only the server exit gate can do this. Its single transaction revalidates every
piece of evidence, writes the release proof, stamps `maintenanceLiftedAt`, and
restores normal mode in the same commit — so there is no moment in which writes
are open while the rollback window is still notionally available.

Read the release proof back and record its id and digest.

## 7. The rollback boundary

Rollback is available **only** while maintenance is read-only and
`maintenanceLiftedAt` is still null.

```powershell
$rollbackPlan = Join-Path $applyDir 'student-profile-rollback-plan.json'
$rollbackReviewedTechnical = Join-Path $applyDir 'student-profile-rollback-approved-technical.json'
$rollbackReviewed = Join-Path $applyDir 'student-profile-rollback-reviewed.json'
npm.cmd run plan:student-profile-normalization-rollback -- --reviewed-plan $reviewedPlan --confirm-plan-digest $planDigest --confirm-approval-digest $approvalDigest --confirm-project $projectId --confirm-database $databaseId --run-id $runId --output $rollbackPlan
$rollbackPlanJson = Get-Content -Raw -LiteralPath $rollbackPlan | ConvertFrom-Json
$rollbackDigest = [string]$rollbackPlanJson.rollbackDigest
npm.cmd run approve:student-profile-normalization-rollback -- --rollback-plan-file $rollbackPlan --approval-role rollback_technical --reviewer-id $identityReviewer --confirm-rollback-digest $rollbackDigest --output $rollbackReviewedTechnical
npm.cmd run approve:student-profile-normalization-rollback -- --rollback-plan-file $rollbackReviewedTechnical --approval-role rollback_finance --reviewer-id $financeReviewer --confirm-rollback-digest $rollbackDigest --output $rollbackReviewed
npm.cmd run apply:student-profile-normalization-rollback -- --reviewed-rollback $rollbackReviewed --rollback-artifact $rollbackArtifact --confirm-rollback-digest $rollbackDigest --confirm-project $projectId --confirm-database $databaseId --run-id $runId --actor-id $migrationActor
```

If the read mode was already switched, restore the recorded pre-cutover mode
through the audited transition CLI as part of rollback verification. Then exit
with `--reason verified-rollback`.

After any successful exit, rollback is prohibited outright. The world has seen
the new data: receipts printed, messages sent, a parent told a balance.
Recovery from there is a new forward-repair run using the aliases, journals,
and export evidence — not a restore.

## 8. Thirty days, then retirement

Wait for thirty calendar days in `Asia/Ho_Chi_Minh` **and** seven consecutive
green daily audits ending on the review date. Waiting is not enough on its own:
the daily audit must have produced real immutable records for each of those
days. A missing day is a day nobody checked.

Then, in a fresh window:

1. New managed export and a new `legacy_retirement` run.
2. Enter read-only maintenance.
3. `npm run audit:student-profile-retirement` — read-only, produced before the
   export and marked `applyable: false`, so it is something to argue with
   rather than something to run. Review it, then
   `npm run audit:student-profile-retirement:final`, which additionally
   requires `--source-commit` and `--export-operation-id` and is the only
   output the role approvals will accept.
4. `npm run retire:student-profile-tombstones` — resumable under the same run;
   an interruption re-verifies fingerprints and continues, and never starts a
   new run or releases writes.
5. Deploy the Task 7B fallback removal **while writes are still blocked**.
6. `npm run test:student-identity-architecture -- --policy post-retirement`.
7. Rebuild projections, run retirement health, run automated smoke.
8. `npm run verify:student-profile-retirement`.
9. Exit with `--reason verified-retirement`.

Before step 5, confirm the retirement-readiness check passes. Retirement
deletes `users.classId`, and a query still reading it returns an empty
recipient set rather than an error — assignment delivery would stop with no
alert at all. That check is a blocker for the window, not a formality.

The exit evidence must explicitly show `legacyProjectionFieldsRemaining === 0`
and that the aliases, code registry, merge runs and journals, audit records,
and release history all survive. Those are how an old receipt still resolves to
the right child years from now, and how the center can explain its own history.
