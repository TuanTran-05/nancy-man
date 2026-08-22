# Secure Realtime Student Reads And Server Readiness

## Goal

Preserve direct Firestore realtime reads where they improve dashboard responsiveness, while preventing legacy student credential material from reaching a browser and addressing two security/readiness regressions identified in the audit.

## Approved Direction

Use a phased safe-read approach:

- Keep Firestore `onSnapshot` reads for collections that do not contain student credential fields.
- Route reads of `students` through authenticated server read APIs that return per-channel allowlisted projections.
- Deny client `get` and `list` access to `/students/{studentId}` in Firestore Rules for the safe-read release. Server APIs use the Admin SDK and remain able to construct authorized projections.
- Introduce one centralized feature flag, `VITE_ENABLE_DIRECT_STUDENT_SNAPSHOTS=false`, to represent read-mode rollout state. This flag is not a security boundary: Rules must remain deny-by-default unless a later reviewed deployment explicitly re-enables a safe client-readable data model.
- Fix health readiness and Zalo OTP enumeration in the same security remediation because both are confirmed server boundary issues.

## Security Invariant

No browser response or Firestore snapshot accessible to an authorized client may contain:

- `loginPasswordHash`
- `loginPasswordSalt`
- `passwordVersion`
- `parentPasswordHash`
- `parentPasswordSalt`
- `parentPasswordVersion`

Client-side stripping is not considered a security control because it runs after data has crossed the browser boundary.

During the safe phase, Firestore Rules must deny all client direct reads to `/students`; frontend feature flags are not security boundaries and only control application behavior.

## Scope

### Student Read Boundary

The current direct `students` reads in dashboards, class/student views, finance, messaging, assignments, calendar, reports, parent views, and auth-linked student state must no longer be used while legacy credential fields may still exist.

The prohibited browser read forms include direct or wrapped uses of:

- `collection(db, 'students')`
- `doc(db, 'students', id)`
- `query(collection(db, 'students'), ...)`
- `onSnapshot(...)` targeting a student collection or document
- `getDocs(...)` targeting a student collection query
- `getDoc(...)` targeting a student document

The prohibition covers both realtime and one-shot client reads. A one-shot SDK read crosses the same browser boundary as a snapshot.

The server read path in `api/read/[channel].ts` is the preferred boundary because it already:

- Requires authenticated requests.
- Applies role-scoped authorization.
- Can apply authorization and student field projection before serializing students.

Frontend code should use the existing typed read API or a small polling/revalidation wrapper around it where current screens require refresh behavior. This remediation does not attempt to create a new server-sent event system.

### Server Projection Allowlist

The current API already dispatches by read channel through `api/read/[channel].ts` and `src/lib/api/readApi.ts`. Keep that surface and replace broad student serialization with named projectors. The existing `students` channel may accept a validated `view` selector for narrow consumer projections; every view must have explicit authorization and cannot widen the caller's student scope.

Every channel that emits a student object must explicitly allowlist the fields required by that UI:

- Dashboard/roster/class-detail views receive display identity, class assignment, enrollment/lifecycle and the minimal academic fields they render.
- Student directory views receive approved contact fields only for staff roles that require them.
- Finance/accounting views receive display identity, class/status and only the billing/contact fields required for their workflow.
- Parent/student views receive only the linked student's display, class, lifecycle and authorized progress fields.
- Messaging/lookup views receive only identifiers and display labels needed to resolve participants.

No projector may serialize a raw student document or implement security as a blacklist-only strip. Credential fields remain excluded defensively, but the allowlist is the contract.

### Central Student Read Mode

Define the future rollout switch in one module/config boundary using `VITE_ENABLE_DIRECT_STUDENT_SNAPSHOTS`, defaulting to `false` when unset.

- In the safe-read release, all production code uses server projections and Rules deny browser reads of `/students`.
- A static/source-boundary test fails if any prohibited direct student read form is introduced outside an explicitly isolated future adapter.
- Setting the frontend flag to `true` alone must not restore access; doing so while Rules remain locked results in denied reads, not a silent security bypass.
- Direct student snapshots are a future performance optimization only, not the default target architecture.

### Realtime Reads To Retain

Direct `onSnapshot` access can remain for non-student resources where Rules already enforce the required role or ownership restrictions and no credential fields exist, including suitable class, attendance, assignment, submission, message, notification, and finance resources.

Any read that joins or materializes `students` must use a server allowlisted projection in the safe-read release.

### Credential Migration Verification

Keep the existing admin-only migration operation and add an explicit verification result that scans `students` for legacy credential fields and returns counts suitable for an audit trail.

The minimum eligibility conditions for considering a later direct `students` snapshot release are:

- Credential migration has completed in the target environment.
- Verification reports zero student documents containing any legacy credential field.
- An automated regression test guards the required zero-legacy-field verification.
- A separate design/review explicitly justifies the realtime requirement, its safe client-readable field model, feature-flag transition and corresponding Firestore Rules change.

Server projections remain the default even after migration verification succeeds.

## Server Readiness

`/api/v1/health` must remain public and return a stable HTTP response even when core configuration is missing:

- Healthy configuration and reachable Firestore: `200` with `status: "ok"`.
- Missing required configuration or unavailable Firestore: `503` with `status: "degraded"`.
- The health request path must not call `process.exit()`.

Business API routes may retain fail-closed initialization behavior. The implementation should separate non-terminating health validation from fatal startup or request validation, without including secret values in the response.

## Zalo OTP Enumeration

The public request-OTP endpoint must not expose whether a student code exists, whether the phone matches, or whether the related student account is disabled.

- Invalid code, mismatched phone, revoked/dropped account, and other non-sendable identity failures return the same public response shape and status.
- Existing rate limiting remains in place.
- Operational errors after a valid send attempt, such as an unavailable Zalo provider, may remain distinguishable where needed for legitimate recovery, provided they do not expose student identity matching results.

## Error Handling

- Frontend API-read failures should preserve current page error/loading behavior and must not fall back to direct student snapshots.
- Student-read server responses must use per-channel allowlists and continue excluding credential fields even after production migration has been completed.
- Health degradation responses must be minimal and safe for unauthenticated callers.
- Migration verification must be admin-only and audit logged consistently with the existing migration operation.

## Testing Strategy

### Server Tests

- Add a failing-then-passing health test proving missing core environment configuration produces `503 degraded` without terminating the process.
- Add migration verification tests for zero and non-zero legacy credential findings.
- Extend read API tests to cover every legacy credential field and to assert per-channel field allowlists.
- Add Zalo OTP tests proving identity failure cases are indistinguishable and rate limiting remains enforced.
- Add Firebase Rules Emulator tests proving authenticated client roles cannot `get` or `list` `/students` during the safe-read release.

### Frontend Tests

- Add or update hook/page tests verifying affected views request safe student data via the server read client and do not subscribe to `students` directly.
- Add a static regression assertion preventing all prohibited direct student read forms, including `onSnapshot`, `getDoc`, and `getDocs`, until a later reviewed read-mode release.
- Add tests for the centralized direct-snapshot feature flag defaulting to `false`.

### Integration And E2E Tests

- Add an E2E readiness scenario proving `/api/v1/health` returns a response rather than terminating a misconfigured development server.
- Cover at least one dashboard/class student workflow that loads student display data through the safe server projection.

## Rollout

### Safe Phase

1. Ship the safe student-read boundary and Firestore Rules denial atomically, together with the readiness fix, OTP response normalization, and tests.
2. Run the admin credential migration in each deployed environment.
3. Run and retain migration verification evidence showing zero legacy credential fields in `students`.
4. Keep server projections as the production default.

### Re-enable Phase

Direct realtime reads of `/students` may only be considered after all of the following have been retained or passed:

- Credential migration is complete.
- Verification reports zero legacy credential fields.
- The Firestore Rules change has been reviewed.
- Regression tests pass.
- Audit evidence of migration and verification is retained.

Even when these conditions are met, enabling direct `students` snapshots is a separate reviewed performance change with a safe client-readable data model and explicit Rules transition.

## Non-Goals

- Removing all direct Firestore listeners.
- Replacing Firestore realtime reads with a new SSE or WebSocket architecture.
- Automatically re-enabling direct `students` reads merely because migration reports zero.
- Broad refactoring of unrelated business logic or roles.
- Treating the public Firebase web configuration as a backend secret.

## Acceptance Criteria

- No frontend production path directly reads `students` through Firestore SDK in the safe-read release.
- Firestore Rules reject browser `get` and `list` reads of `/students` in the safe-read release.
- `VITE_ENABLE_DIRECT_STUDENT_SNAPSHOTS` is centralized, defaults to `false`, and cannot bypass Firestore Rules.
- Student data returned through server reads is allowlisted per channel and never contains any listed credential field.
- The health endpoint responds with `503 degraded` rather than exiting when required configuration is missing.
- Zalo OTP identity failures are not distinguishable by public response.
- Unit, targeted integration, frontend regression, and E2E tests cover the new guarantees.
