# Assignment Phase 11 Student Attempt Reliability Design

## Goal

Make student assignment attempts resilient and reviewable: students should not lose work
when the browser refreshes, network drops, or the submission modal closes, and after
submission they should see a clear review state that respects delivery result-release
rules.

## Current Evidence

The codebase already has the core pieces Phase 11 should build on:

- Student submissions are created through `handleAssignmentSubmit` in
  `server/api/edu/handlers/assignments.ts`.
- Assessment v2 answer normalization and scoring live in
  `shared/assignmentAssessment.ts`.
- Students answer Assessment v2 questions through
  `src/components/assignments/assessmentRunner/StudentAssessmentRunner.tsx`.
- Student answer state is currently held in `src/pages/common/Assignments.tsx` while
  `SubmissionModal` is open.
- Review uses `StudentSubmissionReviewModal` and
  `AssessmentSubmissionReview`.
- Delivery targeting and result release are enforced through
  `shared/assignmentDelivery.ts`.

The weak point is attempt lifecycle reliability. A student has no durable in-progress
attempt state before final submission. Closing or refreshing can drop local React state.

## Chosen Approach

Use a thin attempt-draft layer instead of replacing the existing `submissions` model.

Phase 11 creates a student-owned draft snapshot for the current assignment attempt. The
snapshot is saved locally first, synced to the server while the student is working, and
cleared after a successful submission. Final submissions still use the existing
`submissions` collection and grading flow.

This is intentionally smaller than a full attempt lifecycle model. It solves the highest
risk user problem without forcing reports, grading, read channels, and dashboards to
move to a new domain model.

## Scope

Phase 11 includes:

- Shared attempt-draft model and normalization helper.
- Student-only server endpoints to get, save, and clear an assignment attempt draft.
- Server-side access checks using assignment class, delivery policy, selected-student
  targeting, and availability.
- Client API wrapper for draft get/save/clear.
- Autosave hook with localStorage fallback and debounced server sync.
- Resume behavior when a saved draft exists.
- Clearing draft state after successful final submission.
- Read projection fixes so review has the fields it needs from initial read payloads.
- Review UI improvements for Assessment v2:
  - awaiting grading,
  - graded result,
  - answers hidden until release,
  - global teacher feedback,
  - per-question feedback.

## Non-Goals

Phase 11 does not include:

- A separate full `attempts` collection with statuses like `started`, `submitted`,
  `returned`, and `resubmitted`.
- Teacher return-to-student workflow.
- Per-student reopened attempts.
- AI feedback.
- New analytics warehouse.
- Replacing existing `submissions`.
- Changing Phase 9 delivery policy semantics.

## Data Model

Create a new collection:

```txt
assignment_attempt_drafts/{assignmentId}_{studentId}
```

Suggested document shape:

```ts
interface AssignmentAttemptDraft {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  classId: string;
  teacherId: string;
  ownerUid: string;
  content: string;
  quizAnswers: QuizAnswer[];
  assessmentAnswers: AssessmentAnswer[];
  attemptNumber: number;
  status: 'in_progress';
  createdAt: string;
  updatedAt: string;
  clientSavedAt?: string;
}
```

Rules:

- Document id is deterministic per assignment and student.
- Only the authenticated student user for that student id can read or write the draft.
- Draft save is allowed only when the student can access the assignment.
- Draft save should be rejected when the assignment is no longer submittable.
- Draft payload is sanitized with the same shared answer normalization used by final
  submission.
- Saving a draft never increments `attemptNumber`.
- Final submission clears the matching draft.

## API Design

Add student-only actions under the existing `api/edu/[action].ts` router:

```txt
GET  /api/v1/edu/assignment-attempt-draft-get?assignmentId=...
POST /api/v1/edu/assignment-attempt-draft-save
POST /api/v1/edu/assignment-attempt-draft-clear
```

Responses:

```ts
// get
{ success: true, data: AssignmentAttemptDraft | null }

// save
{ success: true, data: AssignmentAttemptDraft }

// clear
{ success: true }
```

All endpoints should:

- verify student auth,
- load user context,
- load assignment,
- enforce assignment access through `canStudentAccessAssignment`,
- verify `students/{studentId}` belongs to the assignment class,
- use a deterministic draft id,
- never trust student-supplied `studentId`, `teacherId`, `classId`, or `attemptNumber`.

## Client Flow

When a student opens an assignment:

1. `Assignments.tsx` opens `SubmissionModal`.
2. The autosave hook checks localStorage and server draft.
3. If either draft exists, the newest draft is hydrated into `submissionData`,
   `quizAnswers`, and `assessmentAnswers`.
4. The modal shows a compact "saved draft restored" message.
5. While the student edits answers, localStorage updates immediately and server save is
   debounced.
6. On successful final submit, localStorage and server draft are cleared.
7. Closing the modal does not clear the saved draft.

Autosave status should be visible but quiet:

- `Saving...`
- `Saved`
- `Offline draft saved`
- `Could not sync draft`

## Review Flow

Student review should make the state explicit:

- If submission is `submitted` and Assessment v2 needs manual grading, show "Awaiting
  teacher grading".
- If submission is `graded`, show score and global feedback when available.
- If correct answers are not released, show a result-release notice instead of trying to
  fetch answer keys.
- When correct answers are released, continue using the secured answer-key endpoint.
- Per-question feedback from `assessmentScore.questionScores[].feedback` should be
  shown in read-only review mode.

## Security And Privacy

- Drafts are private to the student and not read by teachers in Phase 11.
- Drafts contain student answer content, so read/write must be server-authorized.
- Realtime deltas are not needed for drafts in Phase 11.
- Correct answers remain outside student-safe assignment payloads.
- Draft endpoints should rate-limit saves enough to prevent accidental write storms.

## Testing Strategy

Use TDD.

Shared tests:

- deterministic draft id,
- payload normalization for essay, legacy quiz, and Assessment v2,
- stale or invalid answers removed,
- attempt number calculation from existing submissions.

API tests:

- save rejects unauthenticated or non-student requests through router auth,
- save rejects unavailable or untargeted assignments,
- save ignores student-supplied identity fields,
- get returns only the current student's draft,
- clear deletes only the current student's draft,
- final submit deletes the matching draft.

Client tests:

- client API calls correct endpoints,
- autosave hook hydrates newest local/server draft,
- autosave writes local immediately and server after debounce,
- submit clears local/server draft,
- closing modal keeps draft for resume,
- review modal shows awaiting grading, hidden answers, score, global feedback, and
  per-question feedback.

Completion gates:

```txt
npx.cmd vitest run shared/assignmentAttemptDraft.test.ts api/edu/action.test.ts src/lib/api/assignmentAttemptDraftApi.test.ts src/components/assignments/attempt/useAssignmentAttemptAutosave.test.tsx src/components/assignments/SubmissionModal.test.tsx src/components/assignments/StudentSubmissionReviewModal.test.tsx src/components/assignments/assessmentReview/AssessmentSubmissionReview.test.tsx src/pages/common/Assignments.test.tsx api/read/action.test.ts
npm.cmd run typecheck
git diff --check
npm.cmd run test
npm.cmd run build
```

## Acceptance Criteria

- Students can close or refresh during an in-progress assignment and resume the latest
  saved answers.
- Autosave has local fallback and server sync.
- Final submission still creates normal `submissions` documents.
- Successful final submission clears the matching attempt draft.
- Students cannot save or read drafts for assignments they cannot access.
- Review UI clearly distinguishes awaiting grading, graded, and answers-not-released
  states.
- Existing Assessment v2 grading and Phase 9 delivery policy behavior remain intact.
