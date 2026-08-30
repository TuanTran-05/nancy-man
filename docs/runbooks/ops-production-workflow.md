# Immutable Ops release workflow

This runbook prepares a candidate beside the active release. It does not authorize a production cutover: use only in an approved change window with a named operator and rollback decision.

## Prepare

Build and verify the canonical commit in an isolated workspace. The verified build root must contain `.edutrack-ops-build.json` with exactly its full `gitSha` and `treeSha`, root/workspace package metadata and lockfile, the required application `dist` outputs, package `dist` outputs when present, and `packages/db/migrations`. It must not contain source-only paths, environment files, credentials, shared data, databases, dumps, logs, backups, symlinks, or hardlinks.

Run:

```bash
deploy/ops/prepare-release.sh <40-character-git-sha> <verified-build-dir>
```

The command accepts only a full commit reachable from the checked-out canonical repository. It creates `/srv/edutrack-ops/releases/<sha>` and never reads or changes `current`, installed configuration, services, credentials, or databases. The release includes only the approved package metadata/lockfile, built application/package artifacts, exact migrations, and reviewed Ops deploy assets. `.release-source.json` binds the full commit SHA, commit tree SHA, and the deterministic manifest digest.

The manifest covers all release files except exactly `.release-manifest.json` and `.release-source.json`; those names are explicitly self-excluded so the marker can bind the completed manifest without a recursive digest. Verify a prepared release with:

```bash
node deploy/ops/release-manifest.mjs verify /srv/edutrack-ops/releases/<sha>
```

An existing target is a hard failure. Do not replace, edit, or reuse it.

## Activate

After the approved candidate checks pass, run:

```bash
deploy/ops/activate-release.sh <40-character-git-sha>
```

Activation completes marker, manifest, runtime, systemd, and Nginx syntax preflights before changing configuration or `current`. It snapshots the exact prior checked unit and vhost state, then stops and confirms the web/collector SQLite-writer cohort inactive before installing only the checked unit and vhost filenames. It reloads systemd metadata, replaces `current` by renaming a temporary symlink created under the same release root, restarts migration, API, SQL worker, processor, and notifier, then starts web and collector before reloading Nginx.

On any post-mutation failure, the command stops every candidate-attempted service, restores the prior pointer (or no pointer), exact prior configuration bytes/modes/absence, daemon metadata, prior active services, and prior Nginx configuration. A failed rollback action emits `RELEASE_ROLLBACK_FAILED` together with the primary failure and exits nonzero. A missing previous pointer is treated as no rollback target; a previous pointer outside `releases/` is rejected before any pointer change. Preserve both release directories for diagnosis and follow the approved rollback/cutover policy; this command does not delete releases or operational data.

After the final Nginx reload has succeeded, a failure to remove only the bounded transaction snapshot is non-fatal: the command emits `RELEASE_ACTIVATION_CLEANUP_WARNING artifact=edutrack-ops-activate.<suffix>` followed by `RELEASE_ACTIVATED ... cleanup_warning=transaction_snapshot_retained` and exits zero. This means the candidate pointer, configuration, processes, and Nginx configuration remain active. The artifact is a root-owned `0700` directory directly under `/tmp`, containing only prior unit/vhost snapshots. Before removing it, the approved operator/cutover caller must verify its fixed `/tmp` parent, exact emitted basename, root ownership, `0700` mode, and snapshot-only contents; remove only that exact verified directory (never a glob), then journal the cleanup result. Any failure before the successful final Nginx reload remains an activation failure and follows the rollback transaction above.

The scripts emit only release identifiers, safe status codes, and bounded paths. Never pass environment values, credentials, database URLs, or data through their arguments or logs.

## Test boundary

Automated tests may set the release test mode only with an explicit temporary root matching `/tmp/edutrack-ops-release-test-*`. The root and test command stubs must be non-symlink descendants of that fixture root. Production mode has fixed deployment destinations and rejects every test override. Do not use test mode for a production operation.
