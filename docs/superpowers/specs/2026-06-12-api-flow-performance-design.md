# API Flow Performance Design

## Goal

Improve the highest-impact API flows identified in the audit: attendance marking, bulk attendance, student/class mutations, class-detail reads, level-management reads, and repeated Firestore reads inside student CRUD. The work should reduce Firestore round trips, request fan-out, and unnecessary server work without weakening authorization, audit logging, or realtime invalidation.

## Current Findings

The most expensive user-visible path is attendance. `Mark all present` currently calls the single-student attendance mutation once per student from `src/pages/common/ClassDetail.tsx`. Each single mutation verifies auth, reads user role, runs a Firestore-backed rate-limit transaction, reads class access, reads student membership, runs an attendance transaction, refreshes trial status, writes audit, and touches realtime event documents.

Several mutation routes read `users/{uid}` twice: `verifyAuthToken` reads the user document, then the route calls `getUserRole` or `getUserRoleAndName`. The existing `verifyAuthContext` helper already returns the decoded token plus a `UserContext`, so the extra read can be removed from attendance, classes, and students API entry points.

`useClassData` calls the `class-detail` read channel only to populate students, but `readClassDetail` fetches class, students, attendance, evaluations, class sessions, and daily reports. The frontend should use the lighter `students` read channel for this specific need.

`readLevelManagement` reads every class document and filters by managed level in memory. The frontend already listens to classes by `grade` range and by `level`, so the server read path can use the same filtered query strategy and then fan out only across the visible class IDs.

Student create/update/delete flows include repeated reads. Create checks for duplicate students before calling a helper that checks again inside a transaction. Update/delete read the student before a transaction and then read the same document again inside the transaction.

## Brainstormed Approaches

### Approach A: Targeted Low-Risk Optimization

This approach keeps the existing API shape and data model, then removes waste from the hottest paths. It adds one bulk attendance action, switches mutation routes to `verifyAuthContext`, avoids trial refresh for non-trial students, changes `useClassData` to call the lighter `students` read channel, optimizes level-management class selection, and removes duplicated student CRUD reads where behavior stays identical.

This is the recommended approach. It is incremental, testable, and compatible with the current Vercel + Firestore architecture.

### Approach B: Read Model First

This approach would build new Firestore read models for class detail and level management, then serve those channels from precomputed documents. It could become faster than live fan-out queries for large deployments, but it adds background jobs, invalidation rules, and repair tooling. It is better as a later phase after the low-risk fixes are merged and measured.

### Approach C: Broader API Rewrite

This approach would rewrite mutation routing, authorization, rate limiting, auditing, and realtime invalidation into shared middleware. It could clean up long-term architecture, but it has higher regression risk and would slow down the immediate performance fix.

## Recommended Design

Use Approach A and split the work into six independently testable improvements.

1. Add a bulk attendance action for explicit status writes. `bulk-toggle` will accept `classId`, `date`, `status`, and `studentIds`. It will validate the class once, verify all students belong to the class, batch `set(..., { merge: true })` attendance documents, write one summary audit log, refresh trial status only for trial students, touch realtime events once, and return updated IDs.

2. Gate trial refresh on known student lifecycle. Existing `assertStudentInClass` returns the student document data. Single-student `toggle` and `cycle` should use that returned data and call `refreshTrialReviewStatus` only when `studentLifecycle === 'trial'`.

3. Use `verifyAuthContext` in mutation routes. Attendance, classes, and students routes should reuse the context returned by auth verification instead of reading user role/name again.

4. Replace class-detail reads used only for students. `useClassData` should call `readChannel('students', { classId, limit })` when it only needs students. This avoids fetching attendance, evaluations, sessions, and reports unnecessarily.

5. Optimize level-management class selection. Replace full `classes` scan with two targeted queries: `where('grade', '>=', min).where('grade', '<=', max)` and `where('level', '==', managedLevel)`, merge by ID, apply existing visibility filters, and then fan out to related collections by class ID.

6. Reduce student CRUD duplicate reads. Keep atomic checks where needed, but remove pre-transaction duplicate work when the transaction already performs the required validation. Preserve current error messages and audit metadata.

## Data Flow

For bulk attendance, the frontend computes the non-present student IDs the same way it does today, applies one optimistic state update for all selected students, and calls the new action once. The server validates access once, writes attendance records in one batch, and emits realtime invalidation after the batch succeeds.

For read optimization, the frontend should request exactly the data it needs. Student-only refreshes go through `students`; full class detail remains available for screens that truly need the complete bundle.

For level management, server-side reads should first narrow class IDs, then query dependent collections. This preserves existing response shape while reducing the class scan and dependent fan-out.

## Error Handling

Bulk attendance should reject missing `classId`, invalid date, future date, invalid status, empty `studentIds`, too many student IDs, unauthorized class access, and any student not belonging to the class. It should return `400` for malformed input, `403` for unauthorized class access, and keep existing attendance error response shape.

Auth context conversion should not change response bodies for missing tokens, revoked users, or insufficient roles.

Student CRUD read reduction must preserve existing `404`, `403`, and duplicate-student `409` behavior.

## Testing Strategy

Use existing Vitest API tests as the primary safety net. Add focused tests for bulk attendance, non-trial refresh skipping, auth context reuse, `useClassData` read-channel choice, level-management filtered class queries, and student CRUD duplicate-read reduction.

Run targeted tests first, then the broader API test set, then typecheck. Use the existing k6 scripts only after functional tests pass and credentials are available.

## Out of Scope

This design does not introduce new background workers, Redis, CDN caching for authenticated JSON, or a full read-model rewrite. Those can be revisited after the low-risk improvements are measured.
