import type {
  AssignmentAssessmentInput,
  AssessmentGradingMode,
  AssessmentQuestionInput,
  AssessmentResponseMode,
  AssessmentSkill,
  QuestionMedia,
  QuestionMediaSource,
  QuestionMediaType,
  QuizOptionLike,
} from './assignmentAssessment';
import type { AssignmentProctoringMode } from './assignmentProctoring';
import {
  type AssignmentDeliveryPolicy,
  normalizeAssignmentDeliveryPolicy,
  validateAssignmentDeliveryPolicy,
  DEFAULT_ASSIGNMENT_DELIVERY_POLICY,
} from './assignmentDelivery.js';
import { isApiDateTime, userDateTimeToApiIso } from './dateTimeFormat.js';

export const AUTHORING_BANK_VISIBILITIES = [
  'private',
  'pending_review',
  'shared',
  'archived',
] as const;

export type AuthoringBankVisibility = (typeof AUTHORING_BANK_VISIBILITIES)[number];
export type AssessmentTemplateKind = 'structure' | 'sample_content';
export type AuthoringDraftStatus = 'draft' | 'published' | 'archived';

export const AUTHORING_IMPORT_COLUMNS = [
  'section',
  'skill',
  'responseMode',
  'prompt',
  'instructions',
  'optionA',
  'optionB',
  'optionC',
  'optionD',
  'correctAnswer',
  'acceptedAnswers',
  'points',
  'level',
  'mediaUrl',
  'mediaType',
  'transcript',
] as const;

export type AuthoringImportColumn = (typeof AUTHORING_IMPORT_COLUMNS)[number];

export interface AssignmentAuthoringDraft {
  id: string;
  ownerUid: string;
  title: string;
  description: string;
  classId: string;
  dueDate: string;
  attemptsAllowed: number;
  proctoringMode: AssignmentProctoringMode;
  assessmentDraft: AssignmentAssessmentInput;
  status: AuthoringDraftStatus;
  localRevision: number;
  serverRevision: number;
  createdAt: string;
  updatedAt: string;
  publishedAssignmentId?: string;
  lastImportReport?: AuthoringImportReport;
  deliveryPolicy: AssignmentDeliveryPolicy;
}

export type AuthoringValidationArea = 'assignment' | 'section' | 'question' | 'media';

export type AuthoringValidationCode =
  | 'title_required'
  | 'class_required'
  | 'due_date_required'
  | 'due_date_invalid'
  | 'section_title_required'
  | 'question_prompt_required'
  | 'multiple_choice_options_required'
  | 'multiple_choice_correct_answer_required'
  | 'external_media_https_required'
  | 'uploaded_media_storage_path_required'
  | 'unsupported_interaction_type';

export interface AuthoringValidationIssue {
  code: AuthoringValidationCode;
  area: AuthoringValidationArea;
  message: string;
  sectionId?: string;
  questionId?: string;
  questionNumber?: number;
  mediaId?: string;
}

export interface AuthoringReadinessGroup {
  id: 'basics' | 'structure' | 'answers' | 'media';
  label: string;
  complete: boolean;
  issues: AuthoringValidationIssue[];
}

export type AuthoringImportSource = 'xlsx' | 'csv' | 'docx';
export type AuthoringImportMode = 'append' | 'replace';
export type AuthoringImportSeverity = 'warning' | 'error';

export type AuthoringImportIssueCode =
  | 'missing_section'
  | 'invalid_skill'
  | 'missing_prompt'
  | 'invalid_response_mode'
  | 'multiple_choice_options_required'
  | 'multiple_choice_correct_answer_required'
  | 'external_media_https_required'
  | 'invalid_media_type'
  | 'invalid_points'
  | 'points_defaulted'
  | 'short_answer_missing_key'
  | 'level_missing'
  | 'ignored_text';

export interface AuthoringImportIssue {
  code: AuthoringImportIssueCode;
  severity: AuthoringImportSeverity;
  message: string;
  row?: number;
  questionNumber?: number;
  sectionTitle?: string;
  field?: string;
}

export type AuthoringImportQuestion = Omit<AssessmentQuestionInput, 'id' | 'media'> & {
  media: Array<Omit<QuestionMedia, 'id'>>;
};

export interface AuthoringImportSection {
  title: string;
  skill: AssessmentSkill;
  instructions?: string;
  questions: AuthoringImportQuestion[];
}

export interface AuthoringImportPreview {
  source: AuthoringImportSource;
  filename: string;
  totalQuestions: number;
  validQuestions: number;
  warningCount: number;
  errorCount: number;
  sections: AuthoringImportSection[];
  issues: AuthoringImportIssue[];
  editableRows: AuthoringImportEditableRow[];
}

export interface AuthoringImportEditableRow {
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

export interface AuthoringImportReport {
  filename: string;
  source: AuthoringImportSource;
  appliedAt: string;
  mode: AuthoringImportMode;
  totalQuestions: number;
  validQuestions: number;
  warningCount: number;
  errorCount: number;
}

export interface ValidateAuthoringImportRowsInput {
  source: AuthoringImportSource;
  filename: string;
  rows: AuthoringImportEditableRow[];
  extraIssues?: AuthoringImportIssue[];
}

export interface AssessmentStructureTemplate {
  id: string;
  kind: AssessmentTemplateKind;
  title: string;
  description: string;
  sections: AssignmentAssessmentInput['sections'];
}

export interface AssessmentQuestionBankItem {
  id: string;
  ownerUid: string;
  ownerName?: string;
  visibility: AuthoringBankVisibility;
  skill: AssessmentQuestionInput['skill'];
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

export interface AssessmentMediaBankItem {
  id: string;
  ownerUid: string;
  ownerName?: string;
  visibility: AuthoringBankVisibility;
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

export interface AuthoringBulkQuestionUpdate {
  points?: number;
  level?: string;
  skill?: AssessmentQuestionInput['skill'];
}

export type AuthoringDraftFieldUpdate = Partial<
  Pick<
    AssignmentAuthoringDraft,
    | 'title'
    | 'description'
    | 'classId'
    | 'dueDate'
    | 'attemptsAllowed'
    | 'proctoringMode'
    | 'deliveryPolicy'
  >
>;

let nextAuthoringId = 1;

function authoringId(prefix: string) {
  const id = `${prefix}-${nextAuthoringId}`;
  nextAuthoringId += 1;
  return id;
}

function nowIso() {
  return new Date().toISOString();
}

function question(
  skill: AssessmentQuestionInput['skill'],
  responseMode: AssessmentResponseMode,
  prompt = ''
): AssessmentQuestionInput {
  return {
    id: authoringId('question'),
    skill,
    prompt,
    responseMode,
    media: [],
    points: 1,
    ...(responseMode === 'multiple_choice'
      ? {
          options: [
            { key: 'A', text: '' },
            { key: 'B', text: '' },
          ],
          correctAnswer: 'A',
          gradingMode: 'auto' as const,
        }
      : {
          acceptedAnswers: [],
          gradingMode: 'manual' as const,
        }),
  };
}

function section(skill: AssessmentSkill, title: string, count: number) {
  const questionSkill = skill === 'mixed' ? 'listening' : skill;
  return {
    id: authoringId('section'),
    title,
    skill,
    instructions: '',
    questions: Array.from({ length: count }, () => question(questionSkill, 'multiple_choice')),
  };
}

export function getStructureTemplates(): AssessmentStructureTemplate[] {
  return [
    {
      id: 'listening-practice',
      kind: 'structure',
      title: 'Listening practice',
      description: 'One listening section with three multiple-choice questions.',
      sections: [section('listening', 'Listening', 3)],
    },
    {
      id: 'reading-passage',
      kind: 'structure',
      title: 'Reading passage',
      description: 'One reading section with a short-answer and multiple-choice mix.',
      sections: [
        {
          ...section('reading', 'Reading', 2),
          questions: [question('reading', 'short_answer'), question('reading', 'multiple_choice')],
        },
      ],
    },
    {
      id: 'speaking-prompts',
      kind: 'structure',
      title: 'Speaking prompts',
      description: 'One speaking section with three recording prompts.',
      sections: [
        {
          ...section('speaking', 'Speaking', 3),
          questions: Array.from({ length: 3 }, () => question('speaking', 'speaking_recording')),
        },
      ],
    },
    {
      id: 'mixed-skills-homework',
      kind: 'structure',
      title: 'Mixed skills homework',
      description: 'Listening, reading, and speaking starter sections.',
      sections: [
        section('listening', 'Listening', 2),
        section('reading', 'Reading', 2),
        {
          ...section('speaking', 'Speaking', 1),
          questions: [question('speaking', 'speaking_recording')],
        },
      ],
    },
  ];
}

export function createBlankAuthoringDraft(ownerUid: string): AssignmentAuthoringDraft {
  const timestamp = nowIso();
  return {
    id: authoringId('draft'),
    ownerUid,
    title: '',
    description: '',
    classId: '',
    dueDate: '',
    attemptsAllowed: 1,
    proctoringMode: 'strict',
    assessmentDraft: {
      version: 2,
      mode: 'practice',
      settings: {
        allowFreeMediaPlayback: true,
        showCorrectAnswersAfterSubmit: false,
        showTranscriptDuringAttempt: false,
      },
      sections: [section('listening', 'Listening', 1)],
    },
    status: 'draft',
    localRevision: 0,
    serverRevision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    deliveryPolicy: DEFAULT_ASSIGNMENT_DELIVERY_POLICY,
  };
}

function bumpDraft(draft: AssignmentAuthoringDraft): AssignmentAuthoringDraft {
  return {
    ...draft,
    localRevision: draft.localRevision + 1,
    updatedAt: nowIso(),
  };
}

function cloneQuestion(source: AssessmentQuestionInput): AssessmentQuestionInput {
  return {
    ...structuredClone(source),
    id: authoringId('question'),
  };
}

export function applyStructureTemplate(
  draft: AssignmentAuthoringDraft,
  templateId: string
): AssignmentAuthoringDraft {
  const template = getStructureTemplates().find((item) => item.id === templateId);
  if (!template) throw new Error(`Unknown authoring template: ${templateId}`);
  return bumpDraft({
    ...draft,
    assessmentDraft: {
      ...draft.assessmentDraft,
      sections: structuredClone(template.sections),
    },
  });
}

export function duplicateQuestionInDraft(
  draft: AssignmentAuthoringDraft,
  questionId: string
): AssignmentAuthoringDraft {
  let duplicated = false;
  const sections = draft.assessmentDraft.sections.map((candidate) => {
    const index = candidate.questions.findIndex((item) => item.id === questionId);
    if (index < 0) return candidate;
    duplicated = true;
    return {
      ...candidate,
      questions: [
        ...candidate.questions.slice(0, index + 1),
        cloneQuestion(candidate.questions[index]),
        ...candidate.questions.slice(index + 1),
      ],
    };
  });
  if (!duplicated) throw new Error(`Unknown question: ${questionId}`);
  return bumpDraft({ ...draft, assessmentDraft: { ...draft.assessmentDraft, sections } });
}

export function moveQuestionInDraft(
  draft: AssignmentAuthoringDraft,
  questionId: string,
  destination: { sectionId: string; index: number }
): AssignmentAuthoringDraft {
  let movedQuestion: AssessmentQuestionInput | null = null;
  const withoutQuestion = draft.assessmentDraft.sections.map((sectionItem) => {
    const questions = sectionItem.questions.filter((candidate) => {
      if (candidate.id !== questionId) return true;
      movedQuestion = candidate;
      return false;
    });
    return { ...sectionItem, questions };
  });
  if (!movedQuestion) throw new Error(`Unknown question: ${questionId}`);

  const sections = withoutQuestion.map((sectionItem) => {
    if (sectionItem.id !== destination.sectionId) return sectionItem;
    const index = Math.max(0, Math.min(destination.index, sectionItem.questions.length));
    return {
      ...sectionItem,
      questions: [
        ...sectionItem.questions.slice(0, index),
        movedQuestion!,
        ...sectionItem.questions.slice(index),
      ],
    };
  });
  return bumpDraft({ ...draft, assessmentDraft: { ...draft.assessmentDraft, sections } });
}

export function reorderSectionInDraft(
  draft: AssignmentAuthoringDraft,
  sectionId: string,
  destinationIndex: number
): AssignmentAuthoringDraft {
  const currentIndex = draft.assessmentDraft.sections.findIndex(
    (section) => section.id === sectionId
  );
  if (currentIndex < 0) throw new Error(`Unknown section: ${sectionId}`);
  const sections = [...draft.assessmentDraft.sections];
  const [section] = sections.splice(currentIndex, 1);
  const index = Math.max(0, Math.min(destinationIndex, sections.length));
  sections.splice(index, 0, section);
  return bumpDraft({
    ...draft,
    assessmentDraft: {
      ...draft.assessmentDraft,
      sections,
    },
  });
}

function blankQuestionForSkill(skill: AssessmentQuestionInput['skill']): AssessmentQuestionInput {
  return {
    id: authoringId('question'),
    skill,
    responseMode: skill === 'speaking' ? 'speaking_recording' : 'short_answer',
    prompt: '',
    media: [],
    points: 1,
  };
}

export function addSectionToDraft(
  draft: AssignmentAuthoringDraft,
  input: { title: string; skill: AssessmentSkill; instructions?: string }
): AssignmentAuthoringDraft {
  const questionSkill: AssessmentQuestionInput['skill'] =
    input.skill === 'mixed' ? 'reading' : input.skill;
  return bumpDraft({
    ...draft,
    assessmentDraft: {
      ...draft.assessmentDraft,
      sections: [
        ...draft.assessmentDraft.sections,
        {
          id: authoringId('section'),
          title: input.title.trim() || 'New section',
          skill: input.skill,
          ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}),
          questions: [blankQuestionForSkill(questionSkill)],
        },
      ],
    },
  });
}

export function addQuestionToSection(
  draft: AssignmentAuthoringDraft,
  sectionId: string
): AssignmentAuthoringDraft {
  let inserted = false;
  const sections = draft.assessmentDraft.sections.map((section) => {
    if (section.id !== sectionId) return section;
    inserted = true;
    const questionSkill: AssessmentQuestionInput['skill'] =
      section.skill === 'mixed' ? 'reading' : section.skill;
    return { ...section, questions: [...section.questions, blankQuestionForSkill(questionSkill)] };
  });
  if (!inserted) throw new Error(`Unknown section: ${sectionId}`);
  return bumpDraft({ ...draft, assessmentDraft: { ...draft.assessmentDraft, sections } });
}

export function deleteQuestionsFromDraft(
  draft: AssignmentAuthoringDraft,
  questionIds: string[]
): AssignmentAuthoringDraft {
  const ids = new Set(questionIds);
  const sections = draft.assessmentDraft.sections.map((section) => {
    const questions = section.questions.filter((question) => !ids.has(question.id));
    if (questions.length === 0) throw new Error('Each section must keep at least one question');
    return { ...section, questions };
  });
  return bumpDraft({ ...draft, assessmentDraft: { ...draft.assessmentDraft, sections } });
}

export function moveQuestionsToSection(
  draft: AssignmentAuthoringDraft,
  questionIds: string[],
  targetSectionId: string
): AssignmentAuthoringDraft {
  const ids = new Set(questionIds);
  const moved: AssessmentQuestionInput[] = [];
  const sectionsWithoutMoved = draft.assessmentDraft.sections.map((section) => {
    const kept: AssessmentQuestionInput[] = [];
    for (const question of section.questions) {
      if (ids.has(question.id)) moved.push(question);
      else kept.push(question);
    }
    if (kept.length === 0) throw new Error('Each section must keep at least one question');
    return { ...section, questions: kept };
  });
  if (moved.length === 0) return draft;
  const sections = sectionsWithoutMoved.map((section) =>
    section.id === targetSectionId
      ? { ...section, questions: [...section.questions, ...moved] }
      : section
  );
  if (!sections.some((section) => section.id === targetSectionId)) {
    throw new Error(`Unknown section: ${targetSectionId}`);
  }
  return bumpDraft({ ...draft, assessmentDraft: { ...draft.assessmentDraft, sections } });
}

export function updateSectionInDraft(
  draft: AssignmentAuthoringDraft,
  sectionId: string,
  sectionFields: { title: string; skill: AssessmentSkill; instructions?: string }
): AssignmentAuthoringDraft {
  const sections = draft.assessmentDraft.sections.map((section) => {
    if (section.id !== sectionId) return section;
    return {
      ...section,
      title: sectionFields.title,
      skill: sectionFields.skill,
      instructions: sectionFields.instructions ?? section.instructions,
    };
  });
  return bumpDraft({ ...draft, assessmentDraft: { ...draft.assessmentDraft, sections } });
}

export function bulkUpdateQuestions(
  draft: AssignmentAuthoringDraft,
  questionIds: string[],
  update: AuthoringBulkQuestionUpdate
): AssignmentAuthoringDraft {
  const selected = new Set(questionIds);
  const sections = draft.assessmentDraft.sections.map((sectionItem) => ({
    ...sectionItem,
    questions: sectionItem.questions.map((candidate) =>
      selected.has(candidate.id)
        ? {
            ...candidate,
            ...(update.points !== undefined ? { points: update.points } : {}),
            ...(update.level !== undefined ? { level: update.level } : {}),
            ...(update.skill !== undefined ? { skill: update.skill } : {}),
          }
        : candidate
    ),
  }));
  return bumpDraft({ ...draft, assessmentDraft: { ...draft.assessmentDraft, sections } });
}

export function updateAuthoringDraftFields(
  draft: AssignmentAuthoringDraft,
  fields: AuthoringDraftFieldUpdate
): AssignmentAuthoringDraft {
  const deliveryPolicyUpdate = fields.deliveryPolicy
    ? {
        deliveryPolicy: validateAssignmentDeliveryPolicy(
          normalizeAssignmentDeliveryPolicy(fields.deliveryPolicy)
        ),
      }
    : {};
  return bumpDraft({
    ...draft,
    ...fields,
    ...deliveryPolicyUpdate,
    ...(fields.attemptsAllowed !== undefined
      ? { attemptsAllowed: Math.max(Number(fields.attemptsAllowed) || 1, 1) }
      : {}),
  });
}

export function updateQuestionInDraft(
  draft: AssignmentAuthoringDraft,
  questionId: string,
  question: AssessmentQuestionInput
): AssignmentAuthoringDraft {
  let updated = false;
  const sections = draft.assessmentDraft.sections.map((sectionItem) => ({
    ...sectionItem,
    questions: sectionItem.questions.map((candidate) => {
      if (candidate.id !== questionId) return candidate;
      updated = true;
      return question;
    }),
  }));
  if (!updated) throw new Error(`Unknown question: ${questionId}`);
  return bumpDraft({ ...draft, assessmentDraft: { ...draft.assessmentDraft, sections } });
}

const QUESTION_IMPORT_SKILLS = ['listening', 'reading', 'speaking', 'writing'] as const;
const SECTION_IMPORT_SKILLS = ['listening', 'reading', 'speaking', 'writing', 'mixed'] as const;
const IMPORT_RESPONSE_MODES = [
  'multiple_choice',
  'short_answer',
  'long_answer',
  'speaking_recording',
  'file_upload',
] as const;
const IMPORT_MEDIA_TYPES = ['audio', 'video', 'image', 'document'] as const;

function normalizeImportText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isQuestionImportSkill(value: string): value is AssessmentQuestionInput['skill'] {
  return QUESTION_IMPORT_SKILLS.includes(value as AssessmentQuestionInput['skill']);
}

function isSectionImportSkill(value: string): value is AssessmentSkill {
  return SECTION_IMPORT_SKILLS.includes(value as AssessmentSkill);
}

function isImportResponseMode(value: string): value is AssessmentResponseMode {
  return IMPORT_RESPONSE_MODES.includes(value as AssessmentResponseMode);
}

function isImportMediaType(value: string): value is QuestionMediaType {
  return IMPORT_MEDIA_TYPES.includes(value as QuestionMediaType);
}

function inferImportMediaType(url: string): QuestionMediaType | '' {
  const cleanUrl = url.split('?')[0].toLowerCase();
  if (/\.(mp3|m4a|wav|ogg|webm)$/.test(cleanUrl)) return 'audio';
  if (/\.(mp4|mov|m4v)$/.test(cleanUrl)) return 'video';
  if (/\.(png|jpe?g|webp|gif)$/.test(cleanUrl)) return 'image';
  if (/\.(pdf|docx?|pptx?|xlsx?)$/.test(cleanUrl)) return 'document';
  return '';
}

function splitImportAnswers(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function importIssue(
  input: Omit<AuthoringImportIssue, 'severity'> & { severity?: AuthoringImportSeverity }
) {
  return { severity: input.severity || 'error', ...input } as AuthoringImportIssue;
}

function parseImportPoints(
  value: string,
  issues: AuthoringImportIssue[],
  row: AuthoringImportEditableRow,
  questionNumber: number
): number {
  if (!value.trim()) {
    issues.push(
      importIssue({
        severity: 'warning',
        code: 'points_defaulted',
        message: 'Points missing; defaulted to 1.',
        row: row.sourceRow,
        questionNumber,
        field: 'points',
      })
    );
    return 1;
  }
  const points = Number(value);
  if (!Number.isFinite(points) || points <= 0) {
    issues.push(
      importIssue({
        code: 'invalid_points',
        message: 'Points must be a positive number.',
        row: row.sourceRow,
        questionNumber,
        field: 'points',
      })
    );
    return 1;
  }
  return points;
}

function validateImportRow(
  row: AuthoringImportEditableRow,
  questionNumber: number
): {
  sectionTitle: string;
  sectionSkill: AssessmentSkill;
  question?: AuthoringImportQuestion;
  issues: AuthoringImportIssue[];
} {
  const issues: AuthoringImportIssue[] = [];
  const sectionTitle = row.section.trim();
  const normalizedSkill = normalizeImportText(row.skill).replace(/\s+/g, '_');
  const normalizedMode = normalizeImportText(row.responseMode).replace(/[\s-]+/g, '_');

  if (!sectionTitle) {
    issues.push(
      importIssue({
        code: 'missing_section',
        message: 'Section title is required.',
        row: row.sourceRow,
        questionNumber,
        field: 'section',
      })
    );
  }
  if (!isSectionImportSkill(normalizedSkill)) {
    issues.push(
      importIssue({
        code: 'invalid_skill',
        message: 'Skill must be listening, reading, speaking, writing, or mixed.',
        row: row.sourceRow,
        questionNumber,
        field: 'skill',
      })
    );
  }
  if (!row.prompt.trim()) {
    issues.push(
      importIssue({
        code: 'missing_prompt',
        message: 'Question prompt is required.',
        row: row.sourceRow,
        questionNumber,
        field: 'prompt',
      })
    );
  }
  if (!isImportResponseMode(normalizedMode)) {
    issues.push(
      importIssue({
        code: 'invalid_response_mode',
        message: 'Response mode is invalid.',
        row: row.sourceRow,
        questionNumber,
        field: 'responseMode',
      })
    );
  }

  const sectionSkill = isSectionImportSkill(normalizedSkill) ? normalizedSkill : 'mixed';
  const questionSkill = sectionSkill === 'mixed' ? 'reading' : sectionSkill;
  if (!isQuestionImportSkill(questionSkill)) {
    issues.push(
      importIssue({
        code: 'invalid_skill',
        message: 'Question skill is invalid.',
        row: row.sourceRow,
        questionNumber,
        field: 'skill',
      })
    );
  }

  const responseMode: AssessmentResponseMode = isImportResponseMode(normalizedMode)
    ? normalizedMode
    : 'multiple_choice';
  const points = parseImportPoints(row.points, issues, row, questionNumber);
  if (!row.level.trim()) {
    issues.push(
      importIssue({
        severity: 'warning',
        code: 'level_missing',
        message: 'Level is missing.',
        row: row.sourceRow,
        questionNumber,
        field: 'level',
      })
    );
  }

  const media: AuthoringImportQuestion['media'] = [];
  if (row.mediaUrl.trim()) {
    const url = row.mediaUrl.trim();
    const mediaType = normalizeImportText(row.mediaType) || inferImportMediaType(url);
    if (!url.startsWith('https://')) {
      issues.push(
        importIssue({
          code: 'external_media_https_required',
          message: 'Media URL must start with https://.',
          row: row.sourceRow,
          questionNumber,
          field: 'mediaUrl',
        })
      );
    }
    if (!isImportMediaType(mediaType)) {
      issues.push(
        importIssue({
          code: 'invalid_media_type',
          message: 'Media type must be audio, video, image, or document.',
          row: row.sourceRow,
          questionNumber,
          field: 'mediaType',
        })
      );
    } else {
      media.push({
        type: mediaType,
        source: 'external_url',
        url,
        title: url.split('/').pop() || url,
        ...(row.transcript.trim() ? { transcript: row.transcript.trim() } : {}),
      });
    }
  }

  if (responseMode === 'multiple_choice') {
    const options: QuizOptionLike[] = [
      ['A', row.optionA],
      ['B', row.optionB],
      ['C', row.optionC],
      ['D', row.optionD],
    ]
      .filter(([, text]) => text.trim())
      .map(([key, text]) => ({ key, text: text.trim() }));
    if (options.length < 2) {
      issues.push(
        importIssue({
          code: 'multiple_choice_options_required',
          message: 'Multiple-choice questions need at least two options.',
          row: row.sourceRow,
          questionNumber,
          field: 'options',
        })
      );
    }
    const correctAnswer = row.correctAnswer.trim().toUpperCase();
    const optionKeys = new Set(options.map((option) => option.key));
    if (!correctAnswer || !optionKeys.has(correctAnswer)) {
      issues.push(
        importIssue({
          code: 'multiple_choice_correct_answer_required',
          message: 'Correct answer must match one option key.',
          row: row.sourceRow,
          questionNumber,
          field: 'correctAnswer',
        })
      );
    }
    if (issues.some((candidate) => candidate.severity === 'error')) {
      return { sectionTitle, sectionSkill, issues };
    }
    return {
      sectionTitle,
      sectionSkill,
      issues,
      question: {
        skill: questionSkill,
        responseMode,
        prompt: row.prompt.trim(),
        media,
        options,
        correctAnswer,
        gradingMode: 'auto' satisfies AssessmentGradingMode,
        points,
        ...(row.level.trim() ? { level: row.level.trim() } : {}),
      },
    };
  }

  const acceptedAnswers = row.acceptedAnswers.trim()
    ? splitImportAnswers(row.acceptedAnswers)
    : splitImportAnswers(row.correctAnswer);
  if (responseMode === 'short_answer' && acceptedAnswers.length === 0) {
    issues.push(
      importIssue({
        severity: 'warning',
        code: 'short_answer_missing_key',
        message: 'Short-answer question has no accepted answers.',
        row: row.sourceRow,
        questionNumber,
        field: 'acceptedAnswers',
      })
    );
  }
  if (issues.some((candidate) => candidate.severity === 'error')) {
    return { sectionTitle, sectionSkill, issues };
  }
  return {
    sectionTitle,
    sectionSkill,
    issues,
    question: {
      skill: questionSkill,
      responseMode,
      prompt: row.prompt.trim(),
      media,
      acceptedAnswers,
      gradingMode: 'manual' satisfies AssessmentGradingMode,
      points,
      ...(row.level.trim() ? { level: row.level.trim() } : {}),
    },
  };
}

export function validateAuthoringImportRows({
  source,
  filename,
  rows,
  extraIssues = [],
}: ValidateAuthoringImportRowsInput): AuthoringImportPreview {
  const sections = new Map<string, AuthoringImportSection>();
  const issues: AuthoringImportIssue[] = [...extraIssues];

  rows.forEach((row, index) => {
    const questionNumber = index + 1;
    const result = validateImportRow(row, questionNumber);
    issues.push(
      ...result.issues.map((item) => ({
        ...item,
        sectionTitle: result.sectionTitle || item.sectionTitle,
      }))
    );
    if (!result.question) return;
    const key = `${result.sectionTitle}::${result.sectionSkill}`;
    const existing = sections.get(key);
    if (existing) {
      if (!existing.instructions && row.instructions.trim()) {
        existing.instructions = row.instructions.trim();
      }
      existing.questions.push(result.question);
      return;
    }
    sections.set(key, {
      title: result.sectionTitle,
      skill: result.sectionSkill,
      ...(row.instructions.trim() ? { instructions: row.instructions.trim() } : {}),
      questions: [result.question],
    });
  });

  const sectionList = Array.from(sections.values()).filter(
    (sectionItem) => sectionItem.questions.length > 0
  );
  const errorCount = issues.filter((item) => item.severity === 'error').length;
  const warningCount = issues.filter((item) => item.severity === 'warning').length;
  const validQuestions = sectionList.reduce(
    (sum, sectionItem) => sum + sectionItem.questions.length,
    0
  );

  return {
    source,
    filename,
    totalQuestions: rows.length,
    validQuestions,
    warningCount,
    errorCount,
    sections: sectionList,
    issues,
    editableRows: structuredClone(rows),
  };
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildAuthoringImportIssuesCsv(preview: AuthoringImportPreview): string {
  const header = [
    'filename',
    'source',
    'row',
    'questionNumber',
    'severity',
    'field',
    'code',
    'message',
    'sectionTitle',
  ];
  const rows = preview.issues.map((item) => [
    preview.filename,
    preview.source,
    item.row ?? '',
    item.questionNumber ?? '',
    item.severity,
    item.field ?? '',
    item.code,
    item.message,
    item.sectionTitle ?? '',
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function buildAuthoringImportReport(
  preview: AuthoringImportPreview,
  mode: AuthoringImportMode,
  appliedAt = nowIso()
): AuthoringImportReport {
  return {
    filename: preview.filename,
    source: preview.source,
    appliedAt,
    mode,
    totalQuestions: preview.totalQuestions,
    validQuestions: preview.validQuestions,
    warningCount: preview.warningCount,
    errorCount: preview.errorCount,
  };
}

function importedQuestionSnapshot(source: AuthoringImportQuestion): AssessmentQuestionInput {
  return {
    ...structuredClone(source),
    id: authoringId('question'),
    media: source.media.map((media) => ({
      ...structuredClone(media),
      id: authoringId('media'),
    })),
  };
}

function importedSectionSnapshot(source: AuthoringImportSection) {
  return {
    id: authoringId('section'),
    title: source.title,
    skill: source.skill,
    ...(source.instructions ? { instructions: source.instructions } : {}),
    questions: source.questions.map(importedQuestionSnapshot),
  };
}

export function applyAuthoringImportPreview(
  draft: AssignmentAuthoringDraft,
  preview: AuthoringImportPreview,
  mode: AuthoringImportMode,
  appliedAt?: string
): AssignmentAuthoringDraft {
  const importedSections = preview.sections
    .map(importedSectionSnapshot)
    .filter((sectionItem) => sectionItem.questions.length > 0);

  if (importedSections.length === 0) {
    throw new Error('Import preview has no valid questions');
  }

  const sections =
    mode === 'replace'
      ? importedSections
      : [...draft.assessmentDraft.sections, ...importedSections];

  return bumpDraft({
    ...draft,
    lastImportReport: buildAuthoringImportReport(preview, mode, appliedAt),
    assessmentDraft: {
      ...draft.assessmentDraft,
      sections,
    },
  });
}

export function insertBankQuestionSnapshot(
  draft: AssignmentAuthoringDraft,
  sectionId: string,
  bankItem: AssessmentQuestionBankItem
): AssignmentAuthoringDraft {
  const snapshot: AssessmentQuestionInput = {
    id: authoringId('question'),
    skill: bankItem.skill,
    prompt: bankItem.prompt,
    media: structuredClone(bankItem.media),
    responseMode: bankItem.responseMode,
    ...(bankItem.options ? { options: structuredClone(bankItem.options) } : {}),
    ...(bankItem.points !== undefined ? { points: bankItem.points } : {}),
    ...(bankItem.level !== undefined ? { level: bankItem.level } : {}),
    ...(bankItem.responseMode === 'multiple_choice'
      ? { correctAnswer: bankItem.options?.[0]?.key || 'A' }
      : {}),
    gradingMode: bankItem.responseMode === 'multiple_choice' ? 'auto' : 'manual',
  };
  const sections = draft.assessmentDraft.sections.map((sectionItem) =>
    sectionItem.id === sectionId
      ? { ...sectionItem, questions: [...sectionItem.questions, snapshot] }
      : sectionItem
  );
  return bumpDraft({ ...draft, assessmentDraft: { ...draft.assessmentDraft, sections } });
}

export function insertMediaBankSnapshot(
  draft: AssignmentAuthoringDraft,
  questionId: string,
  bankItem: AssessmentMediaBankItem
): AssignmentAuthoringDraft {
  const media: QuestionMedia = {
    id: authoringId('media'),
    type: bankItem.type,
    source: bankItem.source,
    url: bankItem.url,
    ...(bankItem.storagePath ? { storagePath: bankItem.storagePath } : {}),
    ...(bankItem.title ? { title: bankItem.title } : {}),
    ...(bankItem.altText ? { altText: bankItem.altText } : {}),
    ...(bankItem.transcript ? { transcript: bankItem.transcript } : {}),
    ...(bankItem.thumbnailUrl ? { thumbnailUrl: bankItem.thumbnailUrl } : {}),
    ...(bankItem.durationSeconds !== undefined
      ? { durationSeconds: bankItem.durationSeconds }
      : {}),
  };
  let updated = false;
  const sections = draft.assessmentDraft.sections.map((sectionItem) => ({
    ...sectionItem,
    questions: sectionItem.questions.map((questionItem) => {
      if (questionItem.id !== questionId) return questionItem;
      updated = true;
      return { ...questionItem, media: [...questionItem.media, media] };
    }),
  }));
  if (!updated) throw new Error(`Unknown question: ${questionId}`);
  return bumpDraft({ ...draft, assessmentDraft: { ...draft.assessmentDraft, sections } });
}

function normalizeDraftDueDate(value: string) {
  const trimmed = value.trim();
  if (isApiDateTime(trimmed)) return trimmed;
  return userDateTimeToApiIso(trimmed);
}

export function getAuthoringValidationIssues(
  draft: AssignmentAuthoringDraft
): AuthoringValidationIssue[] {
  const issues: AuthoringValidationIssue[] = [];
  if (!draft.title.trim()) {
    issues.push({
      code: 'title_required',
      area: 'assignment',
      message: 'Title is required.',
    });
  }
  if (!draft.classId.trim()) {
    issues.push({
      code: 'class_required',
      area: 'assignment',
      message: 'Class is required.',
    });
  }
  if (!draft.dueDate.trim()) {
    issues.push({
      code: 'due_date_required',
      area: 'assignment',
      message: 'Due date is required.',
    });
  } else {
    try {
      normalizeDraftDueDate(draft.dueDate);
    } catch {
      issues.push({
        code: 'due_date_invalid',
        area: 'assignment',
        message: 'Due date format is invalid.',
      });
    }
  }

  let questionNumber = 1;
  for (const sectionItem of draft.assessmentDraft.sections) {
    if (!sectionItem.title.trim()) {
      issues.push({
        code: 'section_title_required',
        area: 'section',
        sectionId: sectionItem.id,
        message: `Section ${sectionItem.id} title is required.`,
      });
    }
    for (const item of sectionItem.questions) {
      const PUBLISHABLE_INTERACTION_TYPES = new Set([
        'multiple_choice',
        'short_answer',
        'long_answer',
        'speaking_recording',
        'file_upload',
      ]);
      if (item.interactionType && !PUBLISHABLE_INTERACTION_TYPES.has(item.interactionType)) {
        issues.push({
          code: 'unsupported_interaction_type',
          area: 'question',
          sectionId: sectionItem.id,
          questionId: item.id,
          questionNumber,
          message: `Question ${questionNumber} type is available for drafts but cannot be published yet.`,
        });
      }
      if (!item.prompt.trim()) {
        issues.push({
          code: 'question_prompt_required',
          area: 'question',
          sectionId: sectionItem.id,
          questionId: item.id,
          questionNumber,
          message: `Question ${questionNumber} prompt is required.`,
        });
      }
      if (item.responseMode === 'multiple_choice') {
        const options = item.options || [];
        if (options.length < 2 || options.some((option) => !option.text.trim())) {
          issues.push({
            code: 'multiple_choice_options_required',
            area: 'question',
            sectionId: sectionItem.id,
            questionId: item.id,
            questionNumber,
            message: `Question ${questionNumber} needs at least two completed options.`,
          });
        }
        if (!item.correctAnswer) {
          issues.push({
            code: 'multiple_choice_correct_answer_required',
            area: 'question',
            sectionId: sectionItem.id,
            questionId: item.id,
            questionNumber,
            message: `Question ${questionNumber} correct answer is required.`,
          });
        }
      }
      for (const media of item.media) {
        if (media.source === 'external_url' && !media.url.startsWith('https://')) {
          issues.push({
            code: 'external_media_https_required',
            area: 'media',
            sectionId: sectionItem.id,
            questionId: item.id,
            questionNumber,
            mediaId: media.id,
            message: `Question ${questionNumber} media URL must start with https://.`,
          });
        }
        if (media.source === 'upload' && !media.storagePath) {
          issues.push({
            code: 'uploaded_media_storage_path_required',
            area: 'media',
            sectionId: sectionItem.id,
            questionId: item.id,
            questionNumber,
            mediaId: media.id,
            message: `Question ${questionNumber} uploaded media needs storagePath.`,
          });
        }
      }
      questionNumber += 1;
    }
  }
  return issues;
}

export function getAuthoringReadiness(draft: AssignmentAuthoringDraft): AuthoringReadinessGroup[] {
  const issues = getAuthoringValidationIssues(draft);
  const byCode = (codes: AuthoringValidationCode[]) =>
    issues.filter((issue) => codes.includes(issue.code));
  const groups: AuthoringReadinessGroup[] = [
    {
      id: 'basics',
      label: 'Assignment basics',
      issues: byCode(['title_required', 'class_required', 'due_date_required', 'due_date_invalid']),
      complete: true,
    },
    {
      id: 'structure',
      label: 'Structure and prompts',
      issues: byCode(['section_title_required', 'question_prompt_required']),
      complete: true,
    },
    {
      id: 'answers',
      label: 'Answer keys',
      issues: byCode([
        'multiple_choice_options_required',
        'multiple_choice_correct_answer_required',
        'unsupported_interaction_type',
      ]),
      complete: true,
    },
    {
      id: 'media',
      label: 'Media',
      issues: byCode(['external_media_https_required', 'uploaded_media_storage_path_required']),
      complete: true,
    },
  ];
  return groups.map((group) => ({ ...group, complete: group.issues.length === 0 }));
}

export function validateAuthoringDraft(draft: AssignmentAuthoringDraft): string[] {
  return getAuthoringValidationIssues(draft).map((issue) => issue.message);
}

export function buildAssignmentPayloadFromAuthoringDraft(draft: AssignmentAuthoringDraft) {
  const errors = validateAuthoringDraft(draft);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return {
    title: draft.title,
    description: draft.description,
    dueDate: normalizeDraftDueDate(draft.dueDate),
    classId: draft.classId,
    type: 'quiz' as const,
    questions: [],
    attemptsAllowed: draft.attemptsAllowed,
    proctoringMode: draft.proctoringMode,
    assessment: draft.assessmentDraft,
    deliveryPolicy: draft.deliveryPolicy,
  };
}
