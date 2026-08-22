# Advanced Assignment Google Forms Redesign Design

## Goal

Redesign the Advanced Assignment Builder into a Google Forms style authoring
experience for EduTrack teachers.

The redesign should make teachers feel like they are composing an assessment, not
filling out an admin form. The primary screen must prioritize question content,
fast question creation, media-rich English practice, drag-and-drop ordering,
autosaved drafts, and a real-time student preview.

## Approved Direction

The approved direction is `A. Google Forms Canvas in EduTrack`.

Reference artifacts:

- Visual companion screen:
  `.superpowers/brainstorm/codex-20260613-111916/content/design-a-detail.html`
- Generated concept image:
  `C:\Users\ASUS\.codex\generated_images\019ebae4-8642-7101-8cc1-5ca9c0621f52\ig_063f0828e6013c29016a2cdb3a413c81918126c8014a174e06.png`

The product keeps EduTrack's teacher app shell and routing, but the builder body
becomes a Forms-like canvas:

- sticky editor header,
- centered form canvas,
- one card per question,
- floating insert toolbar,
- tabs for `Questions`, `Responses`, and `Settings`,
- settings in a drawer instead of a fixed admin sidebar.

## Current Context

The current route `/assignments/advanced/new` already loads
`AssignmentAuthoringWorkbench`.

Important existing files:

- `src/pages/common/AssignmentAuthoringWorkbench.tsx`
- `src/components/assignments/authoring/AuthoringMainEditor.tsx`
- `src/components/assignments/authoring/AuthoringLeftRail.tsx`
- `src/components/assignments/authoring/AuthoringPreviewPanel.tsx`
- `src/components/assignments/authoring/DeliveryPolicyPanel.tsx`
- `src/components/assignments/authoring/PublishReadinessPanel.tsx`
- `src/components/assignments/authoring/QuestionBankPanel.tsx`
- `src/components/assignments/authoring/MediaBankPanel.tsx`
- `src/components/assignments/authoring/authoringState.ts`
- `src/components/assignments/authoring/draftSync.ts`
- `shared/assignmentAuthoring.ts`
- `shared/assignmentAssessment.ts`
- `server/api/edu/handlers/assignmentAuthoring.ts`

The existing implementation has useful foundations:

- local draft persistence,
- server draft sync,
- publish readiness validation,
- question bank,
- media bank,
- import preview,
- template picker,
- delivery policy,
- teacher-only route protection,
- server-backed draft endpoints.

The redesign should reuse these foundations. It should not replace the authoring
domain model wholesale unless a requested question type needs an explicit schema
extension.

## Framework Decision

The user requested Next.js, React, TypeScript, TailwindCSS, shadcn/ui, and dnd-kit.
This repository is currently a React + Vite + TypeScript app using
`react-router-dom`, Tailwind utility classes, lucide icons, and Vitest.

This design intentionally does not migrate EduTrack to Next.js. The feature will
be implemented in the existing Vite app to avoid a full product framework
migration. The UI should use shadcn-inspired local primitives and Tailwind class
patterns. `dnd-kit` should be added for question and section reordering.

If the team later initializes shadcn/ui across the app, these primitives can be
mapped to generated shadcn components without changing the authoring state model.

## User Experience

### Primary Teacher Flow

1. Teacher opens `/assignments`.
2. Teacher clicks `Add advanced assignment`.
3. App opens `/assignments/advanced/new`.
4. The builder shows a blank draft with one title card and one question card.
5. Teacher edits the assignment title, description, question prompt, media,
   options, answer key, points, and required state directly on the canvas.
6. Edits save locally immediately and sync to the server after a 2 second debounce.
7. Teacher can add questions, media, title blocks, and sections from a floating
   toolbar.
8. Teacher can open Preview at any time and see the student-facing view.
9. Teacher can switch to Settings to configure class, due date, attempts,
   proctoring, release policy, and availability.
10. Teacher saves draft or publishes after readiness checks pass.

### Main UX Principles

- The canvas is the product. Most of the viewport belongs to question cards.
- The teacher should add a question in one click.
- Controls are attached to the thing they affect.
- Settings should not compete with writing questions.
- Preview should be available without leaving the editor.
- Autosave state must be always visible and calm.
- The interface must remain usable on a small laptop and on mobile.

## Layout

### Sticky Header

Header contents:

- back button to `/assignments`,
- editable assignment title input,
- autosave status,
- `Preview`,
- `Save draft`,
- `Publish`.

Autosave text states:

- `Saving...`
- `Saved`
- `Offline draft`
- `Sync conflict`
- `Not saved yet`

Header behavior:

- sticky at the top of the authoring page,
- compresses on mobile,
- title stays editable,
- primary publish action remains visible where space allows,
- overflow actions move into a compact menu on narrow screens.

### Top Tabs

Tabs sit below the header:

- `Questions`
- `Responses`
- `Settings`

`Questions` is the default tab.

`Responses` is read-only for drafts and should show an empty state until the
assignment is published and has submissions.

`Settings` opens a settings drawer. It does not use the old fixed right admin
column.

### Questions Canvas

The `Questions` tab uses a centered canvas with a soft pale lavender background.

The canvas contains:

- assignment title card,
- optional description,
- sections,
- one card per question,
- inline section headers,
- drag handles.

Question cards:

- white surface,
- rounded-xl,
- soft shadow,
- subtle blue selected accent on the left,
- clear active/focus state,
- stable spacing,
- no nested admin panels.

### Floating Toolbar

A vertical floating toolbar sits to the right of the canvas on desktop.

Toolbar actions:

- Add question,
- Add title / description,
- Add image,
- Add audio,
- Add video,
- Add section,
- Insert from question bank.

On mobile, the toolbar becomes a bottom action bar with the same actions. The
primary add-question action remains one tap.

### Settings Panel

Settings are not always visible.

The Settings tab opens a drawer containing:

- class assignment,
- due date,
- attempt limit,
- anti-cheating mode,
- result release mode,
- availability period,
- delivery target,
- selected students when delivery target is not the whole class.

Publish readiness should appear in Settings and also surface blockers in the
header as a small status badge.

### Preview

Preview opens as a responsive modal or side sheet.

Preview requirements:

- uses the same draft state as the editor,
- shows student-facing question flow,
- updates when the teacher edits the draft,
- supports desktop and mobile preview widths,
- does not publish or save independently.

## Question Card Requirements

Every question card supports:

- prompt text,
- question type selector,
- points,
- required toggle,
- duplicate,
- delete,
- move up,
- move down,
- drag handle,
- save to question bank,
- media attachments,
- validation messages,
- selected/focused state.

Media attachments:

- multiple images,
- audio files or audio URLs,
- video URLs,
- transcript for listening media,
- alt text for images,
- thumbnail or preview for visible media.

Question media controls:

- `Add image`,
- `Add audio`,
- `Add video`,
- insert from media bank,
- remove media,
- edit title, alt text, transcript, and URL/storage metadata.

Option media controls for choice questions:

- option text,
- optional image per option,
- remove option image,
- add option,
- remove option,
- reorder options.

## Supported Question Types

The UI exposes these teacher-facing types:

1. Multiple choice
2. Multiple select
3. Short answer
4. Long answer
5. Fill in the blank
6. Matching
7. Ordering
8. Listening
9. Reading section
10. Image question

### Mapping to Existing and New Data

Existing `shared/assignmentAssessment.ts` supports:

- `multiple_choice`
- `short_answer`
- `long_answer`
- `speaking_recording`
- `file_upload`

The redesign needs schema extensions for the full requested list.

Proposed authoring question type model:

```ts
export type AssessmentInteractionType =
  | 'multiple_choice'
  | 'multiple_select'
  | 'short_answer'
  | 'long_answer'
  | 'fill_blank'
  | 'matching'
  | 'ordering'
  | 'listening'
  | 'reading_section'
  | 'image_question'
  | 'speaking_recording'
  | 'file_upload';
```

Use `interactionType` for teacher-facing behavior. Keep `responseMode` only where
the existing student runner and grading logic already depend on it. New runner
work can gradually migrate to `interactionType`.

Suggested behavior mapping:

- Multiple choice: one selected option, auto-graded.
- Multiple select: array of selected options, auto-graded.
- Short answer: text answer, manual or accepted-answer auto check.
- Long answer: text answer, manual grading.
- Fill in the blank: text blanks with accepted answers per blank.
- Matching: pairs from left and right columns, auto-graded.
- Ordering: ordered item list, auto-graded.
- Listening: audio media plus a nested response interaction.
- Reading section: passage block plus one or more child questions.
- Image question: image media plus a nested response interaction.

Listening, reading section, and image question are wrapper types. They can contain
one child interaction or a section-like group of child questions depending on the
authoring need.

## State Architecture

### Existing State to Preserve

Keep:

- `useReducer(reducer, profile?.uid || 'anonymous', createInitialWorkbenchState)`
- `AssignmentAuthoringDraft`
- `AuthoringWorkbenchState`
- local draft save in `draftSync.ts`
- server sync via `saveAuthoringDraft`
- publish via `publishAuthoringDraft`
- validation via `getAuthoringValidationIssues`

### New UI State

Add a small UI-only state layer separate from the draft:

```ts
type AuthoringActiveTab = 'questions' | 'responses' | 'settings';

interface AuthoringUiState {
  activeTab: AuthoringActiveTab;
  previewOpen: boolean;
  previewDevice: 'desktop' | 'mobile';
  settingsOpen: boolean;
  activeBlockId: string | null;
  focusedQuestionId: string | null;
  toolbarMode: 'floating' | 'bottom';
}
```

This state should not be written into Firestore. It only controls presentation.

### Debounced Autosave

Autosave policy:

- every draft mutation marks sync status as `local_pending`,
- local storage update happens immediately,
- server sync starts after 2 seconds of no further edits,
- a newer local revision supersedes older sync requests,
- header shows `Saving...` while server sync is running,
- header shows `Saved` only after the local revision is known to match the server
  response,
- publish blocks while required fields are invalid.

The current `scheduleServerDraftSync` should be kept but audited so the visible
status reflects the 2 second debounce.

## Component Structure

### Page Composition

`AssignmentAuthoringWorkbench.tsx` becomes composition glue:

- loads draft,
- owns reducer,
- owns autosave and publish handlers,
- loads classes/students,
- passes state and dispatch into focused UI components.

New or revised components:

- `AuthoringShell`
- `AuthoringHeader`
- `AuthoringTabs`
- `QuestionCanvas`
- `AssignmentTitleCard`
- `SectionCard`
- `QuestionCard`
- `QuestionTypeSelector`
- `QuestionMediaStrip`
- `OptionEditor`
- `QuestionCardFooter`
- `FloatingInsertToolbar`
- `SettingsDrawer`
- `ResponsesPanel`
- `PreviewDrawer`
- `QuestionBankDrawer`
- `MediaPickerDialog`

Existing components to reuse:

- `DraftSyncStatus`
- `DeliveryPolicyPanel` after visual restyle,
- `PublishReadinessPanel` after visual restyle,
- `QuestionBankPanel` after drawer integration,
- `MediaBankPanel` after picker integration,
- `AuthoringPreviewPanel` logic after visual restyle.

### Component Boundaries

`QuestionCard` edits one question and receives:

```ts
interface QuestionCardProps {
  sectionId: string;
  question: AssessmentQuestionInput;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (question: AssessmentQuestionInput) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSaveToBank: () => void;
  onOpenMediaPicker: (target: 'question' | { optionKey: string }) => void;
}
```

`QuestionCanvas` owns section and question lists and DnD wiring. It dispatches
draft actions, but individual cards do not know global draft shape.

`SettingsDrawer` receives draft-level fields, class options, student options,
delivery policy, readiness groups, and update callbacks.

## Drag and Drop

Use `dnd-kit`.

Dependencies:

- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`

DnD requirements:

- questions can reorder within a section,
- questions can move between sections,
- sections can reorder,
- keyboard dragging is available,
- drag handles have labels,
- disabled state prevents dragging while publishing.

Reducer additions:

```ts
| { type: 'reorder_question'; questionId: string; destination: { sectionId: string; index: number } }
| { type: 'reorder_section'; sectionId: string; index: number }
```

The existing `moveQuestionInDraft` can back the question reorder action.
`reorderSectionInDraft` should be added beside it.

## Database Schema Proposal

### Existing Collections

Keep these collections:

- `assignment_authoring_drafts`
- `assessment_question_bank`
- `assessment_media_bank`
- `assignment_authoring_imports`

The client should still write through server APIs only. Firestore rules should
continue denying direct client writes.

### Draft Document Shape

Current draft document remains the primary shape:

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
  deliveryPolicy: AssignmentDeliveryPolicy;
  status: 'draft' | 'published' | 'archived';
  localRevision: number;
  serverRevision: number;
  createdAt: string;
  updatedAt: string;
  publishedAssignmentId?: string;
  lastImportReport?: AuthoringImportReport;
}
```

Add these optional UI/schema fields only if needed for the 10-type model:

```ts
interface AssessmentQuestionInput {
  interactionType?: AssessmentInteractionType;
  required?: boolean;
  optionMedia?: Record<string, QuestionMedia[]>;
  blanks?: Array<{ id: string; label: string; acceptedAnswers: string[] }>;
  matchingPairs?: Array<{ id: string; left: string; right: string }>;
  orderingItems?: Array<{ id: string; text: string }>;
  childQuestions?: AssessmentQuestionInput[];
  passage?: string;
}
```

### Question Bank Item Shape

Question bank items should store the same question snapshot fields needed to
recreate a question card:

```ts
interface AssessmentQuestionBankItem {
  id: string;
  ownerUid: string;
  visibility: AuthoringBankVisibility;
  interactionType?: AssessmentInteractionType;
  skill: QuestionSkill;
  responseMode: AssessmentResponseMode;
  prompt: string;
  media: QuestionMedia[];
  optionMedia?: Record<string, QuestionMedia[]>;
  options?: QuizOptionLike[];
  points?: number;
  level?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

### Published Assignment Shape

Publishing must keep answer keys private by using the existing
`extractAssessmentKeys` pattern.

If new interaction types are added, the safe published assessment and private
key map must both understand:

- multiple selected answers,
- blank accepted answers,
- matching pair keys,
- ordering keys,
- child question keys.

## Accessibility

Requirements:

- every icon-only button has an accessible name,
- toolbar buttons have labels and tooltips,
- tabs use proper `tablist`, `tab`, and `tabpanel` roles,
- drawer has focus trap and escape-to-close behavior,
- preview modal restores focus to the button that opened it,
- DnD supports keyboard reordering,
- drag handles announce reorder instructions,
- validation errors are connected with `aria-describedby`,
- autosave status uses `aria-live="polite"`,
- destructive delete confirms or supports undo,
- color is never the only readiness/error signal.

## Responsive Behavior

Desktop:

- app shell remains visible,
- centered canvas width is approximately 760 to 860 px,
- floating toolbar stays near the active canvas,
- settings opens as a right drawer.

Tablet:

- app shell can collapse if the global shell already supports it,
- canvas takes most width,
- toolbar can become a compact vertical rail or bottom bar,
- settings becomes an overlay drawer.

Mobile:

- single-column canvas,
- sticky header compresses,
- actions move to overflow menu,
- toolbar becomes bottom action bar,
- question card controls wrap into an action sheet,
- settings is full-screen drawer,
- preview supports mobile-first mode.

No text should overflow buttons, cards, tabs, or mobile containers.

## Visual System

Use a calm editor palette:

- page background: pale lavender / cool slate,
- canvas surfaces: white,
- selected question accent: EduTrack blue,
- publish accent: indigo,
- success: emerald,
- warning: amber,
- destructive: red.

Typography:

- compact product UI scale,
- clear editor headings,
- bold but not oversized labels,
- form inputs should not rely on browser defaults,
- letter spacing remains `0`.

Component style:

- rounded-xl cards,
- soft shadows,
- 1px neutral borders,
- visible focus rings,
- icon buttons using lucide icons,
- no decorative blobs or marketing hero patterns.

## Validation and Error Handling

Publish readiness should continue grouping issues by:

- assignment basics,
- structure and prompts,
- answers,
- media.

Clicking a readiness issue should focus the relevant field or question card.

Question-level validation appears inside the question card. Draft-level validation
appears in the Settings drawer and header readiness badge.

Autosave and draft load errors should show non-blocking toast messages, except
for draft load failure where the current error page is still appropriate.

## Testing Strategy

Unit and component tests:

- header autosave status renders all states,
- question card edits prompt/options/points/required,
- media strip adds/removes media,
- option media adds/removes images,
- settings drawer updates draft fields,
- floating toolbar adds question/title/media/section,
- question bank insert adds a question to selected section,
- preview opens with current draft content,
- publish readiness issue focuses relevant field,
- reducer reorders questions and sections,
- DnD keyboard reorder path updates state.

Integration tests:

- `/assignments/advanced/new` loads for teacher,
- teacher can create and edit a draft,
- autosave calls `saveAuthoringDraft` after debounce,
- teacher can preview,
- teacher can save to bank,
- teacher can insert from question bank,
- teacher can publish when readiness passes,
- unsupported roles cannot access the route.

Visual/browser QA:

- desktop view matches approved Design A anatomy,
- mobile view has bottom toolbar and no overflow,
- settings drawer opens/closes,
- preview modal opens/closes,
- drag handle is visible and usable,
- no framework error overlay,
- no relevant app console errors.

## Implementation Phases

### Phase 1: Layout Redesign Using Existing Question Modes

Build the new Forms-style shell, header, tabs, canvas, question cards, toolbar,
settings drawer, and preview drawer using existing draft data and current response
modes.

This phase makes the current advanced builder pleasant and usable immediately.

### Phase 2: DnD and Media-Rich Card Editing

Add `dnd-kit` reordering, improved question media UI, option image UI, and drawer
integration for question/media bank insertion.

### Phase 3: Full 10-Type Schema and Student Runner Support

Extend shared schemas, authoring reducers, validation, publishing, answer
normalization, student runner, grading, and review surfaces for multiple select,
fill blank, matching, ordering, listening wrappers, reading sections, and image
questions.

Do not allow publishing a new interaction type until its student attempt,
grading, and review behavior are implemented and tested.

## Non-Goals

This redesign does not include:

- migrating the app to Next.js,
- replacing the entire EduTrack app shell,
- launching public marketplace sharing for the bank,
- AI question generation,
- AI grading,
- changing Firestore rules to allow direct client draft writes,
- replacing the existing basic assignment workflow.

## Implementation Defaults

These defaults are part of the approved design and should be used in the plan:

- Settings opens as a right drawer on desktop and a full-screen drawer on mobile.
- The question bank opens from the floating toolbar and from each question card's
  `Save to question bank` / `Insert from question bank` actions.
- Field labels use the existing EduTrack i18n structure. English copy is the
  source text for tests; Vietnamese translations can follow existing language
  files.
- The question type selector order is: multiple choice, multiple select, short
  answer, long answer, fill in the blank, matching, ordering, listening, reading
  section, image question.

## Success Criteria

The redesign is complete when:

- the advanced builder no longer resembles a three-column admin form,
- teacher can create a usable draft from the first screen,
- each question is edited in its own card,
- adding a question is one click,
- media can be attached at question level,
- choice option images are represented in the editor model,
- settings are available from tabs/drawer instead of fixed right column,
- autosave shows clear `Saving...` and `Saved` states,
- preview reflects the current draft,
- desktop and mobile layouts pass browser QA,
- tests cover reducer, cards, settings, preview, autosave, and route behavior.
