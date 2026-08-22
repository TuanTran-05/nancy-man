# Workstream A Boundary Hardening Design

**Date:** 2026-08-09

**Goal:** Close the four Workstream A findings that still allow legacy identity writes, stale admissions decisions, or mutations during maintenance.

## Scope

This change covers student transfer, status changes, manual enrollment correction, trial creation/reactivation/decision, and pending-student deletion. It does not change the Workstream C merge engine, production data, or the public response shapes of those handlers.

## Design decisions

### 1. Enrollment authority at mutation boundaries

Transfer resolves the canonical profile first, then loads the single open enrollment and derives `sourceClassId` from that record. `students.classId` is never used as transfer authority. Missing or multiple open enrollments fail with the existing progression-domain conflict codes.

Status and manual enrollment correction continue to mutate `student_course_enrollments` inside the maintenance-guarded transaction. Profile and linked-user relationship fields are compatibility outputs only.

### 2. One read-mode-aware projection policy

Add a small helper beside `canonicalStudentReadControl.ts` that produces relationship fields for profile creation and profile/user updates. In `legacy_compare` and `canonical_preferred`, it returns the existing `classId`, `teacherId`, and `enrollmentStatus` values. In `canonical_required`, create payloads omit those fields and update payloads delete them; `currentEnrollmentId` remains service-managed.

Every Workstream A lifecycle writer consumes this helper. A handler may not infer the policy from whether legacy fields happen to exist on a profile.

### 3. Canonical admissions targets

`pendingStudentId` and selected historical matches are treated as requested IDs. The handler resolves them to a canonical profile before profile access and resolves them again through the transaction before any write. Reactivation validates the canonical document's current lifecycle; a legacy alias, soft-merge source, or tombstone can never be updated or receive a new enrollment.

When several physical admission matches resolve to one canonical profile, they count as one candidate. When they resolve to different canonical profiles, the existing review-required conflict remains.

### 4. Fresh transactional state

Trial reactivation, pending-to-trial promotion, and trial decisions re-read the canonical profile inside `runStudentIdentityMutationTransaction`. Lifecycle, authorization inputs, linked users, enrollments, counters, and update data are derived from that transaction snapshot. A retry recomputes the decision rather than reusing pre-transaction profile data.

`delete-pending` resolves, reads, validates, and deletes the canonical pending profile in the same maintenance-guarded transaction. The code registry entry remains reserved.

## Error behavior

- A transfer without exactly one open source enrollment returns `409 STUDENT_PROGRESSION_SOURCE_INELIGIBLE`.
- A requested admissions ID that resolves to a non-pending or non-archived canonical profile returns 409 and writes nothing.
- A maintenance switch to `read_only` causes the transaction to retry and return `503 STUDENT_IDENTITY_MAINTENANCE` before business writes.
- A second concurrent trial decision re-evaluates the latest profile state and fails once the first decision has changed the lifecycle.

## Tests

Regression tests must prove:

- transfer succeeds in `canonical_required` with no `students.classId` by using the open enrollment;
- create-trial, status, trial-decision, and manual enrollment correction do not recreate legacy relationship fields in `canonical_required`;
- selected aliases and legacy soft-merge IDs reactivate only the canonical profile;
- pending promotion resolves canonical identity and rechecks lifecycle in the transaction;
- concurrent or stale trial decisions cannot overwrite a completed decision;
- `delete-pending` writes nothing when maintenance changes before commit;
- existing focused Workstream A, emulator, rules, typecheck, and build gates remain green.

## Non-goals

This change does not remove the legacy fields from existing documents, alter read-mode transition rules, modify merge/retirement artifacts, or perform production writes.
