# Roster Takeover Chain Hardening Design

## Status and objective

Approved on 2026-07-16. Close the account-takeover chain that lets any authenticated student or parent read every classmate's `studentId` and `dob` from the `class-detail` read channel, and then use that pair as login credentials. Additionally scope quiz answers and assignment targeting in Firestore Rules, add download traceability to the knowledge bank, and tighten the phone-based password reset and client audit log endpoints.

This work originates from an external security report that scanned snapshot `d879e9e1`, which is 17 commits behind current `HEAD` (`6a73bd95`). Every finding below was re-verified against `HEAD` before being accepted into scope. The report's own evidence pointers were frequently wrong and are not reproduced here; the pointers in this document are the verified ones.

## Approved decisions

- Keep the date-of-birth fallback login. The chain is cut at the roster end only.
- Restrict the `class-detail` channel to an `admin`/`teacher`/`office` allowlist (403 for all else, including `accounting` and future roles). No frontend calls it, so no consumer breaks, and no per-collection scoping is needed.
- Do not add an ownership check to knowledge bank downloads. Add fail-closed audit logging instead: no signed URL is returned if the audit write fails.
- Treat the three `level_manager` findings as dead, the accounting reset-course finding as by-design, and the knowledge bank download IDOR as by-design.
- Fix the phone reset by requiring the lookup token it currently skips, including the missing frontend propagation of that token, and leave `type` caller-selectable rather than break guardian recovery.
- Land each finding group as one or more focused commits so each security boundary can be reverted deliberately. Group 2 originally landed in two commits (`bfc4f965` for both rules changes and `c03fdb72` for the Admin SDK service filter); the follow-up direct-list remediation is a third focused commit. Group 4 is four commits (reset backend, reset frontend, audit allowlist, face-image test); Groups 1 and 3 are one commit each.

## Revisions after review

An implementation review (2026-07-16) found two blockers in an earlier draft, both verified and corrected here:

- The earlier Group 1 restricted only the `students` array. `readClassDetail` also returns `attendance`, `evaluations`, and `reports`, whose student/parent projections (`utils.ts:362, 379, 413`) each carry `studentId`, and evaluations additionally carry `scores`, `finalScore`, and `feedback` (`utils.ts:383-386`). Restricting the roster alone left every classmate's id, grades, and feedback exposed. The earlier claim that "no caller can obtain another student's `studentId`" was false. Resolved by denying the endpoint to student/parent outright.
- The earlier Group 4 required a `lookupToken` server-side without noting that the frontend never sends one. The token is a local `const` at `useLoginHandlers.ts:709`, is never stored to state on the phone branch, and the reset call at `useLoginHandlers.ts:1091-1094` omits it. Backend-only enforcement would 403 every legitimate phone reset. Frontend propagation is now in scope.

A second review round (2026-07-16) found one more blocker and refinements in Group 2, all verified and corrected here:

- The Group 2 assignments rule was necessary but not sufficient. `getParentDashboardPayload` returns all class assignments via the Admin SDK, which bypasses Firestore Rules, so `student`/`parent` still saw targeted assignments through the `parent-dashboard` channel. The service-level `canStudentAccessAssignment` filter is now part of Group 2, tested at the API level.
- The `quiz_answers` scoping is "assignment owner or class owner" (`isTeacherClassScopedDoc`), not strictly the class's teacher. Wording clarified; both branches are now tested with a fixture that separates `teacherId` from `classId` ownership.
- The demonstration `array-contains` list test must also constrain `classId`, or the rule (which requires `isCurrentUserClass`) rejects the whole query. Fixed.
- Added coverage: a mistyped `assignedStudentIds` (a string, not a list) must deny; and `parent` — not only `student` — must be allowed class-wide and self-targeted reads.

A post-implementation security review (2026-07-16) found that the Firestore emulator accepts the proposed student `classId` list and returns assignments targeted to other students, even though direct `get` of those documents is denied. The supported student UI already reads assignments through `readAssignments`, and the parent UI uses `parent-dashboard`; both Admin SDK paths enforce `canStudentAccessAssignment`. Direct Firestore assignment lists are used only by staff-side hooks. Group 2 therefore denies every direct student/parent assignment `list` while preserving targeted direct `get` behavior. This removes reliance on undocumented emulator/production query-analyzer parity and makes the supported API paths the only collection-list boundary for student/parent assignment data.

## Governing architectural principle

`firestore.rules:511-516` denies all client reads of `students` (`allow read: if false`), with the comment "The Admin SDK read API returns allowlisted projections instead." The Admin SDK projection layer is therefore the only path by which student data reaches a client, and it is the intended security boundary.

`authorizeStudentProjection` (`server/api/read/handlers/utils.ts:629-649`) is where that boundary is defined: `identity`, `academic`, `directory`, and `attendance` require `admin`/`teacher`/`office`; `session` is for `student`/`parent`; `finance` defers to `assertFinanceAccess`.

`readClassDetail` (`server/api/read/handlers/readers.ts:1317-1319`) selects a projection directly instead of consulting that function, and hands `academic` to `student` and `parent`. That divergence is the root defect. Fixes belong at the divergence, not in the field lists.

## Current-system findings

### The takeover chain (verified end-to-end at HEAD)

1. `assertClassAccess` (`server/api/lib/auth/authz.ts:131-138`) permits `student` and `parent` to read their own class, so `readClassDetail` is reachable by them.
2. `readClassDetail` (`readers.ts:1304-1325`) queries every student in the class and projects each through `academic` for non-directory roles.
3. `ACADEMIC_FIELDS` (`server/api/lib/student/studentProjection.ts:10-31`) contains `dob` (line 14) and, via `IDENTITY_FIELDS` (line 9), `studentId`.
4. `handleVerifyStudentLogin` (`server/api/auth/handlers/studentAuth.ts:126, 159`) accepts `studentDobMatches(studentData.dob, pw)` whenever `parentPasswordSet`/`customLoginPasswordSet` is not `true`.

A student reading `class-detail` therefore obtains the exact credential pair for every classmate who has never set a password. The remaining barriers are Turnstile and a 10-per-5-minutes rate limit keyed `ip:code`, neither of which stops a targeted takeover.

The roster is not the only leak in the response. `readClassDetail` also returns `attendance`, `evaluations`, and `reports`. Their student/parent projections still expose `studentId`: `projectedAttendanceForRole` (`utils.ts:362`), `projectedEvaluationForRole` (`utils.ts:379`, plus `scores`/`finalScore`/`feedback` at 383-386), and `projectedReportForRole` (`utils.ts:413`). Only `projectedSessionForRole` (`utils.ts:390-402`) omits `studentId`. Any fix scoped to the `students` array alone would leave classmate ids, grades, and feedback exposed through these arrays.

Because the approved decision keeps the DOB fallback, `dob` is a password-grade secret system-wide, and denying student/parent access to this endpoint is the control on this chain. `firestore.rules:514` confirms no client-side path bypasses it.

### No consumer depends on the vulnerable behavior

No frontend code calls the `class-detail` channel. `useClassData` (`src/hooks/useClassData.ts:63-67, 115-119`) uses the `students` channel with `view: 'directory'`, which is routed through `authorizeStudentProjection`. `src/hooks/useClassData.test.ts:89` asserts `class-detail` is never called. All API consumers are internal web only; there is no mobile or Zalo mini-app client.

The student/parent branch of `readClassDetail` serves no UI. Denying it to those roles carries no regression risk, which is why the outright 403 was chosen over per-collection scoping.

### Existing tests already encode the intent

`api/read/action.test.ts:358-371` asserts that a parent reading `class-detail` receives no `contact` and no `faceImage`. The same test never considered `dob`, nor the `studentId` still present in the attendance/evaluation/report arrays. The security intent — keep classmate PII away from student/parent — was established but under-enforced. The 403 decision enforces it completely; this test is updated to assert 403 rather than a filtered payload.

### Field lists must not be edited (rejected alternative)

An earlier report suggested removing `dob` from `ACADEMIC_FIELDS`. This is rejected. `DIRECTORY_FIELDS` (`studentProjection.ts:32-37`) and `ATTENDANCE_FIELDS` (line 56) both spread `ACADEMIC_FIELDS`, so removing `dob` would strip it from `directory` and `attendance` too, breaking `src/lib/exports/exportAttendancePDF.ts:97` and the student detail modal for `admin`/`teacher`/`office`. The chosen 403 approach touches no field list, so staff projections are unaffected.

### Firestore Rules

- `firestore.rules:561-564`: `match /assignments/{id}/quiz_answers/{answerId} { allow read: if isAdmin() || isTeacher(); }` has no class scoping. Every teacher can read every quiz's answer key.
- `firestore.rules:552-559`: `assignments` `get`/`list` allow `isCurrentUserClass(resource.data.get('classId', null))` with no targeting filter. Targeting lives at `deliveryPolicy.assignedStudentIds`, gated by `deliveryPolicy.targetMode == 'selected_students'` (see `api/edu/action.test.ts:586-590`). A student in the class can read an assignment they were not assigned.

### Knowledge bank download is by design

`handleDownload` (`server/api/knowledge-bank/handlers/download.ts:11`) admits `['admin', 'teacher']` and signs a URL for any document by id. This is consistent with the product model, not a defect:

- `firestore.rules:619-622` already grants every teacher `get, list` over all of `knowledge_bank` directly from the client.
- `upload.ts:97-103` targets documents at a `grade`, `program`, or `classId` taxonomy, not at an owner.
- `delete.ts:45` is the only ownership-scoped operation (`data.uploadedBy !== user.uid && userRole !== 'admin'`).
- `src/pages/common/KnowledgeBank.tsx` is built around the shared Global Success curriculum, organized by program and grade, with no filter by uploader.

An ownership check would break the shared curriculum library. The accepted gap is the absence of a download trail.

### Phone reset is narrower than reported

`handleReset` (`server/api/auth/handlers/passwordManagement.ts:361-367`) does verify `normalizePhone(user.phone_number) === normalizePhone(studentData.contact)`, so an attacker must control the phone number on record. The real defect is at lines 343-351: a phone-verified caller supplies `type` freely, so whoever holds that number can reset the `student` password rather than only the `parent` password, for every student sharing the number, while bypassing the lookup-token step.

### Client audit log is log noise, not forgery

`handleLog` (`api/audit/[action].ts:693-747`) already validates `action` against `AUDIT_ACTIONS` (line 718), requires non-empty `collection` and `documentId` (lines 719-722), blocks `SERVER_ONLY_AUDIT_COLLECTIONS` (lines 726-730), rate-limits at 120/minute (line 704), and derives `userId`/`userRole`/`userName` from the verified token (lines 740-742). The actor cannot be forged. A caller can still write a self-attributed entry naming an arbitrary non-finance `collection` and `documentId`. That is log pollution.

### Out of scope, with reasons

- `c-level-manager-insights`, `c-lm-assessment`, and the level-manager teacher-enumeration finding: `level_manager` is absent from `AuthRole` and `ROLE_ALIASES` (`server/api/lib/auth/roles.ts`); `normalizeAuthRole` returns null and the role gate rejects. Only docs, `AUDIT_REPORT.md`, and stale JSON caches still mention it.
- `c-accounting-reset-course`: `handleResetCourse` permits `canManageFinance` deliberately; the error string reads "Only admins, office, or accounting can reset course". This is a product question, not an authorization bypass.
- `c-kb-download-idor` as originally framed: by design, per the evidence above.
- Removing the DOB fallback login: explicitly deferred by decision.

## Target architecture

### Group 1 — roster restriction (`readers.ts`)

`readClassDetail` uses an allowlist, not a denylist. At the top of the function, after `classId` is read and before `assertClassAccess`, it calls `requireRole(ctx, ['admin', 'teacher', 'office'])`, which throws 403 for every other role. `admin`, `teacher`, and `office` reach the existing body unchanged; their `directory`/`academic` split via `canReadStudentDirectory` is untouched.

The allowlist is deliberately chosen over denying `student`/`parent` specifically. `accounting` also currently reaches this endpoint: `assertClassAccess(..., 'read')` returns the class for `canManageFinance` roles at `authz.ts:129`, and `canManageFinance` is `admin || accounting` (`permissions.ts:20`). Because `canReadStudentDirectory` is `admin || teacher || office` only, `accounting` falls through to the `academic` projection, which includes `dob`. A denylist against `student`/`parent` would leave `accounting` reading the full roster with `dob`, and would let any future role do the same. The allowlist matches `authorizeStudentProjection`, which already restricts `academic` to `admin`/`teacher`/`office`, and closes the endpoint against unknown roles by default.

No projection selection, roster filtering, or per-collection scoping is involved. Because the deny happens before the reads, none of `students`, `attendance`, `evaluations`, `reports`, or `sessions` is ever assembled for disallowed roles, so the `studentId`/grade/feedback leaks through the non-roster arrays (`utils.ts:362, 379, 413`) are closed by construction rather than by projecting each one.

This breaks the chain: student/parent can no longer obtain another student's `dob` or `studentId` from this endpoint, so the DOB fallback has no credential source here. Their legitimate views (own dashboard, own tuition) are served by other channels that are unaffected.

### Group 2 — Firestore Rules

Firestore Rules are intended to authorize a query's potential result set rather than filter returned documents. The post-implementation emulator reproduction did not honor that boundary for this nested targeting predicate: the bare student class query succeeded and returned documents whose direct `get` was denied. `get` and `list` are therefore specified separately, and student/parent collection lists are denied instead of depending on query-analyzer parity.

**quiz_answers** (`firestore.rules:561-564`): replace `allow read: if isAdmin() || isTeacher()` with admin, or a teacher scoped to the parent assignment via `isTeacherClassScopedDoc(parentAssignment.data)`. The parent assignment is at `assignments/{assignmentId}`; resolve it with `get()`. A teacher unrelated to the assignment is denied on both `get` and `list`; a missing parent assignment denies.

Note the exact semantics of `isTeacherClassScopedDoc` (`firestore.rules:137-140`): it is true when the caller is the assignment's `teacherId` **owner** OR owns the assignment's `classId` class. It is "assignment owner or class owner," not strictly "the class's teacher." This is deliberate and matches how sibling collections (attendance, evaluations, submissions) are scoped in the same rules file. Consequence: for an assignment with `classId: class-1, teacherId: teacher-2`, both `teacher-1` (via class ownership) and `teacher-2` (via assignment ownership) can read its answers. The test suite exercises both branches with a fixture that separates `teacherId` from `classId` ownership.

**assignments** (`firestore.rules:552-559`): keep `get` allowing admin, office, class-scoped teacher, or a student/parent admitted by `studentCanReadAssignment`. For a student/parent, when the target document has `deliveryPolicy.targetMode == 'selected_students'`, require the caller's `studentId` to be in `deliveryPolicy.assignedStudentIds`. Direct `list` is staff-only: admin, office, or a class-scoped teacher. Semantics to encode and test:
- Assignment with no `deliveryPolicy`, or `targetMode != 'selected_students'`: treated as class-wide, current behavior.
- `targetMode == 'selected_students'` with `assignedStudentIds` missing or not a list: fail closed (deny).
- `get` of an assigned assignment: allow; of an unassigned one: deny.
- Every student/parent direct `list` is denied, including both a bare `classId` query and a `classId` plus `array-contains` query. This is intentional: the emulator allowed the bare query to return targeted-out and malformed documents, so query shape is not trusted as the authorization boundary.
- Staff list behavior is unchanged. Admin and office retain global list access; teacher lists remain constrained by `isTeacherClassScopedDoc(resource.data)` and their existing query shapes.

**Admin SDK dashboard path (the rule change is necessary but not sufficient).** The Firestore rule only governs direct client reads. `getParentDashboardPayload` (`server/api/lib/services/parentDashboardService.ts:185`) fetches all assignments by `classId` via the Admin SDK (`:217-218`) and returns them (`:241`) with no targeting filter, for both `student` and `parent` (`:190`). The Admin SDK bypasses Firestore Rules, so this path leaks targeted assignments regardless of the rule. It must be filtered in the service with `canStudentAccessAssignment` (`shared/assignmentDelivery.ts:56`), mirroring what `readAssignments` already does at `readers.ts:1356-1362`. This filter also gates `availableFrom`, so the dashboard becomes consistent with the main assignment list (future-dated assignments are hidden from students too). This is part of the Group 2 assignments fix, tested at the API level.

### Group 3 — knowledge bank download trail (fail-closed)

`handleDownload` records an audit entry before returning the signed URL, using `writeRequiredAuditLog` (`auditLog.ts:84`). If the audit write fails, that helper throws with `statusCode: 503`; the handler returns that error and does not return a URL. No issuance escapes the trail.

Ordering is: audit first, then generate the signed URL, then (attachment mode only) increment `downloadCount`. The `downloadCount`/`lastDownloadedAt` update (`download.ts:53-64`) happens only after a successful audit write, so a failed audit yields no URL and no counter increment. The counter's existing best-effort try/catch (a warning on failure) is retained, since counter accuracy is not the traceability guarantee.

The entry uses `verifyAuthContext` (`verifyAuth.ts:223`) for normalized role and name, and records the document id, `mode` (`inline` vs `attachment`), IP, and user-agent. Access rights are unchanged; no teacher loses a download while auditing is healthy.

### Group 4 — phone reset and audit log

**Backend.** `handleReset`'s phone-verified branch requires a valid `lookupToken`, matching what `handleRequest` already enforces at `passwordManagement.ts:82` ("Require a valid lookup challenge token — proves the caller passed phone validation in lookup-student"). This restores the skipped lookup step and binds the reset to a `studentDocId` whose phone was validated against `contact`.

**Frontend (required for the backend change to be safe).** The token exists locally at `useLoginHandlers.ts:709` but is never propagated on the phone path, and the reset call at `useLoginHandlers.ts:1091-1094` omits it. Without this, the backend change 403s every legitimate phone reset. Add:
- State/ref to hold the lookup token after `lookup-student` returns, set on the phone branch alongside `setTargetStudentDocId`/`setTargetStudentData`.
- Include the token in the `/api/v1/auth/reset` body.
- Clear the token on modal close, target change, and successful reset.

**`type` stays caller-selectable, deliberately.** `createLookupToken` (`shared.ts`) encodes only the student document id, so it cannot bind `type` without a token-format change across the lookup flow and its frontend. More importantly, the phone on `students.contact` belongs to the guardian, who legitimately recovers both the `student` and the `parent` account for that child; forcing `targetType = 'parent'` would break real recovery. The residual exposure is that whoever controls the number on record can reset either account for the students carrying that number — the guardian relationship the field encodes, not a privilege escalation. If `type` binding is wanted later, it requires extending the lookup token format and is its own change.

**Audit allowlist.** `handleLog` validates `collection` against an explicit allowlist, mirroring the existing `AUDIT_ACTIONS` treatment of `action` at `api/audit/[action].ts:718`. The allowlist is exactly the set the client legitimately sends today, confirmed from the `logAuditActivity` call sites:
- `system_crash` (`src/components/common/ErrorBoundary.tsx:33`)
- `allowed_teachers` (`useAdminDashboardData.ts:457`)
- `users` (`useAdminDashboardData.ts:480, 514, 554`)
- `blocked_teachers` (`useAdminDashboardData.ts:597`)

This limits the namespace only. Within an allowed collection a caller can still supply an arbitrary `documentId` and `action`, so the client audit endpoint remains crash/admin-telemetry, not a source of high-integrity records. High-integrity audit already comes from server-side mutation endpoints writing their own entries; that separation is preserved, not changed here.

### Face image finding

`c-face-image-idor` was rated conditional and hard to exploit. `studentFace.ts:40, 51` already enforces `student.teacherId !== user.uid` and `classData.teacherId !== user.uid` for non-admins. Investigated during Group 4; if no concrete exploit path survives — including a teacher who is not the owner and a storage-path mismatch — it is recorded as no-change with reasoning rather than fixed speculatively.

## Testing

**Group 1 — class-detail.** `api/read/action.test.ts`: assert `student`, `parent`, and `accounting` calling `class-detail` receive 403 (replacing the current assertion that student/parent receive a filtered payload at lines 358-371). The `accounting` case is the regression guard for the allowlist-over-denylist decision. Assert `admin`/`teacher` still receive `dob`, the full roster, and the `attendance`/`evaluations`/`reports` arrays, guarding the `exportAttendancePDF` path. `server/api/lib/student/studentProjection.test.ts` is unchanged; the field lists do not move. `useClassData.test.ts` stays green unmodified.

**Group 2 — Firestore Rules (emulator).**
- quiz_answers: class-owner teacher and assignment-owner teacher `get`/`list` allow (two branches, via a fixture separating `teacherId` from `classId`); unrelated teacher `get`/`list` deny; admin allow; student/parent deny; missing parent assignment denies for a teacher.
- assignments: `get` assigned allow (student and parent); `get` unassigned deny (student and parent); no-`deliveryPolicy` and non-`selected_students` behave class-wide; `selected_students` with missing OR mistyped (`assignedStudentIds` a string) fails closed; both bare `classId` and `classId` + `array-contains` student/parent lists deny; admin/office/teacher list and get behavior remains unaffected.

**Group 2 — parent-dashboard (API, Vitest).** A `parent`/`student` calling `parent-dashboard` receives class-wide and self-targeted assignments but not ones targeted only to others, nor malformed-targeted ones. This guards the Admin SDK path that Firestore Rules cannot.

**Group 3 — knowledge bank.** Both `inline` and `attachment` issuances write an audit entry with correct actor and mode; on audit-write failure the handler returns 503 and no URL (fail-closed).

**Group 4 — reset and audit.** Backend token matrix: missing, expired, tampered, wrong-student, and valid tokens. Frontend propagation: a test proving the token flows lookup → OTP → reset and is sent in the reset body, and is cleared on close/target-change/success. Audit allowlist: the four collections accepted; an arbitrary collection rejected; a `SERVER_ONLY_AUDIT_COLLECTIONS` collection still rejected.

**Face image.** A teacher who is not the owner is denied; a storage-path mismatch is denied.

Existing suites (`useClassData.test.ts`, `api/edu/action.test.ts`) must stay green unmodified; they encode behavior being preserved.

## Rollout

Group 1 (class-detail allowlist) closes the takeover chain and lands before the dependent hardening. Group 2 originally landed in two commits: `bfc4f965` contains both `quiz_answers` and assignment-targeting rules, while `c03fdb72` contains the parent-dashboard Admin SDK filter. The post-implementation Group 2 remediation lands as a third focused rules/test commit. It removes only student/parent direct assignment list access; no API or staff client migration is required because supported student/parent collection reads already use the filtered Admin SDK paths. Group 3 (download trail) is one commit. Group 4 is four commits: phone-reset backend token gate, frontend token propagation, audit-collection allowlist, and a face-image regression test; the two reset commits must deploy together (backend enforcement without frontend propagation 403s every legitimate phone reset).

**Branch base.** This work branches from `remove-level-manager-role`, not `main`, because the three out-of-scope `level_manager` conclusions depend on that branch's baseline (the role and its aliases being removed). After the base branch merges, rebase `security/roster-takeover-chain` onto the new `main` before landing. If Group 1 must land ahead of the base branch, cut it from `main` as its own branch and re-verify the `level_manager` conclusions against that baseline first.
