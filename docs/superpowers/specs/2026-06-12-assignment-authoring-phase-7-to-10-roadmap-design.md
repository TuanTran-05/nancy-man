# Assignment Authoring Phase 7 To 10 Roadmap Design

## Goal

Finish the Assignment Authoring Workbench roadmap from Phase 7 through Phase 10 so
teachers can import or build high-quality Assessment v2 assignments, target them to the
right students, publish them with clear rules, and monitor completion after release.

## Current Evidence

Phase 7 has been implemented as the import repair phase:

- `docs/superpowers/specs/2026-06-12-assignment-authoring-import-repair-design.md`
- `docs/superpowers/plans/2026-06-12-assignment-authoring-import-repair.md`
- Commits from `94c9522b` through `80511a7f`

The current worktree also contains uncommitted Phase 7 review fixes and unrelated
authoring/media edits. Phase 8 work should start only after the current dirty state is
committed, stashed, or moved to an isolated worktree.

The current codebase already has:

- Assessment v2 schemas, safe answer-key extraction, student runner, and grading.
- A full-page workbench route at `/assignments/advanced/new`.
- Draft save/publish APIs under `assignment-draft-*`.
- Import preview, repair rows, generated templates, issue export, and import provenance.
- Basic duplicate/move/select state, question/media bank panels, readiness checks, and
  publish flow.

## Brainstormed Approaches

### Approach A: Finish The Existing Workbench Incrementally

Extend the current shared helpers, authoring state, workbench UI, assignment API, and
assignment list. Each phase ships a vertical slice with tests and keeps the legacy quick
assignment modal working.

Trade-offs:

- Lowest migration risk.
- Reuses existing Assessment v2 and authoring code.
- Requires disciplined file boundaries because `Assignments.tsx` is already large.

This is the recommended approach.

### Approach B: Build A Separate Assignment Campaign Module

Create a separate model for assignment campaigns, delivery rules, reminders, progress,
and analytics, then bridge old assignments into it.

Trade-offs:

- Cleaner long-term domain model.
- Too much migration risk for the current roadmap.
- Delays teacher-facing improvements.

This should wait until Phase 10 proves the operational needs.

### Approach C: Prioritize AI Generation And Smart Repair

Use AI to generate questions from documents, repair import rows, and suggest feedback.

Trade-offs:

- High upside later.
- Not necessary to complete the authoring/delivery workflow.
- Adds cost, latency, prompt-safety, and review burden before the core workflow is
  finished.

This remains a non-goal for Phase 8-10.

## Chosen Roadmap

Use Approach A.

### Phase 7: Import Repair Exit And Hardening

Phase 7 is the current import repair phase. Treat it as complete only after the review
fixes are committed and the focused/full verification gates are green.

Completion definition:

- Template downloads work for `.xlsx`, `.csv`, and `.docx`.
- Editable import repair rows include every canonical import field.
- Apply revalidates current dirty repair edits before importing.
- Issue CSV export reflects current preview state.
- `lastImportReport` is sanitized, persisted with drafts, and omitted from published
  assignment payloads.
- Full tests, typecheck, build, and whitespace checks pass.

### Phase 8: Authoring Productivity Completion

Finish the workbench as a serious authoring tool, not just a proof-of-concept shell.

Scope:

- Multi-select in the left rail with visible selected count.
- Bulk edit points, level, and skill for selected questions.
- Bulk move selected questions to another section.
- Bulk delete selected questions with confirmation.
- Add question and add section actions.
- Section editor for title, skill, and instructions.
- Better question command ergonomics: duplicate, move, save to bank, insert from bank.
- Focused tests for shared helpers, reducer actions, left rail, main editor, and
  workbench integration.

Non-goals:

- Random question pools.
- Rich drag-and-drop.
- AI generation.

### Phase 9: Assignment Delivery Rules

Make "giao bài tập" more precise than class plus due date.

Scope:

- Add a small shared delivery policy model.
- Keep class-wide assignment as the default.
- Add selected-student targeting inside the selected class.
- Add `availableFrom` scheduling so assignments can be prepared before students see
  them.
- Add result release policy for Assessment v2 answers: after submit, after due date, or
  manual.
- Enforce targeting and availability in submit API and student assignment reads.
- Show policy badges in teacher and student assignment cards.

Non-goals:

- Cross-class campaigns.
- Parent approval flows.
- Recurring assignments.
- Per-student individualized due dates.

### Phase 10: Assignment Operations And Completion Hardening

Close the loop after publishing.

Scope:

- Add a teacher-facing operations panel for each assignment:
  - target count,
  - submitted count,
  - graded count,
  - missing count,
  - late count,
  - pending manual grading count.
- Add a compact grading queue for Assessment v2 submissions that need manual review.
- Add missing-student list integration with the existing missing-assignment notification
  modal.
- Add CSV export for assignment progress.
- Add final compatibility tests covering legacy assignments, Assessment v2 authoring,
  delivery policies, submission attempts, grading, and student review.

Non-goals:

- New analytics warehouse.
- AI feedback generation.
- Replacing the existing assignment list page.

## Data Model Direction

Add delivery metadata to assignments and authoring drafts without replacing the existing
assignment document:

```ts
type AssignmentTargetMode = 'class' | 'selected_students';
type AssignmentResultReleasePolicy = 'after_submit' | 'after_due' | 'manual';

interface AssignmentDeliveryPolicy {
  targetMode: AssignmentTargetMode;
  assignedStudentIds: string[];
  availableFrom: string;
  resultReleasePolicy: AssignmentResultReleasePolicy;
}
```

Rules:

- Empty `assignedStudentIds` means all active students in the assignment class when
  `targetMode` is `class`.
- `targetMode: 'selected_students'` requires at least one student id and every id must
  belong to `classId`.
- `availableFrom` is optional in UI but stored as an empty string when absent.
- Existing assignments without delivery metadata behave as class-wide and immediately
  available.

## Testing Strategy

Use TDD for every phase.

Phase 8 tests:

- Shared helper tests for add/delete/move/bulk operations.
- Reducer tests for selection and bulk actions.
- Component tests for left rail and main editor controls.
- Workbench tests for save-before-publish still working after bulk edits.

Phase 9 tests:

- Shared delivery policy normalization and validation.
- API create/update/publish persistence.
- Submit API rejects unavailable or untargeted assignments.
- Student read path hides unavailable or untargeted assignments.
- Assignment card displays delivery badges.

Phase 10 tests:

- Progress summary API computes target/submitted/graded/missing/late/manual counts.
- Operations panel renders summary, missing list, grading queue, and export action.
- Existing full assignment tests continue to pass.
- Typecheck, build, and full Vitest pass.

## Acceptance Criteria

- Phase 7 is verified and committed.
- Phase 8 makes authoring efficient enough for large imported or manually-created
  assignments.
- Phase 9 lets teachers decide who sees an assignment and when.
- Phase 10 gives teachers a clear operational view after publishing.
- Legacy quick assignment creation still works.
- Existing Assessment v2 student runner and grading continue to work.
- Full tests, typecheck, build, and diff checks pass at the end of each phase.
