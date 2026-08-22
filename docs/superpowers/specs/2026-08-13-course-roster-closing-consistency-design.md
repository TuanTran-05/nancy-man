# Course Roster and Closing Consistency Design

**Date:** 2026-08-13

**Scope:** Class Detail student roster, Office Academic roster and summaries, and course-closing roster computation

## Problem

The application currently answers “who belongs to this course?” from two different sources:

- course closing reads `student_course_enrollments` for the class and current term;
- Class Detail and Office Academic can still read the compatibility projection `students.classId`.

That projection represents the student's current primary class. It cannot represent a student who legitimately attends two classes concurrently, and it no longer points to a completed course after the student moves on. As a result, course closing can correctly require fourteen final evaluations while the teacher roster and Office Academic show only thirteen students.

The verified production incident also shows why repairing the enrollment to make the counts agree is unsafe: the omitted student attended the closing class through its final taught session. The student belongs in the course roster and needs a final evaluation; the display roster is the stale side.

## Goals

1. Class Detail, Office Academic, and course closing derive course membership from the same term-scoped enrollment records.
2. A student whose profile points to another class still appears in every course they legitimately attended.
3. Office progress counts and missing-student IDs agree with the teacher's course-closing panel.
4. Existing authorization and role-based student projections remain unchanged.
5. The change does not activate the global canonical-read cutover or alter unrelated student-directory surfaces.

## Non-goals

- Changing attendance, evaluations, tuition, ledgers, or enrollment history.
- Automatically creating the missing final evaluation.
- Switching `_maintenance/student_identity_read_model` to `canonical_preferred` or `canonical_required`.
- Reworking global student headcounts or the general Students directory.
- Treating `students.classId` as a multi-class field.

## Considered Approaches

### 1. Shared term-scoped roster loader — selected

Create one server-side roster loader used by all three course surfaces. It reads matching `student_course_enrollments`, hydrates each unique student profile, and returns members grouped by class and term.

This fixes the source inconsistency directly, keeps the change scoped to course operations, and avoids a system-wide rollout change.

### 2. Activate canonical reads globally

Creating the maintenance control document or changing the production environment would make additional student surfaces enrollment-backed. This has a much larger blast radius and is intentionally governed by identity-normalization readiness checks. It is not appropriate for this incident.

### 3. Copy or rewrite profile `classId`

Changing `students.classId` to make one class visible would hide the student from the other concurrent class. Duplicating the profile would violate canonical identity and fragment attendance, finance, and evaluation history. This approach is rejected.

## Architecture

### Shared roster boundary

Add a focused helper under `server/api/lib/student/` that exposes a batch-oriented interface:

```ts
type CourseRosterScope = {
  classId: string;
  termStart?: string;
};

type CourseRosterMember = {
  studentDoc: DocumentSnapshot;
  enrollmentDoc: QueryDocumentSnapshot | null;
  source: 'enrollment' | 'legacy_profile';
};

async function loadCourseTermRosters(
  db: Firestore,
  scopes: CourseRosterScope[],
  options?: { transaction?: Transaction }
): Promise<Map<string, CourseRosterMember[]>>;
```

The map key is the class ID because each Office Academic class row represents its current `startDate`. The loader must:

- select enrollments whose `classId` and `termStart` match the requested scope;
- include roster statuses `trial`, `active`, `on_leave`, and `completed`;
- exclude `transferred` and `dropped`;
- de-duplicate profiles within one class roster by student ID;
- hydrate each unique student document once across a batch of classes;
- omit a missing profile consistently with the existing course-closing behavior while emitting a structured warning containing IDs, not student content;
- fall back to the legacy `students.classId` query only when a class has no usable `startDate`, preserving the current defensive behavior for malformed legacy classes.

The non-transactional batch path must query enrollment class IDs in Firestore-sized chunks and hydrate unique profiles once. It must not issue one complete roster workflow per class. The transactional single-class path remains available for course-closing approval and send guards.

### Course closing

Replace the private `readCourseRosterDocs` implementation in `server/api/classes/helpers/courseClosing.ts` with the shared loader. Preserve the existing required-evaluation filter, evaluation selection, fingerprints, exemptions, and send evidence logic.

This makes course closing the reference consumer of the shared boundary without changing its observable rules.

### Class Detail

`readClassDetail` must use the shared term-scoped roster for its `students` payload regardless of the global canonical-read rollout mode. This is a deliberate course-surface exception: the request already names a class and its current term, so `students.classId` is not an acceptable membership source.

Each projected roster row keeps the canonical student ID and role-based field allowlist, but its compatibility `classId` is scoped to the requested class. This lets existing client components render the member without changing `ClassStudentsTab` filtering or evaluation actions.

### Office Academic

`readOfficeAcademic` must load course rosters for all visible class rows in one batch. The grouped members replace `studentDocsByClass` as the input to `snapshotFromCourseClosingContext` and as the source of Office student rows.

For a student enrolled in two visible courses, the Office payload may contain two scoped rows with the same student ID and different `classId` values. The page always filters students by the selected class before rendering and sends actions by student ID plus class ID, so this represents two course memberships without duplicating identity.

Office summary fields remain derived from `CourseClosingSnapshot`:

- `eligibleStudentCount` equals `requiredStudentCount`;
- `finalEvaluationCount` equals the selected final evaluations for that roster;
- `missingEvaluationStudentIds` names the same students as the teacher panel;
- send eligibility continues to use the canonical course-closing approval and server guards.

## Data Flow

1. Read the visible class documents and their current `startDate` values.
2. Load matching enrollment documents for those class/term scopes.
3. Hydrate the unique student profiles referenced by those enrollments.
4. Project one role-safe student row per course membership.
5. Feed the same grouped membership into course-closing snapshot computation.
6. Return matching roster rows and progress counts to Class Detail or Office Academic.

No writes occur in this read path.

## Error Handling and Safety

- A missing class retains the existing 404 behavior.
- Missing or malformed term dates use the explicit legacy fallback; they do not scan every historical enrollment.
- Missing student profiles are logged with class, term, enrollment, and student IDs only.
- Firestore chunking respects query limits and de-duplicates IDs before reads.
- Role projections continue to remove finance, contact, or other restricted fields from teacher-facing payloads.
- The change must not mutate the canonical-read maintenance control document.

## Testing

Add regression coverage for the exact split-roster pattern:

1. A student profile points to class B while an `active` enrollment exists in class A for class A's current term.
2. Class Detail for class A includes that student even in `legacy_compare` mode.
3. Office Academic includes the student under class A and reports the same required/final counts as course closing.
4. The same student can also appear under class B without creating a duplicate profile identity.
5. A `transferred` or `dropped` class-A enrollment is excluded.
6. An enrollment from another term is excluded.
7. A class without a usable term start retains the legacy fallback.
8. Existing course-closing approval, send-guard, projection, and authorization tests remain green.

The implementation follows red-green-refactor: each new behavior is first represented by a failing server test, then satisfied with the smallest shared-loader and consumer changes.

## Acceptance Criteria

- The verified class roster displays fourteen students, including the concurrently enrolled student.
- Before the missing evaluation is entered, both teacher and Office show `13/14` and the same missing student.
- After the final evaluation is entered, both surfaces show `14/14` and course closing can proceed through its existing approval flow.
- No attendance, finance, enrollment, or identity-control documents are changed by the code deployment.
- Targeted tests, the relevant reader and course-closing suites, TypeScript checking, and the production build pass.
