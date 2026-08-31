# Variables build and redeploy

`build_redeploy` is enabled only after the compatible EduTrack release-tooling
commit and the injected-failure drill are recorded. The agent resolves repository,
release, staging, executable, argument, and health descriptors from the root-owned
manifest. Browser input supplies only change/run IDs.

The builder reads the active release's verified clean source SHA, creates a detached
temporary worktree beneath the manifest build root, and passes a mode `0600`
minimal build environment containing only catalog entries that are both
`sensitivity: public` and `buildAllowed: true`. A `VITE_` prefix alone is never an
authorization. Scan the bundle before activation.

The source identity remains `APP_COMMIT_SHA=<40-character SHA>`. Configuration
identity is separate: `APP_RELEASE_ID=<sha>-cfg-<digest>` and
`APP_CONFIG_DIGEST=<digest>`. Activate only after build, bundle scan, local
readiness, public HTTPS smoke, and release identity checks pass. Keep the previous
release until successful health completion; on any failure restore it and the
source snapshot automatically.

Cleanup accepts only the exact recorded temporary worktree under the approved root.
Do not run a build from a mutable developer checkout and do not inspect or record
the generated environment, bundle matches, or process environment.
