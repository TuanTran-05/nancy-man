import { z } from 'zod';

export const ASSIGNMENT_ASSESSMENT_VERSION = 2 as const;

export const ASSESSMENT_MODES = ['practice', 'test'] as const;
export const ASSESSMENT_SKILLS = ['listening', 'reading', 'speaking', 'writing', 'mixed'] as const;
export const QUESTION_SKILLS = ['listening', 'reading', 'speaking', 'writing'] as const;
export const ASSESSMENT_RESPONSE_MODES = [
  'multiple_choice',
  'short_answer',
  'long_answer',
  'speaking_recording',
  'file_upload',
] as const;
export const QUESTION_MEDIA_TYPES = ['audio', 'video', 'image', 'document'] as const;
export const QUESTION_MEDIA_SOURCES = ['upload', 'external_url'] as const;
export const QUESTION_MEDIA_DISPLAY_MODES = [
  'inline',
  'attachment',
  'hidden_until_review',
] as const;
export const ASSESSMENT_GRADING_MODES = ['auto', 'manual', 'hybrid'] as const;

export const ASSESSMENT_INTERACTION_TYPES = [
  'multiple_choice',
  'multiple_select',
  'short_answer',
  'long_answer',
  'fill_blank',
  'matching',
  'ordering',
  'listening',
  'reading_section',
  'image_question',
  'speaking_recording',
  'file_upload',
] as const;

export const quizOptionSchema = z.object({
  key: z.string().trim().min(1).max(8),
  text: z.string().trim().min(1).max(2000),
});

export const rubricItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  maxPoints: z.number().min(0).max(1000),
  description: z.string().trim().max(2000).optional(),
});

export const questionMediaSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    type: z.enum(QUESTION_MEDIA_TYPES),
    source: z.enum(QUESTION_MEDIA_SOURCES),
    url: z.string().trim().url().max(4000),
    storagePath: z.string().trim().min(1).max(1000).optional(),
    title: z.string().trim().max(300).optional(),
    altText: z.string().trim().max(1000).optional(),
    transcript: z.string().trim().max(20000).optional(),
    thumbnailUrl: z.string().trim().url().max(4000).optional(),
    durationSeconds: z
      .number()
      .min(0)
      .max(24 * 60 * 60)
      .optional(),
    displayMode: z.enum(QUESTION_MEDIA_DISPLAY_MODES).optional(),
  })
  .superRefine((media, ctx) => {
    if (media.source === 'external_url' && !media.url.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'External assessment media URLs must use https.',
      });
    }
    if (media.source === 'upload' && !media.storagePath) {
      ctx.addIssue({
        code: 'custom',
        path: ['storagePath'],
        message: 'Uploaded assessment media must include storagePath.',
      });
    }
  });

const blankSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(300),
  acceptedAnswers: z.array(z.string().trim().min(1)).default([]),
});

const matchingPairSchema = z.object({
  id: z.string().trim().min(1).max(120),
  left: z.string().trim().min(1).max(2000),
  right: z.string().trim().min(1).max(2000),
});

const orderingItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(2000),
});

const assessmentQuestionBaseSchema = z.object({
  id: z.string().trim().min(1).max(120),
  skill: z.enum(QUESTION_SKILLS),
  prompt: z.string().trim().min(1).max(20000),
  media: z.array(questionMediaSchema).default([]),
  responseMode: z.enum(ASSESSMENT_RESPONSE_MODES),
  interactionType: z.enum(ASSESSMENT_INTERACTION_TYPES).optional(),
  required: z.boolean().optional(),
  options: z.array(quizOptionSchema).optional(),
  optionMedia: z.record(z.string(), z.array(questionMediaSchema)).optional(),
  blanks: z.array(blankSchema).optional(),
  matchingPairs: z.array(matchingPairSchema).optional(),
  orderingItems: z.array(orderingItemSchema).optional(),
  passage: z.string().trim().max(50000).optional(),
  points: z.number().min(0).max(1000).optional(),
  level: z.string().trim().max(100).optional(),
});

export const assessmentQuestionSchema = assessmentQuestionBaseSchema;

export const assessmentQuestionInputSchema = assessmentQuestionBaseSchema.extend({
  correctAnswer: z
    .union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)])
    .optional(),
  acceptedAnswers: z.array(z.string().trim().min(1)).optional(),
  gradingMode: z.enum(ASSESSMENT_GRADING_MODES).optional(),
  rubric: z.array(rubricItemSchema).optional(),
});

const assessmentSectionBaseSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  skill: z.enum(ASSESSMENT_SKILLS),
  instructions: z.string().trim().max(10000).optional(),
});

export const assessmentSectionSchema = assessmentSectionBaseSchema.extend({
  questions: z.array(assessmentQuestionSchema).min(1),
});

export const assessmentSectionInputSchema = assessmentSectionBaseSchema.extend({
  questions: z.array(assessmentQuestionInputSchema).min(1),
});

export const assessmentSettingsSchema = z.object({
  showTranscriptDuringAttempt: z.boolean().default(false),
  showCorrectAnswersAfterSubmit: z.boolean().default(false),
  allowFreeMediaPlayback: z.boolean().default(true),
});

function validateAssessmentUniqueness(
  sections: Array<{
    id: string;
    questions: Array<{ id: string; responseMode: string; options?: unknown[] }>;
  }>,
  ctx: z.RefinementCtx
) {
  const sectionIds = new Set<string>();
  const questionIds = new Set<string>();

  sections.forEach((section, sectionIndex) => {
    if (sectionIds.has(section.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections', sectionIndex, 'id'],
        message: `Duplicate section id: ${section.id}`,
      });
    }
    sectionIds.add(section.id);

    section.questions.forEach((question, questionIndex) => {
      if (questionIds.has(question.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', sectionIndex, 'questions', questionIndex, 'id'],
          message: `Duplicate question id: ${question.id}`,
        });
      }
      questionIds.add(question.id);

      if (
        question.responseMode === 'multiple_choice' &&
        (!Array.isArray(question.options) || question.options.length < 2)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', sectionIndex, 'questions', questionIndex, 'options'],
          message: 'Multiple-choice assessment questions must include at least two options.',
        });
      }
    });
  });
}

export const assignmentAssessmentSchema = z
  .object({
    version: z.literal(ASSIGNMENT_ASSESSMENT_VERSION),
    mode: z.enum(ASSESSMENT_MODES).default('practice'),
    settings: assessmentSettingsSchema.optional(),
    sections: z.array(assessmentSectionSchema).min(1),
  })
  .superRefine((assessment, ctx) => validateAssessmentUniqueness(assessment.sections, ctx));

export const assignmentAssessmentInputSchema = z
  .object({
    version: z.literal(ASSIGNMENT_ASSESSMENT_VERSION),
    mode: z.enum(ASSESSMENT_MODES).default('practice'),
    settings: assessmentSettingsSchema.optional(),
    sections: z.array(assessmentSectionInputSchema).min(1),
  })
  .superRefine((assessment, ctx) => validateAssessmentUniqueness(assessment.sections, ctx));

export type AssessmentMode = (typeof ASSESSMENT_MODES)[number];
export type AssessmentSkill = (typeof ASSESSMENT_SKILLS)[number];
export type QuestionSkill = (typeof QUESTION_SKILLS)[number];
export type AssessmentResponseMode = (typeof ASSESSMENT_RESPONSE_MODES)[number];
export type QuestionMediaType = (typeof QUESTION_MEDIA_TYPES)[number];
export type QuestionMediaSource = (typeof QUESTION_MEDIA_SOURCES)[number];
export type QuestionMediaDisplayMode = (typeof QUESTION_MEDIA_DISPLAY_MODES)[number];
export type AssessmentGradingMode = (typeof ASSESSMENT_GRADING_MODES)[number];
export type AssessmentInteractionType = (typeof ASSESSMENT_INTERACTION_TYPES)[number];

export type QuizOptionLike = z.infer<typeof quizOptionSchema>;
export type RubricItem = z.infer<typeof rubricItemSchema>;
export type QuestionMedia = z.infer<typeof questionMediaSchema>;
export type FillBlankItem = z.infer<typeof blankSchema>;
export type MatchingPair = z.infer<typeof matchingPairSchema>;
export type OrderingItem = z.infer<typeof orderingItemSchema>;
export type AssessmentQuestion = z.infer<typeof assessmentQuestionSchema>;
export type AssessmentQuestionInput = z.infer<typeof assessmentQuestionInputSchema>;
export type AssessmentSection = z.infer<typeof assessmentSectionSchema>;
export type AssessmentSectionInput = z.infer<typeof assessmentSectionInputSchema>;
export type AssignmentAssessment = z.infer<typeof assignmentAssessmentSchema>;
export type AssignmentAssessmentInput = z.infer<typeof assignmentAssessmentInputSchema>;

export interface PrivateAssessmentQuestionKey {
  questionId: string;
  correctAnswer?: string | string[];
  acceptedAnswers?: string[];
  gradingMode?: AssessmentGradingMode;
  rubric?: RubricItem[];
}

export interface AssessmentAnswer {
  questionId: string;
  responseMode: AssessmentResponseMode;
  selectedOption?: string;
  textAnswer?: string;
  uploadedFile?: QuestionMedia;
  recording?: QuestionMedia;
}

export interface AssessmentQuestionScore {
  questionId: string;
  pointsAwarded: number;
  maxPoints: number;
  gradingMode: AssessmentGradingMode;
  feedback?: string;
  rubricScores?: Array<{
    rubricItemId: string;
    pointsAwarded: number;
  }>;
}

export interface AssessmentScore {
  totalPoints: number;
  maxPoints: number;
  questionScores: AssessmentQuestionScore[];
}

function defaultAssessmentSettings(
  settings: AssignmentAssessment['settings']
): Required<NonNullable<AssignmentAssessment['settings']>> {
  return {
    allowFreeMediaPlayback: settings?.allowFreeMediaPlayback ?? true,
    showCorrectAnswersAfterSubmit: settings?.showCorrectAnswersAfterSubmit ?? false,
    showTranscriptDuringAttempt: settings?.showTranscriptDuringAttempt ?? false,
  };
}

export function extractAssessmentKeys(value: unknown): {
  safeAssessment: AssignmentAssessment;
  keyMap: Record<string, PrivateAssessmentQuestionKey>;
} {
  const parsed = assignmentAssessmentInputSchema.parse(value);
  const keyMap: Record<string, PrivateAssessmentQuestionKey> = {};

  const safeAssessment: AssignmentAssessment = {
    version: ASSIGNMENT_ASSESSMENT_VERSION,
    mode: parsed.mode,
    settings: defaultAssessmentSettings(parsed.settings),
    sections: parsed.sections.map((section) => ({
      id: section.id,
      title: section.title,
      skill: section.skill,
      ...(section.instructions !== undefined ? { instructions: section.instructions } : {}),
      questions: section.questions.map((question) => {
        const { correctAnswer, acceptedAnswers, gradingMode, rubric, ...safeQuestion } = question;

        if (
          correctAnswer !== undefined ||
          acceptedAnswers !== undefined ||
          gradingMode !== undefined ||
          (rubric !== undefined && rubric.length > 0)
        ) {
          keyMap[question.id] = {
            questionId: question.id,
            ...(correctAnswer !== undefined ? { correctAnswer } : {}),
            ...(acceptedAnswers !== undefined ? { acceptedAnswers } : {}),
            ...(gradingMode !== undefined ? { gradingMode } : {}),
            ...(rubric !== undefined ? { rubric } : {}),
          };
        }

        return safeQuestion;
      }),
    })),
  };

  return { safeAssessment, keyMap };
}

function stripTranscript(media: QuestionMedia): QuestionMedia {
  const { transcript, ...safeMedia } = media;
  return safeMedia;
}

export function projectAssignmentAssessmentForRole(
  value: unknown,
  role: string
): AssignmentAssessment | undefined {
  const parsed = assignmentAssessmentSchema.safeParse(value);
  if (parsed.success === false) return undefined;

  const settings = defaultAssessmentSettings(parsed.data.settings);
  const canSeeTranscripts =
    role === 'admin' || role === 'teacher' || settings.showTranscriptDuringAttempt === true;

  return {
    ...parsed.data,
    settings,
    sections: parsed.data.sections.map((section) => ({
      ...section,
      questions: section.questions.map((question) => ({
        ...question,
        media: canSeeTranscripts ? question.media : question.media.map(stripTranscript),
      })),
    })),
  };
}

export function getAssessmentQuestionList(assessment: AssignmentAssessment) {
  return assessment.sections.flatMap((section) => section.questions);
}

export function normalizeAssessmentAnswers(
  value: unknown,
  assessment: AssignmentAssessment
): AssessmentAnswer[] {
  if (!Array.isArray(value)) return [];

  const questionsById = new Map(
    getAssessmentQuestionList(assessment).map((question) => [question.id, question])
  );
  const answersByQuestionId = new Map<string, AssessmentAnswer>();

  for (const rawAnswer of value) {
    if (!rawAnswer || typeof rawAnswer !== 'object') continue;
    const answer = rawAnswer as Record<string, unknown>;
    const questionId = typeof answer.questionId === 'string' ? answer.questionId.trim() : '';
    const question = questionsById.get(questionId);
    if (!question) continue;

    if (question.responseMode === 'multiple_choice' && typeof answer.selectedOption === 'string') {
      const selectedOption = answer.selectedOption.trim();
      if (selectedOption) {
        answersByQuestionId.set(questionId, {
          questionId,
          responseMode: 'multiple_choice',
          selectedOption,
        });
      }
      continue;
    }

    if (
      (question.responseMode === 'short_answer' || question.responseMode === 'long_answer') &&
      typeof answer.textAnswer === 'string'
    ) {
      const textAnswer = answer.textAnswer.trim();
      if (textAnswer) {
        answersByQuestionId.set(questionId, {
          questionId,
          responseMode: question.responseMode,
          textAnswer,
        });
      }
      continue;
    }

    if (question.responseMode === 'speaking_recording') {
      const recording = questionMediaSchema.safeParse(answer.recording);
      if (recording.success) {
        answersByQuestionId.set(questionId, {
          questionId,
          responseMode: 'speaking_recording',
          recording: recording.data,
        });
      }
      continue;
    }

    if (question.responseMode === 'file_upload') {
      const uploadedFile = questionMediaSchema.safeParse(answer.uploadedFile);
      if (uploadedFile.success) {
        answersByQuestionId.set(questionId, {
          questionId,
          responseMode: 'file_upload',
          uploadedFile: uploadedFile.data,
        });
      }
    }
  }

  return getAssessmentQuestionList(assessment)
    .map((question) => answersByQuestionId.get(question.id))
    .filter((answer): answer is AssessmentAnswer => Boolean(answer));
}

export function getAssessmentProgress(
  assessment: AssignmentAssessment,
  answers: AssessmentAnswer[]
) {
  const questionIds = new Set(getAssessmentQuestionList(assessment).map((question) => question.id));
  const normalizedAnswers = normalizeAssessmentAnswers(answers, assessment);
  const answered = new Set(
    normalizedAnswers
      .filter((answer) => questionIds.has(answer.questionId))
      .map((answer) => answer.questionId)
  ).size;
  const total = questionIds.size;
  return {
    answered,
    total,
    percent: total > 0 ? Math.round((answered / total) * 100) : 0,
  };
}

export function scoreAssessmentMultipleChoice(
  assessment: AssignmentAssessment,
  answers: AssessmentAnswer[],
  keyMap: Record<string, PrivateAssessmentQuestionKey>
): { canAutoGradeAll: boolean; grade: number | null; score: AssessmentScore } {
  const answersById = new Map(answers.map((answer) => [answer.questionId, answer]));
  const questionScores: AssessmentQuestionScore[] = [];
  let totalPoints = 0;
  let maxPoints = 0;
  let canAutoGradeAll = true;

  for (const question of getAssessmentQuestionList(assessment)) {
    const maxQuestionPoints = Number(question.points ?? 1);
    maxPoints += maxQuestionPoints;
    const key = keyMap[question.id];

    if (question.responseMode !== 'multiple_choice') {
      canAutoGradeAll = false;
      questionScores.push({
        questionId: question.id,
        pointsAwarded: 0,
        maxPoints: maxQuestionPoints,
        gradingMode: key?.gradingMode || 'manual',
      });
      continue;
    }

    const answer = answersById.get(question.id);
    const correctAnswer = key?.correctAnswer;
    const correctAnswers = Array.isArray(correctAnswer)
      ? correctAnswer
      : correctAnswer
        ? [correctAnswer]
        : [];

    if (correctAnswers.length === 0) canAutoGradeAll = false;
    const isCorrect =
      answer?.responseMode === 'multiple_choice' &&
      correctAnswers.includes(answer.selectedOption || '');
    const pointsAwarded = isCorrect ? maxQuestionPoints : 0;
    totalPoints += pointsAwarded;
    questionScores.push({
      questionId: question.id,
      pointsAwarded,
      maxPoints: maxQuestionPoints,
      gradingMode: 'auto',
    });
  }

  return {
    canAutoGradeAll,
    grade:
      canAutoGradeAll && maxPoints > 0 ? Number(((totalPoints / maxPoints) * 10).toFixed(1)) : null,
    score: {
      totalPoints,
      maxPoints,
      questionScores,
    },
  };
}

export interface AssessmentQuestionGradeInput {
  questionId: string;
  pointsAwarded: number;
  feedback?: string;
  rubricScores?: Array<{
    rubricItemId: string;
    pointsAwarded: number;
  }>;
}

export type AssessmentReviewRole = 'admin' | 'teacher' | 'student' | 'parent';

function pointsForQuestion(question: AssessmentQuestion): number {
  return Number.isFinite(question.points) ? Number(question.points) : 1;
}

export function calculateAssessmentGrade(score: AssessmentScore): number | null {
  if (!Number.isFinite(score.maxPoints) || score.maxPoints <= 0) return null;
  return Number(((score.totalPoints / score.maxPoints) * 10).toFixed(1));
}

export function applyAssessmentQuestionGrades(
  assessment: AssignmentAssessment,
  existingScore: AssessmentScore | undefined | null,
  gradeInputs: AssessmentQuestionGradeInput[]
): { assessmentScore: AssessmentScore; grade: number | null } {
  const questions = getAssessmentQuestionList(assessment);
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const existingById = new Map(
    (existingScore?.questionScores || []).map((score) => [score.questionId, score])
  );
  const inputById = new Map<string, AssessmentQuestionGradeInput>();

  for (const input of gradeInputs) {
    const questionId = String(input.questionId || '').trim();
    const question = questionById.get(questionId);
    if (!question) throw new Error(`Unknown assessment question ${questionId}`);

    const maxPoints = pointsForQuestion(question);
    const pointsAwarded = Number(input.pointsAwarded);
    if (!Number.isFinite(pointsAwarded) || pointsAwarded < 0 || pointsAwarded > maxPoints) {
      throw new Error(`Invalid points for question ${questionId}`);
    }

    inputById.set(questionId, {
      questionId,
      pointsAwarded,
      ...(input.feedback?.trim() ? { feedback: input.feedback.trim() } : {}),
      ...(Array.isArray(input.rubricScores) && input.rubricScores.length > 0
        ? { rubricScores: input.rubricScores }
        : {}),
    });
  }

  const questionScores = questions.map((question) => {
    const maxPoints = pointsForQuestion(question);
    const existing = existingById.get(question.id);
    const input = inputById.get(question.id);
    const gradingMode =
      existing?.gradingMode || (question.responseMode === 'multiple_choice' ? 'auto' : 'manual');

    return {
      questionId: question.id,
      pointsAwarded: input?.pointsAwarded ?? existing?.pointsAwarded ?? 0,
      maxPoints,
      gradingMode,
      ...(input?.feedback
        ? { feedback: input.feedback }
        : existing?.feedback
          ? { feedback: existing.feedback }
          : {}),
      ...(input?.rubricScores
        ? { rubricScores: input.rubricScores }
        : existing?.rubricScores
          ? { rubricScores: existing.rubricScores }
          : {}),
    };
  });

  const assessmentScore: AssessmentScore = {
    totalPoints: Number(
      questionScores.reduce((sum, score) => sum + score.pointsAwarded, 0).toFixed(2)
    ),
    maxPoints: Number(questionScores.reduce((sum, score) => sum + score.maxPoints, 0).toFixed(2)),
    questionScores,
  };

  return { assessmentScore, grade: calculateAssessmentGrade(assessmentScore) };
}

export function projectAssessmentKeysForReview(
  keyMap: Record<string, PrivateAssessmentQuestionKey>,
  role: AssessmentReviewRole
): Record<string, PrivateAssessmentQuestionKey> {
  const canSeeRubric = role === 'admin' || role === 'teacher';
  return Object.fromEntries(
    Object.entries(keyMap).map(([questionId, key]) => [
      questionId,
      {
        questionId: key.questionId,
        ...(key.correctAnswer !== undefined ? { correctAnswer: key.correctAnswer } : {}),
        ...(key.acceptedAnswers !== undefined ? { acceptedAnswers: key.acceptedAnswers } : {}),
        ...(key.gradingMode !== undefined ? { gradingMode: key.gradingMode } : {}),
        ...(canSeeRubric && key.rubric !== undefined ? { rubric: key.rubric } : {}),
      },
    ])
  );
}
