# Safe Student Enrollment Backfill Design

## Context

The accounting student workspace is backed by `accounting_student_summaries`. A student's current class, enrollment status, course count, and current payment state are projected from `student_course_enrollments`, not directly from the legacy `students.classId` field.

Production inspection on 2026-07-31 found:

- 653 student documents and 191 canonical enrollment documents.
- 466 students with a legacy `classId` but no canonical enrollment.
- Of those 466 students, 328 had legacy status `active`, 31 `on_leave`, 86 `promoted`, and 21 `dropped`.
- The 359 `active` or `on_leave` students were the population relevant to the reported missing-current-class issue.
- 344 of those 359 had a class date range containing 2026-07-31; 15 did not have a safely identifiable current period.
- All six students returned by the search term `quyen` were `active` and belonged to the safely classifiable group.

These counts are diagnostic evidence, not an apply-time contract. The calendar date has since changed. Every production run must generate a new plan using the current Vietnam date and current source documents.

## Problem in the Existing Backfill

`scripts/backfill-student-course-enrollments.ts` currently combines the class's current date range, every entry in `class.terms`, ledgers, and `courseJoins`. For the 359-student diagnostic population, that algorithm estimated 607 new enrollments, including 395 historical-term enrollments. It could also infer more open enrollments than students because historical terms without a usable end date are treated as current.

Running that broad algorithm would invent history that is not supported by student-specific evidence and could produce multiple open enrollments. It must not be used for this repair.

## Decision

Implement a focused, conservative migration that creates at most one current enrollment for an unambiguous legacy student. Ambiguous and non-current records remain unchanged and are reported for manual review.

The migration repairs only the missing canonical relationship needed by accounting. It does not reconstruct historical enrollment history.

## Eligibility Rules

A student is eligible only when all conditions are true at dry-run and again at apply preflight:

1. The student has no document in `student_course_enrollments`.
2. `studentLifecycle` is not `archived`.
3. Legacy `enrollmentStatus` is exactly `active` or `on_leave`.
4. `classId` is a non-empty string and the referenced class exists.
5. The class has a valid `startDate` in `YYYY-MM-DD` format.
6. `class.startDate` is on or before the current Vietnam date.
7. `class.endDate` is either absent or a valid date on or after the current Vietnam date.

The migration excludes `promoted`, `dropped`, archived, missing-class, invalid-date, future-class, and ended-class records. Exclusions are counted by reason and are not written.

The migration deliberately ignores `class.terms` when selecting the current enrollment. Those entries represent historical periods and were the source of over-generation in the broad backfill. Ledgers and `courseJoins` may be included in the audit report as corroborating evidence, but they do not expand the write set.

## Enrollment Projection

Each eligible student produces exactly one deterministic candidate:

- `studentId`: student document ID.
- `classId`: current legacy `students.classId`.
- `termStart`: `class.startDate`.
- `termEnd`: valid `class.endDate`, otherwise `null`.
- `status`: `active` for legacy `active`; `on_leave` for legacy `on_leave`.
- `joinedAt`: valid `student.enrollmentDate` bounded to the class period; otherwise `class.startDate`.
- `endedAt`: `null`.
- `statusReason`: `safe_current_enrollment_backfill`.
- `source`: `backfill`.
- `confidence`: `inferred`.
- `statusChangedBy`: a versioned migration actor ID.
- `confirmedAt` and `confirmedBy`: `null`.

The document ID uses `makeStudentCourseEnrollmentId(studentId, classId, termStart)`. Candidate uniqueness is asserted by student ID as well as document ID. A plan containing two candidates for one student is invalid and cannot be applied.

## Components

### Pure planner

A pure function receives students, classes, existing enrollments, and a pinned Vietnam date. It returns:

- deterministic candidate actions sorted by student ID;
- exclusions grouped by explicit reason;
- invariant violations;
- source fingerprints required for apply-time drift detection.

It performs no network or filesystem writes and is covered by unit tests.

### Manifest

Dry-run writes a JSON manifest containing:

- migration version and actor ID;
- project and database IDs;
- pinned Vietnam date and generation timestamp;
- ordered candidate document IDs and projected fields;
- fingerprints of the relevant student and class source fields;
- exclusion counts and invariant results;
- SHA-256 checksum of the canonical candidate payload;
- `approved: false` by default.

Apply requires an explicitly approved manifest and an exact checksum match. Production credentials and access tokens are never written to the manifest or repository.

The pinned date must equal the current Vietnam date at apply time. A manifest cannot be carried across midnight; it must be regenerated and reviewed.

### Apply executor

Immediately before writing, the executor re-reads all targeted students, referenced classes, and canonical enrollments. It rebuilds the plan with the manifest's pinned date and aborts the entire apply when:

- any target student or class fingerprint changed;
- any target gained an enrollment;
- candidate IDs or payloads differ from the manifest;
- any invariant fails;
- the project or database ID differs;
- the pinned date no longer equals the current Vietnam date;
- the manifest checksum is invalid.

Writes use create-only preconditions so an existing document is never overwritten. Batches remain below Firestore limits. The executor records only successfully created IDs in a separate apply result used for verification and rollback.

### Summary rebuild

After enrollment verification succeeds, accounting summaries are rebuilt from canonical sources. Health is marked complete only when summary count equals student count, source version is current, and repair backlog is zero.

## Safety Invariants

The following conditions are mandatory before and after apply:

- zero updates or deletes to existing enrollment documents;
- at most one newly created enrollment per student;
- zero created enrollments for `promoted`, `dropped`, or archived students;
- zero created enrollments for ended, future, missing, or invalid class periods;
- zero students with more than one open canonical enrollment after apply;
- every created document passes `assertValidStudentCourseEnrollment`;
- created count equals the approved manifest candidate count;
- every created document exactly matches its approved candidate fields;
- no unrelated student, class, ledger, or payment document is changed.

Any failed invariant stops the workflow before summary rebuild and triggers investigation. It does not silently skip unexpected changes.

## Rollback

Rollback is scoped to the apply result, not to a query over all `source: backfill` records. It may delete only document IDs that:

1. were recorded as created by this migration run;
2. still have the expected migration actor and payload fingerprint;
3. have not been confirmed or manually modified since creation.

If any created document has changed, rollback stops and reports it for manual review rather than deleting it. After rollback, affected accounting summaries are rebuilt and the same post-run audits are repeated.

## Verification

### Automated tests

Tests must cover:

- eligible `active` and `on_leave` students;
- every exclusion reason;
- one candidate per student even when `class.terms` contains multiple periods;
- invalid, future, ended, and missing class dates;
- bounded and fallback `joinedAt` values;
- deterministic ordering, IDs, fingerprints, and checksums;
- idempotency when an enrollment already exists;
- manifest mismatch and source-drift aborts;
- create-only conflict handling;
- rollback refusal for modified or confirmed documents.

The focused test file, typecheck, and full relevant suite must pass before production dry-run.

### Production dry-run review

The fresh report must show:

- total source counts;
- candidate count by status and class;
- exclusion count by reason;
- candidate count per student, whose maximum must equal one;
- open-enrollment conflict count, which must equal zero;
- exact count and classification of the six `quyen` search results;
- manifest checksum and pinned date.

Unexpected count changes are investigated before approval. A count change caused solely by the new calendar date is still reviewed rather than automatically accepted.

### Post-apply audit

Verify created documents by ID and payload, rerun the planner to confirm zero remaining eligible candidates, and assert zero multiple-open-enrollment students. Rebuild all accounting summaries, verify the health document, and confirm the `quyen` results display their class, enrollment status, course count, and ledger-derived payment status correctly.

## Alternatives Rejected

### Run the broad v1 backfill

Rejected because it assigns class-level historical terms to every legacy student and can infer multiple open enrollments.

### Fall back to `students.classId` only in the accounting projection

Rejected because it would hide the missing canonical data while course counts, histories, payment matching, and other enrollment consumers remain inconsistent.

### Automatically repair ambiguous ended classes

Rejected because legacy `active` status alone cannot prove which period should be open when the referenced class period has ended. Those records require separate evidence and review.

## Success Criteria

The migration is successful when all approved candidates have exactly one valid canonical current enrollment, no existing or unrelated records were changed, all safety invariants pass, accounting summaries are complete, and the six reported `quyen` students display correct current-class and finance information. Ambiguous records remain unchanged with an actionable audit report.
