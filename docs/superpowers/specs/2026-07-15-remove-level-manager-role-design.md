# Remove Level Manager Role Design

## Status and objective

Approved on 2026-07-15. Remove the `level_manager` staff role and every active subsystem that exists only for it. Delete existing Firebase Authentication accounts and user profiles for this role, anonymize their identity in retained business and audit records, and leave the remaining roles with exactly their current permissions.

## Approved decisions

- Delete existing accounts rather than reassigning or retaining them.
- Delete the dedicated level-management capability rather than transferring it to `admin` or `office`.
- Remove the role from shared allowlists without granting replacement permissions.
- Retain business records and audit events; anonymize affected identity fields as `Tài khoản nhân sự đã xóa`.
- Update current documentation while preserving historical specs, plans, and Git history.
- Use a two-stage rollout: deny and migrate first, then remove the role from the architecture.

## Current-system findings

The role appears in frontend and backend role unions, role normalization, staff creation, email generation, login, profile phone OTP, staff presentation, the `/level-management` route, its page and hook, read and realtime channels, server authorization, Firestore Rules, operational scripts, tests, translations, README, and current operational documentation.

The business concept `EducationLevel`, grade ranges, and class-level classification remains valid. Only the staff role and role-scoped access model are deleted.

## Target architecture

Supported roles become `admin`, `office`, `teacher`, `accounting`, `student`, and `parent`. The final system has no `managedLevel` staff field, `/level-management` route, level-management page or hook, `level-management` read or realtime channel, or authorization branch that recognizes the deleted role. Unknown roles are rejected by ordinary fail-closed checks; no compatibility branch remains.

## Rollout

### Stage 1: deny and migrate

1. Deploy fail-closed denial so legacy accounts cannot create activity.
2. Run dry-run inventory and produce an operator-only manifest.
3. Confirm Firebase project ID and manifest hash before apply mode.
4. Back up identity data required for controlled recovery.
5. Anonymize identity references in retained business and audit records.
6. Delete Firestore profiles and dependent identity or credential records.
7. Delete Firebase Authentication accounts.
8. Require zero active accounts, profiles, claims, and personal identity references before Stage 2.

### Stage 2: remove from the architecture

1. Remove the role from types, allowlists, normalizers, account creation, rules, realtime registries, and scripts.
2. Delete the dedicated page, hook, route, read channel, and realtime channel.
3. Remove role-specific UI, copy, tests, and current documentation.
4. Delete the one-time migration code after production verification.
5. Run the complete regression matrix and legacy scan.

After Stage 1 deletes production data, rolling back to a release that can create or recognize the role is forbidden. Incidents beyond that boundary use a forward fix.

## Migration design

### Discovery and manifest

Discover candidates from Firestore role fields, matching Firebase Auth accounts, custom claims, normalized legacy spellings, the role-specific email suffix, and records containing affected UIDs or identity fields.

Dry-run is the default. Its uncommitted manifest contains project ID, timestamp, candidate UID and user-document ID, reference counts by collection and field, planned operations, a deterministic hash, and per-UID retry state. Apply requires an explicit flag, an allowed project ID, and a hash matching the reviewed dry-run. Secrets and unredacted personal data must not be committed or printed.

### Per-account order

1. Confirm the candidate belongs to the reviewed manifest.
2. Anonymize retained identity fields as `Tài khoản nhân sự đã xóa`.
3. Preserve action, resource, timestamp, message content, and business fields.
4. Delete profile, credential, and identity-only documents.
5. Delete the Firebase Auth account.
6. Journal completion and verify no personal identity remains.

The migration is idempotent, resumes failed UIDs, and never broadens its candidate set beyond the reviewed manifest. Firebase Auth and Firestore do not share a transaction, so failure stops further destructive work for that UID and leaves a resumable journal entry.

Classes, students, assignments, evaluations, attendance, messages, and audit events are never deleted solely because an affected account created or approved them.

## Component boundaries

### Role and identity

- Remove the role from frontend and backend unions.
- Remove aliases, email inference, role-specific suffix generation, and `managedLevel` persistence.
- Staff creation supports `teacher`, `office`, and `accounting`.
- Generic validation rejects unsupported roles.

### Frontend

- Delete the page and data hook.
- Delete route loading, route guards, navigation, and role branches.
- Remove the role from create-staff and admin staff views.
- Remove translations, icons, colors, and labels.

### Backend, API, rules, and realtime

- Delete the reader, channel dispatch, and managed-level visibility helpers.
- Remove the role from assignment, authoring, knowledge-bank, student, evaluation, message, OTP, and staff-auth allowlists.
- Preserve current permissions for every remaining role without expansion.
- Delete Firestore Rules helpers and clauses specific to this role.
- Delete the realtime channel after its consumers are gone.

### Scripts and documentation

- Remove the role from staff audit, backfill, Zalo, and operational scripts.
- Keep the destructive migration separate from generic backfills and delete it after verified production completion.
- Update README and current architecture or operational checklists.
- Do not rewrite historical specs, plans, or Git history.

## Safety and error handling

Abort without writes when project ID is not allowed, confirmation is missing, the manifest hash differs, a candidate is absent from the manifest, an unknown identity-bearing field is discovered, or backup and denial prerequisites are not confirmed.

Journal per-UID failures. Do not continue destructive work for a UID until the prior step verifies. Operator output reports counts and opaque identifiers without exposing passwords, tokens, or personal data.

## Testing strategy

### Migration

- Dry-run performs zero writes and deletions.
- Apply touches only reviewed UIDs.
- Reruns are idempotent and interrupted runs resume.
- Anonymization removes identity while preserving business history.
- Project-ID and manifest-hash mismatches fail closed.

### Authorization and contracts

Test `admin`, `office`, `teacher`, `accounting`, `student`, `parent`, and anonymous access. Unknown roles must be denied by backend, Firestore, and realtime authorization. Staff creation rejects unsupported roles. No remaining role gains a deleted capability.

The removed route and channel are nonexistent and never fall back to another role. Remaining role journeys continue to work.

### Full verification

Run focused unit, API, UI, migration, and Firestore Rules tests; full Vitest; Firestore Rules tests; typecheck; ESLint; production build; and an active-source scan for legacy spellings, `managedLevel`, and the removed route or channel. The scan intentionally excludes historical `docs/superpowers/specs`, `docs/superpowers/plans`, and Git history.

## Acceptance criteria

- No affected Auth account, user document, custom claim, credential record, or personal identity reference remains.
- No active code path recognizes or authorizes the deleted role.
- No dedicated UI, API, read channel, realtime channel, or rule remains.
- No business or audit record is lost; retained history is anonymized.
- The six supported roles pass regression tests without permission expansion.
- Current documentation lists only supported roles; historical records remain intact.
- The one-time migration implementation is removed after production verification.
