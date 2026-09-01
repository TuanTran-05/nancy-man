# Ops Variables and Access Management Program Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coordinate the approved canonical authentication, user administration, read-only Variables inventory, guarded mutation, rollback, and configuration-derived redeploy work without creating a dual-trust login or prematurely granting write privileges.

**Architecture:** Deliver three dependency-ordered implementation plans. Canonical PostgreSQL auth owns all browser identity first; a privilege-separated read-only Config Agent then proves exhaustive active-variable inventory; mutation/apply capabilities are added last behind independently controlled flags and failure-drill gates.

**Tech Stack:** Node.js 22.22+, TypeScript 5.8, Express 5, React 19, PostgreSQL, Zod, Unix sockets, systemd, PM2, Nginx, Git worktrees, Vitest, Testing Library, Playwright.

**Approved spec:** `docs/superpowers/specs/2026-08-31-ops-variables-access-management-design.md`

## Implementation Plans

1. `docs/superpowers/plans/2026-08-31-ops-canonical-auth-user-management.md`
   - Canonical PostgreSQL session for the whole browser app.
   - `tuan.dev` owner and `ops-admin` maintainer enrollment/cutover.
   - Owner-only create, role, lock, recovery, and permanent revoke.
   - Reusable/one-use step-up capability infrastructure.
   - Legacy SQLite login retirement with a narrow internal monitoring adapter.
2. `docs/superpowers/plans/2026-08-31-ops-variables-readonly-config-agent.md`
   - Root-owned source manifest and value-free catalog/coverage gate.
   - Hardened read-only Config Agent over authenticated Unix socket.
   - Consumer-specific adapters, duplicate/effective precedence, keyed fingerprints.
   - Password+TOTP Variables unlock for every active Ops role.
   - Approved full-value read-only Variables UI with ten-minute memory lifetime.
3. `docs/superpowers/plans/2026-08-31-ops-variables-mutation-redeploy.md`
   - Draft/edit/optional delete, validation, encrypted save, and Apply proof.
   - Atomic writes, exact-byte snapshots, runtime/job/credential actions.
   - Health checks, automatic rollback, rollback-failed incident/application block.
   - Clean active-SHA rebuild/redeploy with public-build allowlist and config identity.
   - Independent rollout flags, retention, reconciliation, runbooks, and drills.

## Dependency and Rollout Sequence

```text
Plan 1: Canonical auth + accounts
  │ Gate A: canonical browser session and owner recovery proven
  ▼
Plan 2: Read-only Config Agent + Variables
  │ Gate B: exhaustive value-free coverage and secret-lifetime tests proven
  ▼
Plan 3A: Draft + validate + encrypted save
  │ Gate C: no active writes; adapter round-trip and staging tests proven
  ▼
Plan 3B: Runtime / next-job / credential apply
  │ Gate D: injected action/health/rollback failures proven
  ▼
Plan 3C: Build / redeploy
  │ Gate E: clean-SHA build, bundle scan, activation rollback proven
  ▼
Production rollout by explicit operator-approved runbook
```

## Program-Wide Decisions That Must Not Drift

- `tuan.dev` is the protected canonical owner; `ops-admin` is a canonical maintainer before legacy auth removal.
- Every active Ops role has equal Variables read/write/apply capability. Only owners administer accounts and clear remediated application blocks.
- Administrative lock, failed-login cooldown, and terminal revoke are separate states/fields and recovery rules.
- The browser trusts only `/api/v1` and `__Host-ops-session`; legacy SQLite cookies never prove canonical identity.
- Full names and values are displayed after password+TOTP. They are not masked, but they are never durably persisted outside agent-encrypted storage.
- The catalog has metadata only; the deployed manifest has exact allowlisted paths/actions/checks only; neither contains values.
- Required cannot be deleted; optional can; unknown/observed cannot be edited. All three layers enforce the same policy.
- Values are never stored in Ops PostgreSQL or audit and never appear in logs, metrics, traces, URLs, SSE, incidents, or browser persistence.
- A `variables_secret` step-up is reusable for at most ten minutes; account mutation and Apply grants are digest/subject-bound and one-use.
- There is no arbitrary filesystem browser, environment dump, shell, command, path, service, or health target supplied from the browser.
- An external source fingerprint conflict cannot be overridden.
- Any post-write failure triggers automatic rollback; rollback failure blocks the application and creates a Critical incident.
- `APP_COMMIT_SHA` remains a bare 40-character source SHA; derived release/config identities use separate fields.

## Program Tracking Checklist

### Gate A — Identity and Recovery

- [ ] Complete and verify every task in Plan 1.
- [ ] Enroll `tuan.dev` as active `ops_owner` with current password/TOTP through the approved production runbook.
- [ ] Enroll `ops-admin` as active `ops_maintainer` before removing legacy login.
- [ ] Prove create, 24-hour one-time enrollment, lock/recovery, permanent revoke, self-protection, last-owner protection, cooldown, and session revocation.
- [ ] Prove every browser route/API uses canonical session/CSRF/Origin enforcement.
- [ ] Retain a tested offline additional-owner recovery path.
- [ ] Remove generic public legacy `/api` routing only after rollback rehearsal.

### Gate B — Read-Only Inventory

- [ ] Complete and verify every task in Plan 2 with mutation capabilities absent.
- [ ] Resolve each active definition into cataloged or explicit unknown output.
- [ ] Resolve/approve every required consumer reference missing from active sources.
- [ ] Verify explicit PM2 literals are observed and PM2-generated internals/backups/OS variables are excluded.
- [ ] Verify API identity can use the agent socket but cannot directly read protected source files.
- [ ] Prove full values disappear on manual lock, route change, session loss/logout, and ten-minute expiry.
- [ ] Search DB/audit/log/trace/metric/URL/storage/test artifacts for injected sentinels and record zero findings.
- [ ] Enable only the read-only production flag through its explicit runbook.

### Gate C — Draft and Save

- [ ] Complete Plan 3 Tasks 1–4 and 7–8 for draft/validate/save behavior.
- [ ] Prove parser unchanged round-trip for every write-enabled adapter.
- [ ] Prove required delete and unknown/observed edit fail in UI, API, and agent.
- [ ] Prove external changes return conflict without overwrite.
- [ ] Prove staged bytes are encrypted, authenticated, key-separated, mode `0600`, and expire after 24 hours.
- [ ] Keep runtime/credential/build apply flags disabled while enabling draft/save.

### Gate D — Runtime Apply and Rollback

- [ ] Complete Plan 3 Tasks 5–8 for enabled runtime strategies.
- [ ] Run harmless `no_runtime_action`, `next_job`, `runtime_restart`, and `credential_restart` drills against sandbox consumers.
- [ ] Inject each write/action/health failure and prove automatic exact-state rollback.
- [ ] Inject rollback failure and prove Critical incident, retained evidence, application block, and owner-gated clear after remediation.
- [ ] Restart browser, API, and agent at each non-terminal state and prove idempotent reconciliation.
- [ ] Enable one production runtime strategy at a time only after its drill passes.

### Gate E — Build and Redeploy

- [ ] Complete Plan 3 Task 9 in `/home/deploy/edutrack-platform` and record the compatible tooling commit.
- [ ] Complete Plan 3 Task 10 in `/home/deploy/edutrack-ops` and bind the manifest to that compatibility floor.
- [ ] Prove build input comes from the active release's exact clean Git SHA, never either mutable repository working tree.
- [ ] Prove only `public + buildAllowed` entries enter frontend build environment.
- [ ] Prove bundle scan, derived release identity, readiness/public smoke, and previous-release rollback.
- [ ] Verify source maps/correlation still receive exact 40-character `APP_COMMIT_SHA`.
- [ ] Enable build/redeploy only through its explicit production runbook.

## Review Checkpoints

- [ ] Security review after Plan 1: session trust boundary, owner invariants, enrollment/recovery, step-up binding, audit redaction.
- [ ] Security review after Plan 2: socket authentication, manifest/source confinement, parser safety, fingerprint construction, secret lifetime/exfiltration controls.
- [ ] Reliability/security review before any Plan 3 flag: encryption/key lifecycle, atomic writes, locks/state recovery, fixed actions/checks, rollback failure behavior.
- [ ] Release-engineering review before build/redeploy: clean source identity, environment allowlist, bundle scanning, activation/retention/rollback.
- [ ] Independent code review before each merge and verification-before-completion before each deployment claim.

## Final Acceptance

- [ ] All 14 acceptance criteria in the approved spec have linked automated tests or signed value-free drill evidence.
- [ ] Full test/typecheck/lint/build/format suites pass in both repositories from clean checkouts.
- [ ] Every required operational document in spec section 19 exists and has been rehearsed for the enabled phase.
- [ ] Rollout flags can return the system to read-only Variables without weakening canonical authentication or user administration.
- [ ] Production mutations remain disabled until the user separately approves execution of the deployment/runbook plan.
