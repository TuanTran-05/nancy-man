# Assignment Authoring Import Design

## Goal

Add controlled assignment import to the Assignment Authoring Workbench so teachers can
turn existing Excel, CSV, and DOCX-template materials into Assessment v2 draft
questions without bypassing preview, validation, autosave, or publish readiness.

This is Phase 6 of the assignment authoring workbench. It builds on the current
workbench, draft sync, question/media bank, student preview, and publish readiness
features.

## Decisions

- Support `.xlsx`, `.csv`, and `.docx` imports.
- Treat Word import as `.docx` template import only. Legacy `.doc` files are rejected.
- Parse files server-side behind `/api/v1/edu/assignment-draft-import-preview`.
- Return an import preview; do not mutate Firestore directly from upload.
- Let the teacher choose `append` or `replace` after preview, defaulting to `append`.
- Import only valid questions into the draft. Invalid questions stay in the report.
- Support media by `https://` URL metadata only. Embedded DOCX images/audio are not
  extracted in this phase.
- Reuse Assessment v2 validation concepts so imported content publishes through the
  same existing safe assignment path.

## Non-Goals

This phase does not include:

- Free-form DOCX parsing that guesses arbitrary teacher formatting.
- Embedded image/audio extraction from DOCX.
- Google Docs import.
- AI question generation from raw documents.
- Direct publish from an import file.
- Changing the legacy quick assignment modal.
- Migrating old legacy quiz assignments.

## Import Template

### Spreadsheet Columns

The spreadsheet import accepts the first worksheet for `.xlsx` and the full file for
`.csv`. Header names are case-insensitive and accent-insensitive where aliases are
provided.

Required columns:

- `section`
- `skill`
- `responseMode`
- `prompt`

Optional columns:

- `instructions`
- `optionA`
- `optionB`
- `optionC`
- `optionD`
- `correctAnswer`
- `acceptedAnswers`
- `points`
- `level`
- `mediaUrl`
- `mediaType`
- `transcript`

`skill` must be one of `listening`, `reading`, `speaking`, or `writing`.
`responseMode` must be one of `multiple_choice`, `short_answer`, `long_answer`,
`speaking_recording`, or `file_upload`.

### DOCX Template

DOCX import uses a strict plain-text template extracted from the document:

```txt
# Section: Listening
Skill: listening
Instructions: Listen and choose the best answer.

Q: What does the speaker want?
Type: multiple_choice
A. A ticket
B. A book
C. A map
D. A phone
Answer: B
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

The parser starts a new section when it sees `# Section:` and starts a new question
when it sees `Q:`. The `---` divider is optional between questions, but recommended.

## Validation

The import preview classifies issues as:

- `error`: blocks that specific question from being imported.
- `warning`: allows import but should be visible to the teacher.

Errors:

- Missing section title.
- Invalid skill.
- Missing prompt.
- Invalid response mode.
- Multiple-choice question has fewer than two completed options.
- Multiple-choice `correctAnswer` does not match an option key.
- Media URL exists but does not start with `https://`.
- Media URL exists but `mediaType` is invalid or cannot be inferred.
- Points is present but is not a positive number.

Warnings:

- Missing `correctAnswer` for short-answer questions.
- Missing `points`, defaulting to `1`.
- Missing `level`.
- DOCX text appears outside a section or question and is ignored.

## Data Flow

1. Teacher opens import panel from the workbench right rail.
2. Teacher chooses a file and clicks preview.
3. Client uploads multipart form data to
   `/api/v1/edu/assignment-draft-import-preview`.
4. Server verifies teacher/admin/level-manager access, file extension, MIME, size, and
   binary signature where applicable.
5. Server parses file into an import preview with valid Assessment v2 sections and
   structured issues.
6. UI shows summary counts, valid questions, warnings, and errors.
7. Teacher chooses `append` or `replace`.
8. Client applies valid preview sections to the local draft.
9. Existing local autosave and server draft sync persist the changed draft.
10. Existing publish readiness handles final assignment validation.

## API Shape

Endpoint:

```txt
POST /api/v1/edu/assignment-draft-import-preview
```

Request:

- Multipart field `file`.

Response:

```ts
interface AuthoringImportPreview {
  source: 'xlsx' | 'csv' | 'docx';
  filename: string;
  totalQuestions: number;
  validQuestions: number;
  warningCount: number;
  errorCount: number;
  sections: AuthoringImportSection[];
  issues: AuthoringImportIssue[];
}
```

The endpoint has no database write side effect.

## Frontend

Add an import panel in the right rail near templates and bank panels.

The panel should:

- Accept `.xlsx`, `.csv`, and `.docx`.
- Show an upload/preview button.
- Display counts for total, valid, warnings, and errors.
- Show the first useful rows/questions from the preview.
- Show errors with source row/question labels.
- Offer `Append` and `Replace` actions after preview.
- Default to `Append`.
- Disable apply if there are zero valid questions.

After apply:

- `append` adds imported sections after existing sections.
- `replace` replaces existing draft sections with imported sections.
- The first imported question becomes selected.
- The draft sync status becomes `local_pending`.

## Testing Strategy

Shared/helper tests:

- Applying import preview in append mode keeps existing sections and adds imported
  sections.
- Applying import preview in replace mode replaces existing sections.
- Imported questions receive fresh ids.
- Media URL validation stays compatible with authoring readiness.

Parser tests:

- XLSX valid multiple-choice row parses into one valid question.
- CSV valid short-answer row parses accepted answers.
- Invalid multiple-choice row appears as an error and is not imported.
- DOCX template with two questions parses into one section.
- DOCX with non-HTTPS media URL reports an error.
- Row/question-level partial success preserves valid questions.
- Too many questions and unsupported file types fail with 400-style errors.

API tests:

- Teacher can upload an `.xlsx` and receives a preview.
- Student cannot access the endpoint.
- Unsupported file extension is rejected.
- Endpoint does not write assignment draft documents.

UI tests:

- Import panel previews a file.
- Append applies imported questions without removing existing draft content.
- Replace applies imported questions and removes previous draft sections.
- Error-only preview disables apply.
- Publish readiness still catches incomplete imported content.

## Acceptance Criteria

- Teachers can preview `.xlsx`, `.csv`, and `.docx` assignment files in the workbench.
- A preview shows valid counts, warnings, errors, and parsed questions before applying.
- Teachers can append or replace the current draft with valid imported questions.
- Invalid questions are not inserted into the draft.
- Media URLs must be `https://`.
- Embedded DOCX media is not silently imported.
- Imported drafts continue through existing autosave, student preview, readiness, and
  publish flows.
- Existing assignment authoring tests, API tests, typecheck, and build pass.
