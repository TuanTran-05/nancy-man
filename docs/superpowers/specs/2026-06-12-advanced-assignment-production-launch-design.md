# Advanced Assignment Production Launch Design

## Goal

Turn the advanced assignment authoring workbench from a blocked/coming-soon feature into
a production-ready teacher workflow.

The feature should feel like Gmail drafts: a teacher can start creating an advanced
assignment, leave the page or close the browser, and later resume the same unfinished
work from a quiet draft list on the Assignments page.

## Current Context

The codebase already has most of the technical foundation:

- Assessment v2 schema, private answer-key extraction, student-safe projection, student
  runner, grading, and review flows.
- Advanced authoring workbench route and components.
- Local and server draft sync helpers.
- Server endpoints for `assignment-draft-save`, `assignment-draft-list`,
  `assignment-draft-get`, `assignment-draft-delete`, and `assignment-draft-publish`.
- Question bank, media bank, import preview, import templates, delivery policy, and
  publish readiness components.
- A temporary `AssignmentAdvancedComingSoon` route gate currently prevents users from
  opening the unfinished workbench.

This design does not replace those foundations. It completes and hardens them for a
teacher-only production launch.

## Decisions

- Launch officially after tests pass; do not keep a beta gate.
- Only teachers can create, edit, list, delete, or publish advanced assignment drafts.
- Admin, level-manager, student, parent, accounting, and office users must not access the
  advanced authoring route or draft APIs.
- Keep the existing basic assignment modal unchanged.
- Replace the coming-soon route with the full-page `AssignmentAuthoringWorkbench`.
- Add a Gmail-style draft list inside the existing Assignments page.
- Support all response modes as production-ready:
  - `multiple_choice`
  - `short_answer`
  - `long_answer`
  - `speaking_recording`
  - `file_upload`
- Use delivery policy result-release rules for both auto-graded and manually graded
  results.

## Non-Goals

This launch does not include:

- AI question generation.
- AI speaking or writing scoring.
- Randomized question pools.
- A new assignment domain model.
- Replacing legacy essay/quiz assignments.
- Public shared marketplace UX for reusable bank content.
- Teacher return-to-student revision workflows.
- A full visual redesign of the whole Assignments page.

## Product Workflow

### Create

1. A teacher opens `/assignments`.
2. The teacher clicks `Add advanced assignment`.
3. The app opens `/assignments/advanced/new`.
4. The workbench creates a draft immediately using the existing blank authoring draft
   model.
5. Every meaningful edit is saved locally first and then synced to the server.

### Resume

1. The teacher opens `/assignments`.
2. A compact `Drafts` section lists unfinished advanced assignment drafts.
3. Each draft row shows enough metadata to identify the work:
   - title or fallback "Untitled draft",
   - class name or missing-class state,
   - due date or missing-due-date state,
   - question count,
   - last updated time,
   - sync/readiness state.
4. Clicking the row or `Open` navigates to `/assignments/advanced/:draftId`.
5. The workbench restores local draft data first, then reconciles with the server draft.

### Delete

1. A teacher can archive/delete an unfinished draft from the draft list.
2. The UI confirms before deleting.
3. The server marks the draft `archived`.
4. The row disappears from the draft list.
5. Any matching local recovery copy is cleared.

### Publish

1. The teacher clicks `Publish`.
2. The workbench runs local validation.
3. The latest local draft is saved to the server first.
4. The server publishes the saved draft into a real assignment through the existing
   assignment create flow.
5. Private Assessment v2 keys stay in the assignment private subcollection.
6. The draft is marked `published` with `publishedAssignmentId`.
7. The local recovery copy is cleared.
8. The teacher returns to `/assignments`.
9. The published assignment appears through the normal assignments read/realtime flow.

## Assignments Page UX

The draft list should be utilitarian and low-noise, similar to an email draft folder.

Layout rules:

- Place the draft list near the top of the teacher Assignments page, close to the create
  actions.
- Use rows, not promotional cards.
- Hide the section when there are no drafts unless the user has just created one or a
  fetch error needs to be shown.
- Keep the existing published assignment list visually dominant after the draft section.
- Avoid the previous blue marketing-style panel treatment.

Row behavior:

- The row itself is clickable.
- `Open` is available for clarity.
- `Delete`/`Archive` is explicit and asks for confirmation.
- Drafts with validation issues are still openable.
- Draft readiness is summarized without blocking resume.

Empty/error states:

- No drafts: show no large empty panel by default.
- Draft fetch failure: show a compact retry row.
- Delete failure: keep the row and show an error toast.

## Workbench UX

The workbench remains a full-page editing surface.

Required improvements:

- Header shows durable save state:
  - local saved,
  - syncing,
  - synced,
  - offline,
  - conflict.
- Back navigation never discards a draft.
- Publish readiness panel remains the primary path to fixing missing data.
- Loading an existing draft should show a clear loading state.
- Draft-not-found should show an actionable error and a link back to Assignments.
- Publish failure must leave the draft intact.
- Important UI text should move into the i18n locale files instead of staying hardcoded
  in English.

## Draft Persistence

Draft persistence has two layers.

### Local Draft

Local storage is the immediate recovery layer. It saves after meaningful edits, even
before server sync succeeds.

Local draft data should include:

- draft id,
- owner uid,
- assignment metadata,
- Assessment v2 draft payload,
- delivery policy,
- local revision,
- last local save time.

### Server Draft

Server drafts are the durable cross-session source.

Collection:

```txt
assignment_authoring_drafts/{draftId}
```

Server draft documents use the existing `AssignmentAuthoringDraft` shape:

```ts
interface AssignmentAuthoringDraft {
  id: string;
  ownerUid: string;
  title: string;
  description: string;
  classId: string;
  dueDate: string;
  attemptsAllowed: number;
  proctoringMode: AssignmentProctoringMode;
  assessmentDraft: AssignmentAssessmentInput;
  status: 'draft' | 'published' | 'archived';
  localRevision: number;
  serverRevision: number;
  createdAt: string;
  updatedAt: string;
  publishedAssignmentId?: string;
  lastImportReport?: AuthoringImportReport;
  deliveryPolicy: AssignmentDeliveryPolicy;
}
```

The list endpoint returns only drafts where:

- `ownerUid` is the current teacher,
- `status` is `draft`,
- ordered by `updatedAt desc`,
- capped to a small page such as 25 drafts.

## Conflict Handling

Server draft saves remain revision-based.

Behavior:

- The client sends the last known `serverRevision`.
- The server rejects stale saves with HTTP 409 and a conflict payload.
- The UI sets sync state to `conflict`.
- The teacher can reload the server draft or keep working from the local copy.

The first production launch can keep whole-draft conflict handling. Field-level merges are
not required.

## Teacher-Only Authorization

This launch intentionally narrows permissions.

Frontend:

- `/assignments/advanced/new` allows only `teacher`.
- `/assignments/advanced/:draftId` allows only `teacher`.
- The `Add advanced assignment` button appears only for teachers.
- The draft list appears only for teachers.

Backend:

- `assignment-draft-*` endpoints verify only `teacher`.
- `assessment-question-bank-*` and `assessment-media-bank-*` behavior can remain
  separately governed by existing roles unless directly used by the teacher authoring
  workflow.
- Publishing a draft uses the existing assignment create authorization after teacher
  draft ownership is verified.

Firestore:

- Client writes stay disabled through Firestore rules.
- Server APIs remain the only write path.

## Response Mode Support

All response modes are considered production-ready for this launch.

### Multiple Choice

- Student selects one option.
- Private answer keys are stored outside the public assignment payload.
- Fully multiple-choice assessments can auto-grade immediately.

### Short Answer

- Student enters short text.
- Accepted answers can be stored in private keys.
- Exact-match auto grading can be used where supported, but teacher review must remain
  possible.

### Long Answer

- Student writes longer text.
- Submission status remains `submitted` until manually graded.

### Speaking Recording

- Student records or uploads an audio response through the existing answer media upload
  path.
- Submission status remains `submitted` until manually graded.
- Review UI must expose playable media to teachers and eligible reviewers.

### File Upload

- Student uploads a file response through the existing answer media upload path.
- Submission status remains `submitted` until manually graded.
- Review UI must show attachment metadata and safe download/open behavior.

## Result Visibility

Result visibility follows `deliveryPolicy.resultReleasePolicy`:

- `after_submit`: students can review released results after submitting.
- `after_due`: students can review results only after the due date.
- `manual`: students cannot see results until manual release behavior allows it.

Manual grading state must be clear:

- If the assessment has unanswered manual grading work, student and parent review should
  say that grading is pending.
- Auto-scored portions must not be presented as the final score when manual questions
  remain ungraded.
- Teacher grading updates the submission to `graded` when all required manual scoring is
  complete.

## API Hardening

Required API checks:

- Draft save rejects invalid Assessment v2 payloads.
- Draft save rejects stale server revisions.
- Draft get/delete/publish reject drafts not owned by the current teacher.
- Draft list returns only current teacher draft documents.
- Draft publish validates draft readiness again server-side.
- Draft publish marks the draft `published` only after assignment create succeeds.
- Published and archived drafts do not appear in the draft list.
- Private Assessment v2 keys are written under the published assignment only, not leaked
  into public assignment fields.

## Testing Strategy

Use TDD for implementation.

### Route Tests

- Teacher can open `/assignments/advanced/new`.
- Teacher can open `/assignments/advanced/:draftId`.
- Admin, level-manager, student, parent, accounting, and office users cannot open the
  authoring workbench.
- Coming-soon page is no longer rendered for advanced routes.

### Assignments Page Tests

- Teacher sees `Add advanced assignment`.
- Teacher sees draft rows returned by `listAuthoringDrafts`.
- Clicking a draft row navigates to `/assignments/advanced/:draftId`.
- Clicking `Add advanced assignment` navigates to `/assignments/advanced/new`.
- Deleting a draft calls `deleteAuthoringDraft` and removes the row after success.
- Non-teacher users do not see the advanced create button or draft list.

### Workbench Tests

- Local draft is saved after edits.
- Existing draft route loads local draft first, then server draft.
- Server save occurs before publish.
- Publish success navigates back to `/assignments`.
- Publish validation blocks incomplete drafts.
- Server conflict sets visible conflict sync status.
- Offline save failure leaves local draft intact.

### API Tests

- Only teachers can use `assignment-draft-*` endpoints.
- Draft save/list/get/delete ownership is enforced.
- Draft publish creates a real assignment.
- Draft publish writes Assessment v2 private keys.
- Draft publish marks the source draft as `published`.
- Draft list excludes `published` and `archived`.

### Student And Grading Regression Tests

- All five response modes can be represented in Assessment v2 submissions.
- Multiple-choice-only assessments can auto-grade.
- Assessments with manual response modes stay `submitted`.
- Teacher grading can complete manual responses.
- Student/parent result review follows delivery policy.
- Review UI shows pending grading when manual grading is not complete.

### Completion Gates

Run before claiming completion:

```txt
npm.cmd run format:check
npm.cmd run lint -- --quiet
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:rules
npm.cmd run build
npm.cmd audit --audit-level=high --omit=dev
npm.cmd run test:e2e
```

If local e2e cannot start because of missing external environment or sandbox limits,
record the exact reason and run the rest of the suite.

## Rollout

This is an official launch, not a hidden beta.

Implementation should still be merge-safe:

1. Add tests for route access and teacher-only draft list behavior.
2. Restore workbench routes for teacher only.
3. Add Gmail-style draft list to Assignments page.
4. Harden workbench draft recovery, conflict status, and publish behavior.
5. Harden API authorization and publish tests.
6. Polish i18n and visible error states.
7. Run the full verification gate.
8. Push after the verification gate passes.

## Acceptance Criteria

- Teacher can create, leave, resume, delete, and publish advanced assignment drafts.
- Draft resume works after browser close/reopen.
- Advanced draft list behaves like a quiet Gmail-style draft folder.
- Only teachers can access advanced assignment authoring routes and draft APIs.
- All five Assessment v2 response modes are supported in the production flow.
- Published advanced assignments use the existing student runner and grading/review
  pipeline.
- Result visibility follows delivery policy.
- Pending manual grading is communicated clearly.
- The coming-soon page is no longer reachable through the advanced assignment entry
  points.
- Existing basic assignment behavior remains unchanged.
