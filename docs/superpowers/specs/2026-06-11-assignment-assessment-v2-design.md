# Assignment Assessment v2 Design

## Goal

Design a future-proof assignment assessment layer that lets teachers create listening,
reading, and later speaking assignments where each question can have its own audio,
video, image, or document media.

The design prioritizes long-term flexibility over immediate activation. The first usable
phase should support listening/reading questions with media, multiple-choice answers,
and short-answer responses. Speaking, file upload, AI scoring, playback restrictions,
and richer test engines should fit into the same foundation later without replacing the
data model again.

## Current Context

Assignments currently support:

- `type: 'essay' | 'quiz'`.
- `questions?: QuizQuestion[]` for quiz assignments.
- `quizAnswers?: QuizAnswer[]` in submissions.
- Separate storage of correct quiz answers under each assignment's `quiz_answers`
  subcollection so students do not receive correct answers in the read payload.
- A single assignment creation modal and a student submission modal that render essay
  and quiz flows directly.

The current `QuizQuestion` shape is intentionally simple:

```ts
interface QuizQuestion {
  id: number;
  question_content: string;
  options: QuizOption[];
  correct_answer: string;
  level: string;
}
```

This is too narrow for per-question media, short answers, speaking recordings, rubric
grading, or section-based assessments. Extending this shape directly would be quick,
but it would make future changes harder.

## Decision

Use an **Assessment v2** model inside assignments while keeping legacy assignments
working unchanged.

The direction is:

- Keep existing `type`, `questions`, and `quizAnswers` paths for legacy essay/quiz.
- Add a versioned `assessment` object for new advanced assignments.
- Render Assessment v2 through dedicated builder, runner, and grading components.
- Store correct answers and sensitive rubric data separately from the student payload.
- Treat media as metadata in Firestore and store uploaded files in Firebase Storage.

This is effectively "design like a small assessment engine, implement gradually inside
the current assignment system."

## Scope

Included in the design:

- Versioned Assessment v2 schema.
- Sections for listening, reading, speaking, writing, and mixed work.
- Per-question media from upload or external URL.
- Multiple response modes: multiple choice, short answer, long answer, speaking
  recording, and file upload.
- Student answer payload for Assessment v2.
- Grading model that supports auto-scored and manually scored questions.
- Compatibility strategy for existing assignments.
- Phase plan for implementation.

Excluded from the first implementation phase:

- Replacing legacy assignment creation.
- Migrating all existing quiz data to Assessment v2.
- Speaking recording UI and storage.
- AI scoring.
- Playback restrictions such as maximum listens, disabled seeking, or locked speed.
- Randomized question pools and complex timed-test engines.

## Data Model

### Assignment Extension

Add `assessment?: AssignmentAssessment` to assignments.

```ts
interface Assignment {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  classId: string;
  teacherId: string;
  createdAt: string;
  type: 'essay' | 'quiz';
  questions?: QuizQuestion[];
  attemptsAllowed?: number;
  proctoringMode?: AssignmentProctoringMode;
  assessment?: AssignmentAssessment;
}
```

`assessment` is optional so old assignments remain valid.

### Assessment

```ts
interface AssignmentAssessment {
  version: 2;
  mode: 'practice' | 'test';
  sections: AssessmentSection[];
  settings?: AssessmentSettings;
}

interface AssessmentSettings {
  showTranscriptDuringAttempt?: boolean;
  showCorrectAnswersAfterSubmit?: boolean;
  allowFreeMediaPlayback?: boolean;
}
```

Defaults:

- `mode`: `practice`.
- `allowFreeMediaPlayback`: `true`.
- `showTranscriptDuringAttempt`: `false`.
- `showCorrectAnswersAfterSubmit`: follow the existing assignment review behavior.

### Sections

```ts
type AssessmentSkill = 'listening' | 'reading' | 'speaking' | 'writing' | 'mixed';

interface AssessmentSection {
  id: string;
  title: string;
  skill: AssessmentSkill;
  instructions?: string;
  questions: AssessmentQuestion[];
}
```

Sections make the model fit common English-center workflows: listening part, reading
passage, writing response, and later speaking prompts.

### Questions

```ts
type AssessmentResponseMode =
  | 'multiple_choice'
  | 'short_answer'
  | 'long_answer'
  | 'speaking_recording'
  | 'file_upload';

interface AssessmentQuestion {
  id: string;
  skill: Exclude<AssessmentSkill, 'mixed'>;
  prompt: string;
  media: QuestionMedia[];
  responseMode: AssessmentResponseMode;
  options?: QuizOption[];
  points?: number;
  level?: string;
}
```

Sensitive fields should not be stored in the student-safe question payload. Correct
answers and grading rules belong in a private answer/rubric document.

```ts
interface PrivateAssessmentQuestionKey {
  questionId: string;
  correctAnswer?: string | string[];
  acceptedAnswers?: string[];
  gradingMode?: 'auto' | 'manual' | 'hybrid';
  rubric?: RubricItem[];
}

interface RubricItem {
  id: string;
  label: string;
  maxPoints: number;
  description?: string;
}
```

## Question Media

Each question has `media: QuestionMedia[]`, not a single media URL. This supports one
audio prompt plus an image, a reading passage image plus a document, or a video plus a
thumbnail later.

```ts
type QuestionMediaType = 'audio' | 'video' | 'image' | 'document';
type QuestionMediaSource = 'upload' | 'external_url';

interface QuestionMedia {
  id: string;
  type: QuestionMediaType;
  source: QuestionMediaSource;
  url: string;
  storagePath?: string;
  title?: string;
  altText?: string;
  transcript?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  displayMode?: 'inline' | 'attachment' | 'hidden_until_review';
}
```

Behavior:

- Uploaded files live in Firebase Storage.
- Firestore stores only metadata and references.
- External media must use `https://`.
- The UI should warn teachers that external links can break.
- Audio/video/image render inline for students.
- Transcripts are stored but hidden during attempts by default.
- Media playback is free in phase one: replay, seek, and normal player controls are
  allowed.

## Submission Model

Keep `quizAnswers` for legacy quiz submissions and add `assessmentAnswers` for
Assessment v2.

```ts
interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  teacherId: string;
  classId: string;
  content: string;
  quizAnswers?: QuizAnswer[];
  assessmentAnswers?: AssessmentAnswer[];
  assessmentScore?: AssessmentScore;
  status: 'submitted' | 'graded';
  grade?: number;
  feedback?: string;
  submittedAt: string;
  attemptNumber?: number;
  examIntegrity?: ExamIntegrityPayload;
}

interface AssessmentAnswer {
  questionId: string;
  responseMode: AssessmentResponseMode;
  selectedOption?: string;
  textAnswer?: string;
  uploadedFile?: QuestionMedia;
  recording?: QuestionMedia;
}
```

For phase one:

- `multiple_choice` can auto-score.
- `short_answer` can be stored for manual grading, with optional exact-match auto
  scoring later.
- `long_answer`, `speaking_recording`, and `file_upload` are supported by schema but
  can remain disabled in the UI until later phases.

## Grading Model

Assessment v2 grading should be per question, not only per submission.

```ts
interface AssessmentScore {
  totalPoints: number;
  maxPoints: number;
  questionScores: AssessmentQuestionScore[];
}

interface AssessmentQuestionScore {
  questionId: string;
  pointsAwarded: number;
  maxPoints: number;
  gradingMode: 'auto' | 'manual' | 'hybrid';
  feedback?: string;
  rubricScores?: {
    rubricItemId: string;
    pointsAwarded: number;
  }[];
}
```

The final `Submission.grade` can still store a normalized 0-10 score for dashboards and
reports. `assessmentScore` stores the detailed breakdown.

## Backend Design

### Validation

Add validation helpers for Assessment v2 instead of leaving it as `z.unknown()`.

Validation should check:

- `assessment.version === 2`.
- Section ids are non-empty and unique within the assignment.
- Question ids are non-empty and unique within the assignment.
- Supported `skill` and `responseMode` values.
- `media` entries use supported media types and sources.
- External URLs use `https://`.
- Uploaded media include `storagePath`.
- `multiple_choice` questions have at least two options.
- Private correct answers are extracted from create/update payloads before student-safe
  storage.

### Persistence

On assignment create/update:

1. Validate the public assessment payload.
2. Extract private answer/rubric data from questions.
3. Store safe assessment on the assignment document.
4. Store private answer/rubric data under a private subcollection, for example:
   `assignments/{assignmentId}/assessment_question_keys/{questionId}`.
5. Push realtime assignment deltas with safe assessment only.

### Reads

Read-model handlers must project Assessment v2 safely:

- Students receive prompts, media, response modes, options, points, and visible
  instructions.
- Students do not receive correct answers, accepted answers, private rubrics, hidden
  transcripts, or teacher-only notes.
- Teachers/admins can receive grading metadata where appropriate.

## Teacher UI

Introduce an **Advanced Assignment Builder** instead of expanding the current modal
until it becomes hard to use.

The existing modal remains the quick path for legacy essay/quiz. A new button such as
"Create advanced assignment" opens the builder.

Builder steps:

1. Assignment basics: title, class, due date, attempts, proctoring mode, description.
2. Assessment structure: add listening, reading, speaking, writing, or mixed sections.
3. Question editing: each question is a card with prompt, media manager, response mode,
   answer/rubric settings, points, and level.
4. Student preview: render exactly what students will see.
5. Publish: validate missing prompts, missing media, missing options, and missing
   answer keys where required.

Suggested components:

- `AssessmentBuilder`
- `SectionEditor`
- `QuestionCard`
- `QuestionMediaManager`
- `ResponseModeEditor`
- `RubricEditor`
- `StudentAssessmentPreview`

## Student UI

Add a `StudentAssessmentRunner` for assignments with `assessment.version === 2`.
Legacy assignments keep using the existing submission modal.

Runner behavior:

- Render sections in order.
- Render question cards by `responseMode`.
- Show audio/video/image inline inside each question.
- Let students replay and seek media freely in phase one.
- Save answers in a normalized `assessmentAnswers` array.
- Confirm submission when unanswered required questions remain.

Question renderers should be isolated:

- `MultipleChoiceQuestion`
- `ShortAnswerQuestion`
- `LongAnswerQuestion`
- `SpeakingRecordingQuestion` later
- `FileUploadQuestion` later

This boundary lets future question types be added without rewriting the runner.

## Review And Grading UI

Add an `AssessmentSubmissionReview` flow for teachers/admins.

It should show:

- The original question prompt and media.
- The student's answer.
- Correct answer and private rubric when the viewer is allowed to see them.
- Auto-scored result for multiple choice.
- Manual score and feedback inputs for short answer and future speaking/file-upload
  responses.
- Total score summary.

Students reviewing their own submission should see only allowed data, following existing
correct-answer visibility rules.

## Compatibility And Migration

No migration is required for phase one.

Routing logic:

- If `assignment.assessment?.version === 2`, use Assessment v2 builder/runner/review.
- Otherwise, use current essay/quiz behavior.

Existing reports and dashboards can continue to consume `Submission.grade`. Assessment
v2 grading writes both detailed `assessmentScore` and normalized `grade`.

Legacy quiz import can later offer a "convert to Assessment v2" action, but it is not
required initially.

## Security And Permissions

Security requirements:

- Student-safe payloads must not include correct answers or private rubrics.
- Uploaded media should use Storage paths owned by the assignment or question.
- Students should only access media for assignments in their class.
- External URLs should be rendered safely and never allow script URLs.
- File uploads should enforce content type and size limits.
- Future speaking recordings should be scoped to the student's submission and visible
  only to allowed staff/student/parent viewers.

## Testing Strategy

Targeted coverage should include:

- Assessment schema accepts valid listening/reading questions with media.
- Assessment schema rejects invalid media source/type/URL.
- Create/update extracts correct answers from Assessment v2 questions.
- Student read payload includes media but excludes correct answers and private rubrics.
- Teacher/admin grading payload can access private grading data.
- Student runner records `multiple_choice` and `short_answer` responses.
- Auto-scoring multiple choice produces per-question and total scores.
- Legacy essay/quiz assignments still render and submit unchanged.

## Phase Plan

### Phase 1: Shared Schema And Backend Foundation

- Add shared Assessment v2 types and validation helpers.
- Extend assignment create/update to accept safe Assessment v2 payloads.
- Extract private answer/rubric data to a private subcollection.
- Project safe assessment data through read handlers.
- Add tests for validation, extraction, and safe reads.

### Phase 2: Advanced Builder

- Add "Create advanced assignment" entry point.
- Build section and question editors.
- Add media manager for upload and external URLs.
- Support listening/reading sections, multiple-choice questions, and short-answer
  questions.
- Add student preview.

### Phase 3: Student Runner And Submission v2

- Add `StudentAssessmentRunner`.
- Store `assessmentAnswers`.
- Auto-score multiple-choice answers.
- Preserve manual grading path for short answers.
- Keep dashboards compatible through normalized `grade`.

### Phase 4: Grading v2 And Speaking Expansion

- Add per-question grading UI and rubric scoring.
- Enable `speaking_recording` questions.
- Store student recordings in Storage.
- Add playback for teachers and eligible reviewers.
- Consider AI scoring as an optional later extension.

## Open Decisions For Implementation

These do not block the design, but should be decided before implementation:

- Exact Firebase Storage path convention for assignment media.
- Maximum file sizes for audio, video, image, document, and future recordings.
- Whether short-answer exact-match auto-scoring is enabled in phase one or deferred.
- Whether parents can view assignment media and recordings after submission.
- Whether Advanced Assignment Builder should be a full page route or a large modal.

## Approved Direction

The approved direction is to choose long-term flexibility:

- Build a versioned Assessment v2 foundation.
- Keep legacy assignment flows intact.
- Implement UI and behavior in phases.
- Start with listening/reading media questions.
- Prepare the schema for speaking without forcing speaking to work immediately.
