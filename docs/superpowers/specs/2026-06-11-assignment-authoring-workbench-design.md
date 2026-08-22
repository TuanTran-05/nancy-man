# Assignment Authoring Workbench Design

## Goal

Improve the teacher authoring experience for Assessment v2 assignments by turning the
current advanced builder into a full-page workbench focused on fast lesson creation,
reusable content, and reliable draft recovery.

This design builds on the existing Assessment v2 foundation:

- Shared Assessment v2 schema and safe projections.
- Advanced assignment builder.
- Student assessment runner.
- Per-question grading and speaking answer support.

The next improvement should prioritize teacher productivity across the already-built
four phases, not introduce a separate assessment model.

## Decisions

- Use a **full-page authoring workbench** as the primary UI for advanced assignments.
- Keep the legacy quick assignment modal unchanged.
- Add a hybrid reusable content system:
  - Private question/media bank per teacher.
  - Shared question/media bank for center-approved content.
  - Teacher publish requests with admin or level-manager review.
- Add hybrid autosave:
  - Local browser draft save immediately after meaningful edits.
  - Server draft sync with revision tracking when the user is authenticated and the
    draft has enough metadata.
- Ship question productivity tools before broad document import:
  - Duplicate.
  - Reorder.
  - Multi-select.
  - Bulk edit.
- Start with structure templates, while leaving a path for sample-content templates.

## Non-Goals

This design does not include:

- Word, Google Docs, CSV, or Excel import parsers.
- AI question generation or AI scoring.
- Randomized question pools.
- Rich timed-test engines.
- Replacing legacy essay/quiz assignment creation.
- Migrating legacy quiz assignments into Assessment v2.

Those can be follow-up designs after the workbench and reusable content foundation are
stable.

## Product Scope

The workbench should make these daily teacher workflows faster:

1. Start from a useful assignment structure.
2. Build sections and questions without repetitive manual setup.
3. Reuse media and questions across assignments.
4. Recover unfinished work after closing the page, refreshing, or losing connection.
5. Publish a validated Assessment v2 assignment that behaves exactly like the current
   student runner and grading flow expect.

## Workbench Layout

The approved layout is a full-page workbench with three regions.

### Left Rail

The left rail owns navigation and structure:

- Assignment basics.
- Section list.
- Question list under each section.
- Multi-select question controls.
- Validation markers for missing prompts, missing options, missing keys, and invalid
  media.
- Quick add section/question actions.

### Main Editor

The main editor owns the currently selected item:

- Assignment basics editor.
- Section editor.
- Question prompt.
- Media manager.
- Response mode editor.
- Answer key and accepted answers.
- Rubric and points.
- Level and tags.
- Inline validation.

### Right Panel

The right panel owns reusable and operational tools:

- Structure templates.
- Question bank search.
- Media bank search.
- Save current question to bank.
- Save current media to bank.
- Publish request status.
- Draft sync status.
- Student preview entry point.

The right panel should be collapsible on smaller screens.

## Templates

Templates are used to create starter assessment structures quickly.

### Template Types

```ts
type AssessmentTemplateKind = 'structure' | 'sample_content';
```

Phase one should ship `structure` templates only. A structure template creates sections,
question placeholders, response modes, default points, and default rubrics without
shipping real lesson content.

Examples:

- Listening practice.
- Reading passage.
- Speaking prompt set.
- Mixed skills homework.

`sample_content` templates can be added later for onboarding and standardized center
materials. They should use the same template model, but include real prompt/media/answer
content.

## Question Productivity

The workbench should add productivity operations that work on the Assessment v2 draft
before publish.

### Single Question Actions

- Duplicate question.
- Move question up.
- Move question down.
- Move question to another section.
- Save question to private bank.
- Submit question for shared bank review.

### Multi-Select Actions

- Bulk change level.
- Bulk change points.
- Bulk change skill.
- Bulk move to section.
- Bulk delete with confirmation.

Changing response mode in bulk is allowed only when it can be done without ambiguous
data loss. For example, changing multiple-choice questions to short-answer should
require confirmation because options and correct answers may be removed.

### Validation

Validation should run continuously and before publish:

- Assignment title required.
- Class required.
- Due date required and valid.
- Section title required.
- Question prompt required.
- Multiple-choice questions require at least two options.
- Multiple-choice questions require an answer key before publish.
- Short-answer questions can publish without accepted answers, but are manual grading
  by default.
- Uploaded media require `storagePath`.
- External media URLs require `https://`.

## Draft And Autosave

Autosave should protect long authoring sessions.

### Local Draft

Local draft persistence should save immediately after meaningful edits. It should allow
recovery before server sync is available.

Local storage should include:

- Draft id.
- Owner uid when available.
- Assessment draft payload.
- Unsynced revision.
- Last saved timestamp.

### Server Draft

Server drafts make work recoverable across devices.

Suggested collection:

```txt
assignment_authoring_drafts/{draftId}
```

Suggested shape:

```ts
interface AssignmentAuthoringDraft {
  id: string;
  ownerUid: string;
  classId?: string;
  title?: string;
  description?: string;
  dueDate?: string;
  attemptsAllowed?: number;
  proctoringMode?: AssignmentProctoringMode;
  assessmentDraft: AssignmentAssessmentInput;
  status: 'draft' | 'published' | 'archived';
  localRevision?: number;
  serverRevision: number;
  createdAt: string;
  updatedAt: string;
  publishedAssignmentId?: string;
}
```

Server sync should be debounced, for example 2 to 5 seconds after edits. The client
should show:

- Saving locally.
- Syncing.
- Synced.
- Offline changes pending.
- Conflict detected.

### Conflict Handling

Conflicts should be revision-based:

- The client sends the last known `serverRevision`.
- The server rejects stale updates with a conflict payload.
- The UI lets the teacher choose:
  - Keep local version.
  - Restore server version.

The first implementation can use whole-draft replacement rather than complex field-level
merge.

## Question Bank

The question bank stores reusable authoring content outside assignments.

Suggested collection:

```txt
assessment_question_bank/{questionId}
```

Suggested shape:

```ts
type BankVisibility = 'private' | 'pending_review' | 'shared' | 'archived';

interface AssessmentQuestionBankItem {
  id: string;
  ownerUid: string;
  ownerName?: string;
  visibility: BankVisibility;
  skill: AssessmentQuestion['skill'];
  responseMode: AssessmentResponseMode;
  prompt: string;
  media: QuestionMedia[];
  options?: QuizOptionLike[];
  points?: number;
  level?: string;
  tags: string[];
  sourceAssignmentId?: string;
  sourceQuestionId?: string;
  createdAt: string;
  updatedAt: string;
  reviewedByUid?: string;
  reviewedAt?: string;
  reviewNote?: string;
}
```

Private grading data should stay protected. The implementation can either:

- Store private bank keys in a subcollection, mirroring assignment keys.
- Store keys in the same document but only return them through teacher/admin-safe
  projections.

The subcollection approach is more consistent with Assessment v2 assignments and is the
recommended default.

### Insert Behavior

Inserting a bank question into an assignment copies a snapshot into the draft. The
assignment should not point live to the bank item. This prevents published assignments
from changing when bank content is later edited.

## Media Bank

The media bank stores reusable media metadata and Storage references.

Suggested collection:

```txt
assessment_media_bank/{mediaId}
```

Suggested shape:

```ts
interface AssessmentMediaBankItem {
  id: string;
  ownerUid: string;
  ownerName?: string;
  visibility: BankVisibility;
  type: QuestionMediaType;
  source: QuestionMediaSource;
  url: string;
  storagePath?: string;
  title?: string;
  altText?: string;
  transcript?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  reviewedByUid?: string;
  reviewedAt?: string;
  reviewNote?: string;
}
```

Uploaded media should continue to use Firebase Storage. The existing assignment media
upload endpoint can be reused or extended so teachers can optionally save uploaded media
to their private media bank.

## Shared Content Review

The reusable bank uses a hybrid permission model.

### Teacher

- Can create private question/media items.
- Can edit and archive their private items.
- Can insert shared items into drafts.
- Can submit their private items for shared review.
- Cannot directly publish shared items unless they also have admin or level-manager
  privileges.

### Admin Or Level Manager

- Can create shared items directly.
- Can approve pending review items.
- Can reject pending review items with a note.
- Can archive shared items.
- Can insert private items only if they own them or have explicit administrative access.

### Review States

```txt
private -> pending_review -> shared
private -> archived
pending_review -> private
shared -> archived
```

Rejecting a publish request should return the item to private visibility with a
review note.

## API Design

The API should keep endpoints small and role-specific.

### Drafts

- `assignment-draft-save`
- `assignment-draft-list`
- `assignment-draft-get`
- `assignment-draft-delete`
- `assignment-draft-publish`

`assignment-draft-publish` should validate the draft, call the existing assignment
creation path or shared helper, and mark the draft as `published` with
`publishedAssignmentId`.

### Question Bank

- `assessment-question-bank-create`
- `assessment-question-bank-update`
- `assessment-question-bank-search`
- `assessment-question-bank-submit-review`
- `assessment-question-bank-review`

### Media Bank

- `assessment-media-bank-create`
- `assessment-media-bank-update`
- `assessment-media-bank-search`
- `assessment-media-bank-submit-review`
- `assessment-media-bank-review`

Search endpoints should support:

- `visibility`.
- `skill`.
- `responseMode`.
- `type` for media.
- `tags`.
- text query.
- cursor pagination.

## Frontend Architecture

The workbench should be split into focused modules.

Suggested files:

- `src/pages/common/AssignmentAuthoringWorkbench.tsx`
- `src/components/assignments/authoring/AuthoringLeftRail.tsx`
- `src/components/assignments/authoring/AuthoringMainEditor.tsx`
- `src/components/assignments/authoring/AuthoringRightPanel.tsx`
- `src/components/assignments/authoring/TemplatePicker.tsx`
- `src/components/assignments/authoring/QuestionBankPanel.tsx`
- `src/components/assignments/authoring/MediaBankPanel.tsx`
- `src/components/assignments/authoring/DraftSyncStatus.tsx`
- `src/components/assignments/authoring/authoringState.ts`
- `src/components/assignments/authoring/draftSync.ts`

The current `assessmentBuilder` components can be reused or gradually migrated into the
new authoring namespace. Shared editor pieces should remain small enough to test
independently.

The workbench should use dedicated routes:

- `/assignments/advanced/new`
- `/assignments/advanced/:draftId`

The existing `/assignments` page remains the list and entry point.

## Publish Flow

Publishing from the workbench should:

1. Run local validation.
2. Sync latest draft to server.
3. Convert draft into an `assignment-create` payload.
4. Persist assignment with safe Assessment v2 data and private keys through the existing
   Assessment v2 backend foundation.
5. Mark draft as `published`.
6. Clear local recovery state for that draft.

The existing legacy quick assignment flow remains unchanged.

## Error Handling

The UI should handle:

- Offline local-only edits.
- Server sync failure.
- Draft conflict.
- Upload failure.
- Bank item no longer available.
- Publish validation failure.
- Permission denied on shared review actions.

Errors should be actionable and local to the affected region where possible.

Examples:

- Draft sync banner for sync/offline/conflict.
- Inline validation near the affected question.
- Toast for save-to-bank success or failure.
- Review queue message for rejected publish requests.

## Testing Strategy

### Shared And State Tests

- Apply structure template to a blank draft.
- Duplicate question keeps private keys and generates new question ids.
- Reorder questions preserves answers/rubrics.
- Bulk edit points/level/skill.
- Draft revision conflict detection.
- Draft publish payload conversion.

### API Tests

- Teacher can save/list/get/delete own drafts.
- Teacher cannot read another teacher's private drafts.
- Teacher can create private question/media bank items.
- Teacher can submit private items for review.
- Admin and level-manager users can approve or reject pending items.
- Shared search does not expose private key data to unauthorized users.
- Inserting bank content snapshots the current content.

### UI Tests

- Open workbench from Assignments page.
- Choose a structure template.
- Duplicate, reorder, and bulk edit questions.
- Autosave recovery banner appears after restoring a local draft.
- Insert question from bank into selected section.
- Save question to private bank.
- Submit item for shared review.
- Publish assignment from draft.

### Regression Tests

- Existing quick assignment modal still works.
- Existing Assessment v2 student runner still renders published assignments.
- Existing Assessment v2 grading still works with published assignments.
- Published assignments are not changed by later bank item edits.

## Rollout Plan

### Phase A: Workbench Shell And Drafts

- Add full-page workbench route or page state.
- Add draft state model.
- Add local autosave.
- Add server draft save/list/get/delete.
- Add draft recovery UI.

### Phase B: Templates And Productivity Tools

- Add structure templates.
- Add duplicate, move up/down, move to section.
- Add multi-select and bulk edit.
- Add live validation.

### Phase C: Private Banks

- Add private question bank create/search/insert.
- Add private media bank create/search/insert.
- Add save current question/media to bank.

### Phase D: Shared Bank Review

- Add pending review state.
- Add submit-for-review actions.
- Add admin/level-manager review actions.
- Add shared search filters and review notes.

### Phase E: Polish And Follow-Up Readiness

- Improve preview integration.
- Harden conflict handling.
- Add telemetry/audit events for publish and review actions.
- Prepare extension points for Word/Excel import and sample-content templates.

## Acceptance Criteria

- Teachers can create advanced Assessment v2 assignments from a full-page workbench.
- Teachers can start from structure templates.
- Teachers can duplicate, reorder, and bulk edit questions.
- Workbench saves local drafts immediately and syncs server drafts when possible.
- Teachers can recover unfinished drafts.
- Teachers can save questions and media to a private bank.
- Teachers can insert bank questions/media into assignments.
- Teachers can submit private content for shared review.
- Admin and level-manager users can approve, reject, archive, and directly publish
  shared bank items.
- Published assignments use snapshots of bank content.
- Existing legacy and Assessment v2 flows continue to pass their current tests.

## Resolved Implementation Defaults

These defaults keep the first implementation concrete. They can be revisited after the
workbench is in use.

- Academic review privileges use existing `admin` and `level_manager` roles.
- The workbench uses dedicated routes under `/assignments/advanced`.
- Server draft sync uses a 3 second debounce after edits.
- Bank search uses cursor pagination.
- Private question-bank keys use a private subcollection from day one.
