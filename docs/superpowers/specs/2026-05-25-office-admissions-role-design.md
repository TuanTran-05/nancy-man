# Office Admissions Role Design

## Purpose

Add an `office` staff role for academic operations and admissions. Office users can manage classes and students like admins for academic records, but they cannot create, block, unblock, or otherwise manage staff accounts. Office users also get an admissions workflow that creates or reactivates trial students, lets teachers review them after two attended trial sessions, and archives rejected trial records.

## Decisions Locked With Product Owner

- Admissions profile matching requires all three fields to match after normalization: student name, date of birth, and phone number.
- A matched historical student is not activated immediately. Re-admission always starts with `studentLifecycle: "trial"`.
- Two trial sessions are counted from the student's own attendance records. Only `present` and `late` count. `absent` does not count.
- Office navigation is limited to Classes, Students, Admissions, and Profile.
- Admin creates office accounts from the existing staff creation flow by selecting role "Office".
- Trial students cannot log in through student or parent accounts.
- After two counted trial sessions, the teacher prompt remains visible until the teacher accepts or rejects the student.
- If the teacher rejects the student, the student moves to `studentLifecycle: "archived"` and `classId`/`teacherId` are cleared so the record goes to a shared archive.

## Current System Context

Roles are currently defined in several places:

- Frontend route role type: `src/app/types.ts`
- Backend auth roles: `api/lib/auth/roles.ts`
- Staff account role helpers: `api/auth/handlers/shared.ts`
- Staff creation modal local type: `src/components/CreateStaffModal.tsx`

Student statuses currently support only `active`, `on_leave`, `dropped`, and `promoted`:

- Frontend type: `src/types.ts`
- Backend validation: `api/lib/validation/validations.ts`
- Status filtering and badges: `src/pages/common/Students.tsx`, `src/components/ClassStudentsTab.tsx`, and class counts in `src/pages/common/Classes.tsx`

Class and student write access is hard-coded around `admin` and owner teachers in:

- `api/classes/[action].ts`
- `api/students/[action].ts`
- `api/lib/services/classService.ts`
- read authorization helpers in `api/lib/auth/authz.ts`

Session records already exist in `class_sessions`, but trial completion will be based on attendance, not class session confirmation.

## Role Model

Add `office` to staff roles and user roles.

Office is an academic operations role:

- Can read, create, update, and soft-delete classes.
- Can read, create, update, status-change, import, and soft-delete students.
- Can use the Admissions page and related API actions.
- Can read enough teacher/class metadata to assign trial students to classes.
- Cannot access `/admin`, staff password reset screens, audit logs, finance, knowledge bank, messages, or substitute requests unless separately granted later.
- Cannot call staff account mutation APIs. Staff management remains admin-only.

Backend authorization should use explicit permission helpers instead of repeating role checks:

- `canManageAcademicRecords(role)` returns true for `admin` and `office`.
- `canManageStaff(role)` returns true only for `admin`.
- `canManageFinance(role)` remains `admin` and `accounting`.
- Teacher-owned write rules remain teacher-specific and should not accidentally expand to all office-like roles.

This prevents office from inheriting admin-only staff permissions while keeping class/student write access clear.

## Permission Matrix

This matrix is the source of truth for route guards, backend API guards, visible navigation, audit expectations, and tests.

| Capability                          | Admin | Office | Teacher             | Accounting        | Level Manager | Student           | Parent              |
| ----------------------------------- | ----- | ------ | ------------------- | ----------------- | ------------- | ----------------- | ------------------- |
| View all classes                    | Yes   | Yes    | No                  | No                | Scoped level  | No                | No                  |
| View own/linked classes             | Yes   | Yes    | Assigned only       | No                | Scoped level  | Own class         | Child class         |
| Create class                        | Yes   | Yes    | No                  | No                | No            | No                | No                  |
| Update class academic fields        | Yes   | Yes    | No                  | No                | No            | No                | No                  |
| Update own class operational status | Yes   | Yes    | Assigned only       | No                | No            | No                | No                  |
| Soft-delete class                   | Yes   | Yes    | No                  | No                | No            | No                | No                  |
| View students                       | Yes   | Yes    | Assigned only       | Finance view only | Scoped level  | Self              | Child               |
| Create official student             | Yes   | Yes    | No                  | No                | No            | No                | No                  |
| Create/reactivate trial admission   | Yes   | Yes    | No                  | No                | No            | No                | No                  |
| Update student academic profile     | Yes   | Yes    | Assigned only       | No                | No            | Self profile only | No                  |
| Soft-delete/drop student            | Yes   | Yes    | Assigned only       | No                | No            | No                | No                  |
| Accept/reject trial                 | Yes   | No     | Assigned class only | No                | No            | No                | No                  |
| Finance                             | Yes   | No     | No                  | Yes               | No            | No                | Parent tuition only |
| Staff account create/block/unblock  | Yes   | No     | No                  | No                | No            | No                | No                  |
| Audit log                           | Yes   | No     | No                  | No                | No            | No                | No                  |
| Knowledge bank                      | Yes   | No     | Yes                 | No                | No            | No                | No                  |
| Messages                            | Yes   | No     | Yes                 | No                | No            | No                | No                  |

## Staff Account Creation

The existing Create Staff modal will add "Office" as a selectable role. Only admins can open the screen and call the create staff endpoint.

Backend staff creation will accept `office` as a valid createable staff role. The generated account should store `role: "office"` in the staff user document and allowed staff record. The email naming convention can use an office suffix such as `.office@nancy.com`, but authorization must come from the admin-created allowed staff record, not from arbitrary self-registration by suffix.

Office users must not see staff account management UI and must receive `403` if they attempt staff mutation APIs directly.

## Student Lifecycle And Enrollment Model

Admissions state should not be modeled only as `enrollmentStatus`. Add a separate lifecycle field:

- `studentLifecycle: "lead" | "trial" | "enrolled" | "archived"`

Keep `EnrollmentStatus` for enrolled-student operational state:

- `active`: official enrolled student currently studying.
- `on_leave`: temporarily paused official student.
- `dropped`: former official student who stopped studying.
- `promoted`: historical promoted record kept by the existing course flow.

Lifecycle rules:

- Existing records without `studentLifecycle` are interpreted through a compatibility helper.
- Missing lifecycle with no `enrollmentStatus`, `active`, `on_leave`, or `promoted` derives to `enrolled`.
- Missing lifecycle with `enrollmentStatus: "dropped"` derives to `archived` with dropped-history semantics.
- New trial records use `studentLifecycle: "trial"` and do not rely on `enrollmentStatus`.
- Accepted trial records become `studentLifecycle: "enrolled"` and `enrollmentStatus: "active"`.
- Rejected trial records become `studentLifecycle: "archived"` and should not keep `classId`/`teacherId`.
- Officially dropped enrolled students become `studentLifecycle: "archived"` and `enrollmentStatus: "dropped"`.

The implementation should add a shared lifecycle/status helper instead of continuing to treat missing `enrollmentStatus` as active everywhere. This is required because current UI helpers default missing status to active, which would misclassify trial records.

Student/parent authentication and blocked-status checks must treat `studentLifecycle: "trial"` and `studentLifecycle: "archived"` as non-login lifecycle states. Existing checks for `dropped` and `isRevoked` are not sufficient because reactivated dropped students may have old linked accounts.

## Trial Review State Machine

Persist an explicit `trialReviewStatus` so the system does not infer workflow state only from attendance count.

Allowed values:

- `pending_sessions`: trial student has not yet reached two counted attended sessions.
- `pending_teacher_review`: student reached two counted attended sessions and needs teacher decision.
- `accepted`: teacher/admin accepted the trial.
- `rejected`: teacher/admin rejected the trial.

Transitions:

- Admission creates or reactivates a student with `studentLifecycle: "trial"` and `trialReviewStatus: "pending_sessions"`.
- Attendance writes recompute the student's trial count. When count reaches 2, update `trialReviewStatus` to `pending_teacher_review`.
- Class detail can defensively compute the same count and display the prompt when the persisted state is stale, but the backend mutation remains the authority for decisions.
- Accept is allowed only from `pending_teacher_review` or from a stale `pending_sessions` record whose current attendance count is already at least 2.
- Reject follows the same rule.
- Accepted/rejected are terminal for that trial attempt.

## Admissions Workflow

Create a dedicated Admissions page and a dedicated `/api/v1/admissions/*` backend module. Admissions logic should not be hidden inside `students/create` or `students/update`; the student APIs remain responsible for normal student CRUD.

### Form Fields

Office enters:

- Student name.
- Date of birth.
- Grade.
- Student phone number.
- Target class.

The target class determines `classId` and `teacherId`.

### Matching

Backend normalizes:

- Name: trim, collapse spaces, lowercase, strip Vietnamese diacritics for comparison.
- Date of birth: exact `YYYY-MM-DD`.
- Phone: normalize Vietnamese phone formatting, remove spaces, compare canonical phone.

A historical match requires all three normalized values to match.

Automatic reuse requires a unique exact historical match. Eligible historical records are:

- `studentLifecycle: "archived"` with `enrollmentStatus: "dropped"`
- `studentLifecycle: "archived"` with `archiveReason: "trial_rejected"`
- legacy records whose derived lifecycle is archived

If an exact match exists in a current state (`studentLifecycle: "trial"` or `studentLifecycle: "enrolled"`), the request should fail with `409` so office does not create a duplicate current record. If multiple eligible historical records match exactly, fail with `409` and require cleanup before admission.

The search endpoint should also return `possibleMatches[]` for near matches. Possible matches do not override the product decision that automatic matching requires all three fields. They only give office a safe manual review path when, for example, the phone number changed or the name has minor spelling differences.

Possible match signals:

- normalized name + DOB match but phone differs
- normalized phone + DOB match but name differs
- normalized name + phone match but DOB differs

The create/reactivate endpoint may accept an explicit `selectedHistoricalStudentId` chosen by office from `possibleMatches[]`. Backend must still verify the selected record is archived before reactivation.

### Reactivate Historical Student

When a dropped or archived record matches:

- Reuse the existing student document.
- Set `studentLifecycle: "trial"`.
- Set `trialReviewStatus: "pending_sessions"`.
- Clear `isRevoked`.
- Assign `classId` and `teacherId` from the selected class.
- Update `contact`, `grade`, and admission metadata.
- Preserve original `studentId` and historical audit trail.

### Create New Trial Student

When no historical record matches:

- Create a new student document.
- Generate the next student code using the existing student ID generator.
- Set `studentLifecycle: "trial"`.
- Set `trialReviewStatus: "pending_sessions"`.
- Assign `classId` and `teacherId`.
- Store admission metadata.
- Do not create student or parent login credentials as part of admissions.

### Admission Metadata

Store these fields on the student record:

- `studentLifecycle: "trial"`
- `admissionStatus: "trial"`
- `admittedAt`
- `admittedBy`
- `trialStartedAt`
- `trialClassId`
- `trialTeacherId`
- `trialRequiredSessions: 2`
- `trialReviewStatus: "pending_sessions"`
- `trialDecisionAt` when decided
- `trialDecisionBy` when decided
- `trialDecisionNote` when rejected or accepted with note

`trialClassId` and `trialTeacherId` preserve the trial history even if `classId` and `teacherId` are cleared after rejection.

## Immutable Admissions History

Create an append-only `admissions_history` collection for admission lifecycle events. This complements the existing audit log: audit log records system writes, while admissions history is a student-facing business timeline.

Each entry stores:

- `studentId`
- `action`: `created_trial`, `reactivated_trial`, `possible_match_selected`, `class_assigned`, `class_changed`, `teacher_review_ready`, `teacher_accepted`, `teacher_rejected`, `archived`
- `actorId`
- `actorRole`
- `timestamp`
- `classId` when relevant
- `teacherId` when relevant
- `trialSessionCount` when relevant
- `note` when provided
- `metadata` for non-sensitive structured details

Admissions history is append-only through backend APIs. The first implementation should not expose edit/delete operations for this collection.

## Teacher Trial Review

Teachers see trial students in the class roster. Trial students should have a distinct badge such as "Trial" or "Hoc thu" and should be grouped or highlighted as new students.

Trial session count is computed from attendance records:

- Filter by the trial student's document id.
- Filter by the active trial class.
- Count unique dates where attendance status is `present` or `late`.
- Ignore `absent`.
- Count only attendance on or after `trialStartedAt` when available.

When the count reaches 2 and `trialReviewStatus` is `pending_teacher_review`, show a persistent prompt in the teacher's class view.

Teacher actions:

- Accept: update student to `studentLifecycle: "enrolled"`, set `enrollmentStatus: "active"`, set `admissionStatus: "accepted"`, set `trialReviewStatus: "accepted"`, keep `classId` and `teacherId`, and write audit/history entries.
- Reject: update student to `studentLifecycle: "archived"`, set `admissionStatus: "rejected"`, set `trialReviewStatus: "rejected"`, set `archiveReason: "trial_rejected"`, clear `classId` and `teacherId`, preserve `trialClassId`/`trialTeacherId`, and write audit/history entries.

Only the assigned teacher and admins should be able to make the trial decision. Office can view the admissions state but does not decide for the teacher in this version.

## Class Capacity And Trial Slots

The current `Class` type does not define `maxStudents`, so the first implementation should not invent hard capacity enforcement unless product explicitly adds class capacity management. The domain rule is still defined now to prevent inconsistent future behavior:

- Trial students count toward temporary class occupancy.
- Class displays should distinguish `currentActiveStudents` and `currentTrialStudents`.
- If a class has `maxStudents` now or later, active + trial students count against that capacity.
- Rejected trial students release the temporary slot when `classId`/`teacherId` are cleared.
- A future optional `trialCapacityBuffer` can allow controlled overbooking, but it is out of scope for this implementation.

## Frontend Navigation

Add office navigation:

- Classes: `/classes`
- Students: `/students`
- Admissions: `/admissions`
- Profile: `/profile`

Root redirect:

- `office` users should land on `/admissions` or `/classes`. Use `/admissions` because admissions is the unique role-specific workflow.

Routes:

- `/classes` and `/students` allow `admin`, `teacher`, and `office`.
- `/classes/:classId` allow `admin`, `teacher`, and `office`, with UI adjusted so office can inspect and manage rosters but does not see teacher-only attendance controls unless explicitly needed.
- `/admissions` allow `admin` and `office`.
- `/admin`, `/audit-log`, `/tuition`, `/knowledge-bank`, `/messages`, `/substitute-requests`, and staff reset routes do not allow `office`.

## Frontend UI Changes

### Classes

Office should see all classes, not only teacher-owned classes. Office can create, edit, status-change, and soft-delete classes. The UI should treat office like admin for academic class management, but without admin-only system/staff content.

Class student counts should include `trial` separately and should not count `archived` as class-bound because archived records clear class ownership.

### Students

Office should see all students and can create/edit/delete/status-change students. Status filters and badges need `trial` and `archived`.

The existing student create/edit flow can continue to create official active students. The new Admissions page is the required path for trial creation.

### Admissions

Admissions page should be a focused form plus recent admissions list:

- Form for name, DOB, grade, phone, class.
- Submit result should state whether the system reused a historical student or created a new trial student.
- Search result should show exact historical match and `possibleMatches[]` separately.
- Office can pick a possible archived match explicitly or continue creating a new trial student when no exact current conflict exists.
- Recent list shows student, class, trial count, decision status, and current status.

### Class Detail

Class roster should include trial students. Trial students should not be hidden by active-only filters.

When trial count is 0 or 1, show count progress. When trial count reaches 2 and decision is pending, show accept/reject controls to the assigned teacher.

## Backend API Changes

Add a new admissions API module:

- `GET /api/v1/admissions/search-historical`
- `POST /api/v1/admissions/create-trial`
- `POST /api/v1/admissions/trial-decision`
- `GET /api/v1/admissions/recent`

`admissions/search-historical`, `admissions/create-trial`, and `admissions/recent` allowed roles:

- `admin`
- `office`

`admissions/trial-decision` allowed roles:

- `admin`
- assigned `teacher`

Do not overload `students/create` for admissions because normal student creation creates active students today. Keeping admissions separate reduces accidental active enrollment.

Class APIs should allow `office` for class CRUD actions, but staff/accounting/system actions should stay restricted. Student APIs should allow `office` for student academic mutations, imports, and status changes. Staff APIs must remain admin-only.

Frontend navigation and route guards are UX only. Every admissions, class, student, staff, and finance API must independently enforce the permission matrix above.

## Audit Logging

Write audit logs for:

- Office-created trial student.
- Office-reactivated historical student.
- Office-selected possible historical match.
- Trial decision accepted.
- Trial decision rejected.
- Any class/student CRUD by office.
- Trial class reassignment or archive.

Audit metadata should include:

- `admissionMode: "created" | "reactivated"`
- `matchedStudentId` when reactivated.
- `selectedHistoricalStudentId` when office manually chooses a possible match.
- `trialClassId`
- `trialTeacherId`
- `trialSessionCount`
- `decision`

Every audit-significant admission action should also append to `admissions_history`.

## Testing Strategy

Backend tests:

- Permission matrix tests cover admin, office, teacher, accounting, level manager, student, and parent for representative endpoints.
- `office` can create/update/delete classes and students.
- `office` cannot call staff create/block/unblock APIs.
- Admissions exact match on name + DOB + phone reuses an archived/dropped record and sets `studentLifecycle: "trial"`.
- Admissions no exact match creates a new record with `studentLifecycle: "trial"` when there is no current conflict.
- Admissions exact match with existing current lifecycle returns `409`.
- Admissions search returns `possibleMatches[]` for near matches without auto-reactivating them.
- Admissions create with `selectedHistoricalStudentId` revalidates that the selected record is archived.
- Trial count uses attendance `present` and `late`, ignores `absent`.
- Attendance mutation moves `trialReviewStatus` from `pending_sessions` to `pending_teacher_review` once count reaches 2.
- Teacher accept moves lifecycle from `trial` to `enrolled` and enrollment status to `active`.
- Teacher reject moves lifecycle from `trial` to `archived` and clears `classId`/`teacherId`.
- Student/parent auth rejects `studentLifecycle: "trial"` and `"archived"` linked accounts.
- Admissions actions append immutable `admissions_history` entries.
- If class capacity is present, trial students count toward occupied capacity.

Frontend tests:

- Office sidebar only shows Classes, Students, Admissions, Profile.
- Office routes allow `/classes`, `/students`, `/admissions` and block `/admin`.
- Admissions form calls the admissions API and displays created/reactivated/manual possible-match result.
- Class roster displays trial students and the trial decision prompt after two counted attendance records.
- Class roster separates active and trial counts.

Manual verification:

- Admin creates an office account from staff creation.
- Office logs in and sees only the intended nav items.
- Office admits a new trial student into a class.
- Teacher marks two present/late attendance records.
- Teacher accepts and sees the student become active.
- Repeat with rejection and confirm the record is archived and removed from class roster.
- Confirm `admissions_history` shows created/reactivated and accepted/rejected events.

## Out Of Scope

- Automatic archival when a teacher ignores a trial prompt.
- Office deciding trial outcomes on behalf of teachers.
- Parent/student trial access.
- Full CRM pipeline stages beyond the current form.
- Finance, messaging, knowledge bank, audit, or staff-management access for office.
- Bulk admissions import.
- Hard class capacity configuration UI, because the current `Class` model has no `maxStudents`.
- Automatic fuzzy matching. Possible matches require office selection.

## Risks And Mitigations

- Risk: Office accidentally receives admin-only staff power through reused admin checks.
  - Mitigation: use explicit permission helpers and keep staff mutation APIs admin-only.
- Risk: Reactivated dropped students with old linked accounts can log in during trial.
  - Mitigation: block student/parent auth for `studentLifecycle: "trial"` and `"archived"`.
- Risk: Duplicate student history from repeated admissions.
  - Mitigation: strict exact automatic matching, `possibleMatches[]` for manual review, and `409` on current lifecycle duplicate states and duplicate historical matches.
- Risk: Trial prompt appears too early.
  - Mitigation: count only the student's attendance records with `present` or `late`.
- Risk: Rejected archived records lose useful context when class ownership is cleared.
  - Mitigation: preserve `trialClassId` and `trialTeacherId` as history fields.
- Risk: Lifecycle and enrollment status drift apart.
  - Mitigation: centralize lifecycle derivation/update helpers and test all lifecycle transitions.
- Risk: Permission matrix and backend route guards drift.
  - Mitigation: write permission matrix tests against representative APIs and do not rely on frontend menu visibility.
