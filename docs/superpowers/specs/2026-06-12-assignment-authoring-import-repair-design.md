# Assignment Authoring Import Repair Design

## Goal

Make Phase 6 assignment import easier to use in real teaching workflows by adding
downloadable templates, an in-preview repair flow, exportable error reports, and import
provenance on the local draft.

This is Phase 7 of the Assignment Authoring Workbench. It builds on the existing
server-side `.xlsx`, `.csv`, and strict `.docx` import preview endpoint. The phase keeps
the controlled-template model and improves the teacher workflow around bad rows and
missing fields.

## Decisions

- Add downloadable `.xlsx`, `.csv`, and `.docx` import templates from the workbench.
- Keep templates static/generated from code rather than storing template files in
  Firestore.
- Extend import preview with editable draft rows for repair.
- Let teachers fix common import issues before applying:
  - `section`
  - `skill`
  - `responseMode`
  - `prompt`
  - options A-D
  - `correctAnswer`
  - `acceptedAnswers`
  - `points`
  - `level`
  - `mediaUrl`
  - `mediaType`
- Re-run the same import validation on repaired rows in the browser before apply.
- Keep server parsing authoritative for uploaded files. Client repair only edits the
  already-returned preview data and uses shared validation logic.
- Add an exportable CSV error report for failed rows/questions.
- Store lightweight import provenance on the local draft after apply.

## Non-Goals

This phase does not include:

- Free-form DOCX parsing.
- Embedded DOCX media extraction.
- AI repair or AI question generation.
- Persisting import reports to Firestore.
- Direct publishing from import preview.
- Changing the legacy assignment modal.

## Template Downloads

The import panel should expose three template downloads:

- `assignment-import-template.xlsx`
- `assignment-import-template.csv`
- `assignment-import-template.docx`

The spreadsheet templates use the Phase 6 canonical headers:

```txt
section,skill,responseMode,prompt,instructions,optionA,optionB,optionC,optionD,correctAnswer,acceptedAnswers,points,level,mediaUrl,mediaType,transcript
```

The template should include at least two example rows:

- A `multiple_choice` listening question.
- A `short_answer` reading question.

The DOCX template should use the strict Phase 6 text format:

```txt
# Section: Listening
Skill: listening
Instructions: Listen and choose the best answer.

Q: What does the speaker want?
Type: multiple_choice
A. A ticket
B. A book
Answer: A
Points: 1
Level: A2
Media: https://cdn.example.com/listening-1.mp3
Media Type: audio
---
Q: Write the missing word.
Type: short_answer
Answer: ticket; tickets
Points: 2
Level: A2
```

## Repair Model

Phase 6 returns parsed valid sections and structured issues. Phase 7 should add a
row-based repair model so the UI can edit invalid rows without asking the teacher to
upload the file again.

Add a shared row type:

```ts
interface AuthoringImportEditableRow {
  rowId: string;
  sourceRow?: number;
  section: string;
  skill: string;
  responseMode: string;
  prompt: string;
  instructions: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  acceptedAnswers: string;
  points: string;
  level: string;
  mediaUrl: string;
  mediaType: string;
  transcript: string;
}
```

Extend `AuthoringImportPreview` with:

```ts
editableRows: AuthoringImportEditableRow[];
```

The server parser should populate `editableRows` for both valid and invalid rows. The
existing `sections` field stays as the current valid-only apply payload.

Add shared validation:

```ts
validateAuthoringImportRows(rows, source, filename): AuthoringImportPreview
```

Both server parsing and browser repair should use this helper so a repaired row follows
the same rules as initial import.

## UI Flow

The import panel has four compact regions:

1. Template downloads.
2. Upload and preview.
3. Summary and issue list.
4. Repair table and apply actions.

When a preview has errors:

- Show repair rows by default.
- Highlight rows with errors.
- Allow inline editing in compact controls.
- Add a `Revalidate` button.
- Disable `Append` and `Replace` until there is at least one valid question.

When a preview has warnings only:

- Show the summary and issues.
- Keep repair rows collapsed by default.
- Allow apply immediately.

After the teacher edits rows:

1. Client calls shared `validateAuthoringImportRows`.
2. Summary counts update.
3. Valid rows become available for apply.
4. Invalid rows remain visible with their issue messages.

## Error Report Export

Add a CSV export action when `issues.length > 0`.

Columns:

```txt
filename,source,row,questionNumber,severity,field,code,message,sectionTitle
```

The export is generated in the browser from the current preview state. If the teacher
edits and revalidates, exported errors reflect the latest validation result.

## Import Provenance

Add lightweight local provenance to `AssignmentAuthoringDraft`:

```ts
interface AuthoringImportReport {
  filename: string;
  source: AuthoringImportSource;
  appliedAt: string;
  mode: AuthoringImportMode;
  totalQuestions: number;
  validQuestions: number;
  warningCount: number;
  errorCount: number;
}
```

Add optional `lastImportReport?: AuthoringImportReport` to the draft. It should be saved
with local/server draft sync, but it is not included in the final `assignment-create`
payload.

When the teacher applies an import preview:

- Store `lastImportReport` on the draft.
- Show a compact badge in the workbench header or import panel:
  `Imported from unit-1.xlsx - 12 valid / 3 errors`.

## Data Flow

1. Teacher downloads a template or uploads an existing file.
2. Server parses upload into `AuthoringImportPreview`, including `editableRows`.
3. UI shows summary and issue list.
4. Teacher edits rows if needed.
5. Client revalidates rows using shared validation.
6. Teacher applies valid rows via append or replace.
7. Workbench stores local import report on the draft.
8. Existing autosave and server sync persist the draft.
9. Existing readiness validation remains the final publish gate.

## Testing Strategy

Shared tests:

- Convert editable rows into a valid preview.
- Missing `responseMode` stays an error until repaired.
- Repaired multiple-choice row becomes valid after adding response mode/options/answer.
- Applying preview stores `lastImportReport`.
- Assignment publish payload omits `lastImportReport`.

Parser tests:

- XLSX preview includes `editableRows` for valid and invalid rows.
- CSV preview includes source row numbers.
- DOCX template preview includes editable rows.

Template tests:

- XLSX template contains canonical headers and example rows.
- CSV template contains canonical headers and example rows.
- DOCX template contains strict template markers.

UI tests:

- Template buttons download the expected file names.
- Preview with errors shows repair controls.
- Editing a row and clicking `Revalidate` updates counts.
- Append applies repaired valid rows.
- Error CSV export includes current issue rows.
- Last import report is displayed after apply.

Regression tests:

- Phase 6 import preview still supports append and replace.
- Existing draft autosave and publish readiness still work.
- Existing full assignment authoring tests continue to pass.

## Acceptance Criteria

- Teachers can download `.xlsx`, `.csv`, and `.docx` templates from the import panel.
- Import preview includes editable row data for every parsed row/question.
- Teachers can repair common row errors without re-uploading the file.
- Revalidation uses the same shared rules as server import parsing.
- Teachers can export current import issues to CSV.
- Applying an import stores a local `lastImportReport` on the draft.
- Published assignments do not include import report metadata.
- Existing focused import tests, full Vitest suite, typecheck, and build pass.
