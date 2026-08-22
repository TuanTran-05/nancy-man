# All API Performance Completion Design

## Goal

Finish the API performance program across the remaining route groups after the first attendance/student/class pass. The next pass should reduce repeated auth/user reads, narrow oversized read channels, add cache where data is naturally reusable, and convert repeated frontend request fan-out into server-side bulk/job flows where that is safer.

## Current Baseline

The first API performance pass already improved the hottest attendance and student mutation paths:

- `attendance/bulk-toggle` turns mark-all-present from one request per student into one request per date.
- Attendance, classes, and students routes now reuse `verifyAuthContext` instead of verifying auth and then reading user role/name again.
- Student create/update/delete removed several duplicate reads.
- `useClassData` now refreshes student-only state through the `students` read channel instead of the heavier `class-detail` channel.
- `readLevelManagement` now uses targeted class queries instead of scanning every class.

The rest of the API still contains similar performance patterns:

- `api/edu/[action].ts`, `api/finance/[action].ts`, `api/admissions/[action].ts`, PayOS handlers, audit handlers, knowledge-bank handlers, and Zalo handlers still use `verifyAuthToken` followed by user role/name reads in multiple places.
- `getManagedLevelClassDocs` still scans all classes, so level-manager reads outside `readLevelManagement` remain expensive.
- `readClassDetail` reads class access and then reads the same class document again.
- `readOfficeAcademic`, `readAcademicReportsMonthly`, and finance/parent tuition reads can return or compute more data than each screen needs.
- Zalo notification actions are safe but request-heavy when the frontend sends many messages one recipient at a time.

## Brainstormed Approaches

### Approach A: Incremental Completion Sweep

Keep the current route structure and Firestore model, then remove repeated work route group by route group. Convert old auth patterns to `verifyAuthContext`, fix shared read helpers, add small TTL caches to naturally reusable reads, and introduce a minimal Zalo bulk/job endpoint for repeated sends.

This is the recommended approach. It preserves current behavior, keeps each change testable, and finishes the same style of optimization already proven in the attendance/student/class pass.

### Approach B: Read-Model Heavy Rewrite

Build dedicated read-model documents for office academic, level management, finance, parent dashboards, and reports. This can be very fast after data is precomputed, but it requires background jobs, repair scripts, invalidation design, and operational monitoring. It is too broad for the next pass unless the incremental sweep shows that live reads are still not enough.

### Approach C: Route Middleware Rewrite

Introduce a shared middleware/router layer for auth, role checks, rate limits, audit metadata, and timing across every API. This could reduce duplication long term, but it would touch nearly every route and raise regression risk. It should follow, not precede, the low-risk performance sweep.

## Recommended Design

Use Approach A and split the work into six independently shippable tracks.

### 1. Auth Context Sweep

Convert route groups that still call `verifyAuthToken` plus `getUserRole`, `getUserRoleAndName`, or direct `users/{uid}` reads into `verifyAuthContext` where the handler only needs uid, role, name, email, classId, studentId, teacherId, or managedLevel. Candidate route groups:

- `api/edu/[action].ts`
- `api/finance/[action].ts`
- `api/admissions/[action].ts`
- PayOS `create`, `status`, and review/admin handlers
- audit mutation handlers that only need audit user metadata
- knowledge-bank upload/delete/print handlers
- Zalo OA handlers that currently call `getUserInfo`

Handlers that must load a fresh user document for a write conflict, password check, phone OTP, or account management workflow can keep their explicit read.

### 2. Managed-Level Read Helper

Replace `getManagedLevelClassDocs(db, ctx)` full-class scan with the same targeted strategy used by `readLevelManagement`: query by grade range and query by `level`, merge by ID, then apply existing visibility filters. This improves `readStudents`, `readClasses`, and `readAcademicReportsMonthly` for level managers.

### 3. Read API Right-Sizing

Remove duplicated reads and avoid pulling heavy bundles when callers only need summaries.

- `readClassDetail` should reuse the class data returned by access validation instead of reading `classes/{classId}` again.
- `readOfficeAcademic` should support `view=summary`, `view=detail`, and `view=notifications`; the existing no-view behavior remains backward-compatible during rollout.
- `readAcademicReportsMonthly` should add short TTL cache keyed by role, uid, managed level, month, and scope.
- `readParentTuition` should use a short TTL cache keyed by role, uid, studentId, and limit.

### 4. Finance And Payment Read Trimming

Finance and PayOS list/status endpoints should fetch only the data needed for the requested resource.

- Keep existing paginated resource reads.
- Use `verifyAuthContext` in PayOS `create` and `status` to remove user-profile reads.
- Cache payment health counts for a short TTL inside `handleList` because the health panel is aggregate-style data and does not need to be recomputed on every list refresh.
- Avoid fetching receipt docs for PayOS list when the caller does not render receipt status.

### 5. Zalo Bulk/Job Flow

Add a Zalo bulk send action for repeated class-level sends. The endpoint accepts a classId, notification type, recipient student IDs, and payload defaults. It resolves class access once, resolves recipients in batches, applies existing dedupe/send guard per recipient, writes a job document, processes recipients with a bounded concurrency, and returns a job summary.

This keeps gateway safety and dedupe behavior while moving the frontend from many API requests to one job request.

### 6. Measurement And Guardrails

Add tests and lightweight measurement so speed claims are evidence-based.

- Add unit/API tests that prove duplicated user reads were removed.
- Add read-channel tests for targeted managed-level class queries and view-specific response shapes.
- Extend k6 or smoke scripts with scenarios for `read/office-academic`, `read/reports-monthly`, PayOS status/list, and Zalo bulk job creation.
- Use existing `Server-Timing` on read API and add timing labels only where they help compare before/after.

## Data Flow

Auth-heavy mutation routes should follow one shape:

1. Call `verifyAuthContext(req, res, allowedRoles)`.
2. Pull `uid`, `email`, `role`, `name`, `studentId`, `classId`, `managedLevel` from `verified.context`.
3. Run route-specific validation and rate limit.
4. Call the existing domain handler with the same parameters it already expects, or a small `userInfo` object derived from context.

Read-heavy channels should follow this shape:

1. Authorize once.
2. Narrow the root collection first.
3. Query dependent collections only from narrowed IDs.
4. Project data before returning it.
5. Cache only deterministic read results with a short TTL and a key that includes role, uid, and request params.

Bulk/job actions should follow this shape:

1. Validate request payload and role.
2. Resolve access once.
3. Resolve target docs in bounded batches.
4. Process with bounded concurrency and per-item dedupe.
5. Return a summary plus per-recipient failures.

## Error Handling

The sweep must preserve current response semantics:

- Missing or invalid auth returns existing 401/403 shapes.
- Role restrictions must not become looser.
- Revoked users and blocked student/parent accounts must still be rejected by the auth layer.
- Caches must not cross user boundaries; every cache key includes role and uid when data is user-scoped.
- Bulk Zalo sends must keep per-recipient failure details without failing the whole job after the first failed send.
- Gateway failures should be reported as partial failures and saved for retry.

## Testing Strategy

Use TDD for each change:

- Write a focused failing test for each removed duplicate read or narrowed query.
- Run that single test and confirm the failure reason.
- Implement the smallest route/helper change.
- Re-run the targeted test.
- Run the affected route test file.
- Run `npm.cmd run typecheck`, `npm.cmd run test`, and `npm.cmd run build` before claiming completion.

Add load/smoke measurement after functional tests pass:

- Reuse existing k6 setup for authenticated admin/teacher/parent tokens.
- Add scenarios for high-value flows rather than every route.
- Compare request count, p95 latency, and Firestore read/write estimates before and after.

## Out Of Scope

This pass does not introduce Redis, a new API framework, CDN caching for authenticated JSON, or a full read-model architecture. It also does not change Firestore security rules unless tests show a required query cannot be served safely by the current rules. Those are later architecture projects.
