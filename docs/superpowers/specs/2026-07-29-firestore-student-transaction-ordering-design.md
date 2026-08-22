# Firestore Student Transaction Ordering Design

Date: 2026-07-29

## Problem

Several student mutation handlers perform Firestore transaction writes before
`syncStudentLinkedUsersInTransaction()` reads the deterministic linked user
documents. The Firestore server SDK rejects every `Transaction.get()` executed
after the first `create`, `set`, `update`, or `delete` in the same transaction.

The production failure is visible in the student status handler:

1. Read the canonical student document.
2. Read enrollment records.
3. Schedule enrollment writes.
4. Read `users/student:<studentId>` and `users/parent:<studentId>`.
5. Firestore throws `Firestore transactions require all reads to be executed
   before all writes`.

The transaction aborts atomically, so the mutation does not leave partial
Firestore state, but the requested student operation fails.

## Scope

The fix covers every known caller where linked-user reads can occur after
transaction writes:

- student status changes;
- student profile updates that change class or course enrollment;
- student transfers;
- student archive/soft-delete;
- admission trial acceptance and rejection.

Callers that already read linked users before their first transaction write
remain behaviorally unchanged.

The Node.js `DEP0169` warning is out of scope. It originates in the installed
`firebase-admin` dependency's HTTP utility and is not the cause of the Firestore
transaction failure.

## Requirements

1. Every affected transaction must execute all Firestore reads before its first
   write.
2. Canonical student, enrollment, linked user, counters, and related business
   updates must remain atomic.
3. Missing linked student or parent user documents must continue to be ignored;
   the fix must not create them.
4. Existing linked user patch semantics must remain unchanged.
5. Existing public handler behavior and response contracts must remain
   unchanged.
6. A regression test must fail when production code attempts a transaction read
   after any transaction write.
7. The focused server tests, TypeScript check, and production build must pass
   before completion.

## Considered Approaches

### 1. Split linked-user synchronization into read and write phases

Add a read-only helper that loads the deterministic linked-user snapshots and a
write-only helper that applies patches from those snapshots. A compatibility
wrapper can retain the current one-call behavior for unaffected callers.

Advantages:

- preserves atomicity;
- makes Firestore's ordering invariant explicit in the API;
- centralizes deterministic user-reference and patch behavior;
- supports all affected handlers without duplicated synchronization logic.

Cost:

- affected handlers must carry a small preload value from their read phase into
  their write phase.

This is the selected approach.

### 2. Prefetch linked users independently in every handler

Each handler could duplicate user-reference construction, reads, existence
checks, and writes.

This minimizes helper changes but duplicates security-sensitive profile-sync
logic and makes future ordering regressions more likely.

### 3. Synchronize linked users after the transaction commits

This avoids read/write ordering constraints but breaks atomicity. A canonical
student mutation could commit while its linked authentication profile remains
stale. This approach is rejected.

## Architecture

`studentProfileSync.ts` will expose three responsibilities:

1. `readStudentLinkedUsersInTransaction(tx, db, studentDocId)`:
   constructs deterministic student and parent references, performs both
   transaction reads, and returns an opaque preload structure.
2. `applyStudentLinkedUsersInTransaction(tx, studentDocId, studentData,
   preload)`:
   performs no reads and schedules updates only for linked user documents that
   existed in the preload.
3. `syncStudentLinkedUsersInTransaction(...)`:
   remains as a compatibility wrapper that calls the read helper and then the
   apply helper. It is safe only when the caller has not scheduled a prior
   transaction write.

The preload type will retain each role, document reference, and existence
snapshot together so role/ref/snapshot indexes cannot drift apart.

## Transaction Data Flow

Each affected handler will follow this sequence:

1. Read the canonical student and any authorization or consistency documents.
2. Read all handler-specific queries and enrollment documents.
3. Read deterministic linked student and parent user documents.
4. Validate the complete read state and derive the post-mutation student state.
5. Schedule enrollment and related writes.
6. Apply linked-user updates using the preload, without further reads.
7. Schedule canonical student, counters, audit-supporting, and related writes.
8. Commit atomically.

Enrollment repository functions may continue combining their own reads and
writes when invoked before any transaction write. The linked-user preload must
therefore occur before those functions in affected handlers.

## Handler Changes

### Student status

Preload linked users after reading and authorizing the student, before
`closeOpenEnrollments()` or `upsertSystemEnrollment()`. Apply linked-user
updates after deriving the status update.

### Student update with class change

Preload linked users before the optional enrollment upsert. Apply the preload
after calculating the merged student payload.

### Student transfer

Include linked-user reads with the existing transaction read phase before the
enrollment upsert and before pending-payment writes. Apply linked-user updates
after deriving the target-class student state.

### Student archive/soft-delete

Preload linked users before closing open enrollments. Apply the preload after
deriving the archive state.

### Trial decision

Preload linked users before accepting or closing trial enrollments. Apply the
preload before the canonical student update.

## Error Handling and Atomicity

No new partial-success behavior is introduced. Any read, validation, or write
failure rejects the transaction and Firestore retries or aborts it according to
the existing SDK behavior. Existing HTTP error mapping remains unchanged.

Linked-user documents that do not exist are skipped exactly as before. A retry
re-reads the preload and derives writes from the retry's current snapshots.

## Testing Strategy

### Regression invariant

Create a reusable strict transaction test double that records whether a write
has occurred and throws the Firestore error when `get()` is called afterward.
Use it in tests that exercise the real production orchestration.

### Helper tests

Verify that:

- the read helper reads both deterministic user documents;
- the apply helper performs no reads;
- only existing linked users are updated;
- student and parent patches retain their current field behavior;
- the compatibility wrapper remains correct for unaffected callers.

### Handler tests

Add focused regression coverage for the status path that first writes an
enrollment and then synchronizes linked users on the current implementation.
Where practical, cover the shared ordering behavior of update, transfer,
archive, and trial-decision callers with the same strict transaction test
double or focused orchestration tests.

### Verification

Run:

1. newly added regression tests in their failing state;
2. the same tests after implementation;
3. existing student profile-sync and enrollment repository tests;
4. affected handler/API tests;
5. the broader server test suite;
6. TypeScript typecheck;
7. production build.

## Non-Goals

- changing student status or enrollment business rules;
- changing user document IDs or creating missing linked users;
- weakening transaction atomicity;
- upgrading Firebase dependencies;
- suppressing the `DEP0169` warning;
- unrelated refactoring in the dirty working tree.

## Success Criteria

The implementation is complete when all affected transaction paths can combine
enrollment or related writes with linked-user synchronization without issuing a
read after a write, regression tests prove the invariant, existing business
semantics remain intact, and all required verification commands pass.
