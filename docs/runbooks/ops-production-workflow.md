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

Activation verifies the marker, complete manifest, required runtime files, exact systemd assets, and the candidate Nginx syntax before changing `current`. It installs only the checked unit and vhost filenames, reloads systemd metadata, and replaces `current` by renaming a temporary symlink created under the same release root. It then restarts migration, API, SQL worker, processor, notifier, web, and collector in that order before reloading Nginx.

If a service restart fails, the command atomically restores only the previously resolved release pointer and exits nonzero. A missing previous pointer is treated as no rollback target; a previous pointer outside `releases/` is rejected before any pointer change. Preserve both release directories for diagnosis and follow the approved rollback/cutover policy; this command does not delete releases or operational data.

The scripts emit only release identifiers, safe status codes, and bounded paths. Never pass environment values, credentials, database URLs, or data through their arguments or logs.

## Test boundary

Automated tests may set the release test mode only with an explicit temporary root matching `/tmp/edutrack-ops-release-test-*`. The root and test command stubs must be non-symlink descendants of that fixture root. Production mode has fixed deployment destinations and rejects every test override. Do not use test mode for a production operation.
