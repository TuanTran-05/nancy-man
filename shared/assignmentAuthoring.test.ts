import { describe, expect, it } from 'vitest';
import {
  AUTHORING_BANK_VISIBILITIES,
  AUTHORING_IMPORT_COLUMNS,
  applyAuthoringImportPreview,
  applyStructureTemplate,
  buildAssignmentPayloadFromAuthoringDraft,
  buildAuthoringImportIssuesCsv,
  bulkUpdateQuestions,
  createBlankAuthoringDraft,
  duplicateQuestionInDraft,
  getAuthoringReadiness,
  getAuthoringValidationIssues,
  getStructureTemplates,
  insertBankQuestionSnapshot,
  moveQuestionInDraft,
  validateAuthoringDraft,
  validateAuthoringImportRows,
  updateAuthoringDraftFields,
  addSectionToDraft,
  deleteQuestionsFromDraft,
  moveQuestionsToSection,
  reorderSectionInDraft,
  type AssessmentQuestionBankItem,
  type AuthoringImportEditableRow,
  type AuthoringImportPreview,
} from './assignmentAuthoring';

describe('assignment authoring shared helpers', () => {
  it('defines concrete bank visibility states', () => {
    expect(AUTHORING_BANK_VISIBILITIES).toEqual([
      'private',
      'pending_review',
      'shared',
      'archived',
    ]);
  });

  it('creates a blank draft with Assessment v2 defaults', () => {
    const draft = createBlankAuthoringDraft('teacher-1');

    expect(draft.ownerUid).toBe('teacher-1');
    expect(draft.status).toBe('draft');
    expect(draft.serverRevision).toBe(0);
    expect(draft.assessmentDraft.version).toBe(2);
    expect(draft.assessmentDraft.sections).toHaveLength(1);
    expect(draft.assessmentDraft.sections[0].questions[0]).toMatchObject({
      responseMode: 'multiple_choice',
      points: 1,
    });
  });

  it('applies a listening structure template', () => {
    const template = getStructureTemplates().find((item) => item.id === 'listening-practice');
    expect(template).toBeTruthy();

    const draft = applyStructureTemplate(createBlankAuthoringDraft('teacher-1'), template!.id);

    expect(draft.assessmentDraft.sections.map((section) => section.skill)).toEqual(['listening']);
    expect(draft.assessmentDraft.sections[0].questions).toHaveLength(3);
    expect(
      draft.assessmentDraft.sections[0].questions.every((question) => question.media.length === 0)
    ).toBe(true);
  });

  it('duplicates a question with a new id and copied private authoring data', () => {
    const draft = applyStructureTemplate(createBlankAuthoringDraft('teacher-1'), 'reading-passage');
    const sourceId = draft.assessmentDraft.sections[0].questions[0].id;

    const next = duplicateQuestionInDraft(draft, sourceId);
    const questions = next.assessmentDraft.sections[0].questions;

    expect(questions).toHaveLength(draft.assessmentDraft.sections[0].questions.length + 1);
    expect(questions[1].id).not.toBe(sourceId);
    expect(questions[1]).toMatchObject({
      prompt: questions[0].prompt,
      responseMode: questions[0].responseMode,
      points: questions[0].points,
    });
  });

  it('moves questions within the same section', () => {
    const draft = applyStructureTemplate(
      createBlankAuthoringDraft('teacher-1'),
      'listening-practice'
    );
    const ids = draft.assessmentDraft.sections[0].questions.map((question) => question.id);

    const next = moveQuestionInDraft(draft, ids[2], {
      sectionId: draft.assessmentDraft.sections[0].id,
      index: 0,
    });

    expect(next.assessmentDraft.sections[0].questions.map((question) => question.id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);
  });

  it('bulk updates selected question points and level', () => {
    const draft = applyStructureTemplate(
      createBlankAuthoringDraft('teacher-1'),
      'listening-practice'
    );
    const selectedIds = draft.assessmentDraft.sections[0].questions
      .slice(0, 2)
      .map((question) => question.id);

    const next = bulkUpdateQuestions(draft, selectedIds, { points: 2, level: 'B1' });

    expect(next.assessmentDraft.sections[0].questions[0]).toMatchObject({ points: 2, level: 'B1' });
    expect(next.assessmentDraft.sections[0].questions[1]).toMatchObject({ points: 2, level: 'B1' });
    expect(next.assessmentDraft.sections[0].questions[2].points).toBe(1);
  });

  it('validates missing authoring basics and question content', () => {
    const draft = createBlankAuthoringDraft('teacher-1');

    expect(validateAuthoringDraft(draft)).toEqual(
      expect.arrayContaining([
        'Title is required.',
        'Class is required.',
        'Due date is required.',
        'Question 1 prompt is required.',
        'Question 1 needs at least two completed options.',
      ])
    );
  });

  it('returns structured validation issues with fix targets', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    const section = draft.assessmentDraft.sections[0];
    const question = section.questions[0];

    const issues = getAuthoringValidationIssues(draft);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'title_required',
          area: 'assignment',
          message: 'Title is required.',
        }),
        expect.objectContaining({
          code: 'question_prompt_required',
          area: 'question',
          sectionId: section.id,
          questionId: question.id,
          questionNumber: 1,
          message: 'Question 1 prompt is required.',
        }),
      ])
    );
    expect(validateAuthoringDraft(draft)).toContain('Question 1 prompt is required.');
  });

  it('groups readiness issues by authoring area', () => {
    const draft = createBlankAuthoringDraft('teacher-1');

    const groups = getAuthoringReadiness(draft);

    expect(groups.map((group) => group.id)).toEqual(['basics', 'structure', 'answers', 'media']);
    expect(groups.find((group) => group.id === 'basics')).toMatchObject({
      label: 'Assignment basics',
      complete: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'title_required' }),
        expect.objectContaining({ code: 'class_required' }),
        expect.objectContaining({ code: 'due_date_required' }),
      ]),
    });
    expect(groups.find((group) => group.id === 'answers')).toMatchObject({
      label: 'Answer keys',
      complete: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'multiple_choice_options_required' }),
      ]),
    });
  });

  function importPreview(): AuthoringImportPreview {
    return {
      source: 'xlsx',
      filename: 'unit-1.xlsx',
      totalQuestions: 2,
      validQuestions: 2,
      warningCount: 0,
      errorCount: 0,
      sections: [
        {
          title: 'Imported Listening',
          skill: 'listening',
          instructions: 'Listen and choose.',
          questions: [
            {
              skill: 'listening',
              responseMode: 'multiple_choice',
              prompt: 'What does the speaker want?',
              media: [
                {
                  type: 'audio',
                  source: 'external_url',
                  url: 'https://cdn.example.com/audio.mp3',
                  title: 'audio.mp3',
                },
              ],
              options: [
                { key: 'A', text: 'A ticket' },
                { key: 'B', text: 'A book' },
              ],
              correctAnswer: 'A',
              gradingMode: 'auto',
              points: 1,
              level: 'A2',
            },
            {
              skill: 'listening',
              responseMode: 'short_answer',
              prompt: 'Write the missing word.',
              media: [],
              acceptedAnswers: ['ticket', 'tickets'],
              gradingMode: 'manual',
              points: 2,
              level: 'A2',
            },
          ],
        },
      ],
      issues: [],
      editableRows: [],
    };
  }

  it('appends imported sections to the current draft with fresh ids', () => {
    const draft = createBlankAuthoringDraft('teacher-1');

    const next = applyAuthoringImportPreview(draft, importPreview(), 'append');

    expect(next.assessmentDraft.sections).toHaveLength(2);
    expect(next.assessmentDraft.sections[1]).toMatchObject({
      title: 'Imported Listening',
      skill: 'listening',
      instructions: 'Listen and choose.',
    });
    expect(next.assessmentDraft.sections[1].id).toMatch(/^section-/);
    expect(next.assessmentDraft.sections[1].questions[0]).toMatchObject({
      prompt: 'What does the speaker want?',
      responseMode: 'multiple_choice',
      correctAnswer: 'A',
      options: [
        { key: 'A', text: 'A ticket' },
        { key: 'B', text: 'A book' },
      ],
      media: [
        expect.objectContaining({
          id: expect.stringMatching(/^media-/),
          source: 'external_url',
          url: 'https://cdn.example.com/audio.mp3',
        }),
      ],
    });
    expect(next.localRevision).toBe(draft.localRevision + 1);
  });

  it('replaces existing draft sections with imported sections', () => {
    const draft = applyStructureTemplate(createBlankAuthoringDraft('teacher-1'), 'reading-passage');

    const next = applyAuthoringImportPreview(draft, importPreview(), 'replace');

    expect(next.assessmentDraft.sections).toHaveLength(1);
    expect(next.assessmentDraft.sections[0].title).toBe('Imported Listening');
    expect(next.assessmentDraft.sections[0].questions).toHaveLength(2);
  });

  it('rejects applying an import preview with no valid questions', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    const preview = { ...importPreview(), validQuestions: 0, sections: [] };

    expect(() => applyAuthoringImportPreview(draft, preview, 'append')).toThrow(
      'Import preview has no valid questions'
    );
  });

  it('builds an assignment-create payload from a valid draft', () => {
    const draft = {
      ...applyStructureTemplate(createBlankAuthoringDraft('teacher-1'), 'listening-practice'),
      title: 'Listening unit 1',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
    };
    draft.assessmentDraft.sections[0].questions = [
      {
        ...draft.assessmentDraft.sections[0].questions[0],
        prompt: 'What does the speaker want?',
        options: [
          { key: 'A', text: 'A ticket' },
          { key: 'B', text: 'A book' },
        ],
        correctAnswer: 'B',
      },
    ];

    const payload = buildAssignmentPayloadFromAuthoringDraft(draft);

    expect(payload).toMatchObject({
      title: 'Listening unit 1',
      classId: 'class-1',
      type: 'quiz',
      questions: [],
      assessment: { version: 2 },
    });
  });

  it('inserts a snapshot of a bank question into the selected section', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    const sectionId = draft.assessmentDraft.sections[0].id;
    const bankItem: AssessmentQuestionBankItem = {
      id: 'bank-q1',
      ownerUid: 'teacher-1',
      visibility: 'private',
      skill: 'listening',
      responseMode: 'short_answer',
      prompt: 'Write the missing word.',
      media: [],
      points: 2,
      level: 'A2',
      tags: ['unit-1'],
      createdAt: '2026-06-11T00:00:00.000Z',
      updatedAt: '2026-06-11T00:00:00.000Z',
    };

    const next = insertBankQuestionSnapshot(draft, sectionId, bankItem);
    const inserted = next.assessmentDraft.sections[0].questions.at(-1)!;

    expect(inserted).toMatchObject({
      skill: 'listening',
      responseMode: 'short_answer',
      prompt: 'Write the missing word.',
      points: 2,
      level: 'A2',
    });
    expect(inserted.id).not.toBe('bank-q1');
  });

  function editableRow(
    overrides: Partial<AuthoringImportEditableRow> = {}
  ): AuthoringImportEditableRow {
    return {
      rowId: 'row-2',
      sourceRow: 2,
      section: 'Listening',
      skill: 'listening',
      responseMode: 'multiple_choice',
      prompt: 'What does the speaker want?',
      instructions: 'Listen and choose.',
      optionA: 'A ticket',
      optionB: 'A book',
      optionC: '',
      optionD: '',
      correctAnswer: 'A',
      acceptedAnswers: '',
      points: '1',
      level: 'A2',
      mediaUrl: 'https://cdn.example.com/audio.mp3',
      mediaType: 'audio',
      transcript: '',
      ...overrides,
    };
  }

  it('defines canonical import columns for templates and repair rows', () => {
    expect(AUTHORING_IMPORT_COLUMNS).toEqual([
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
    ]);
  });

  it('validates editable rows into an import preview', () => {
    const preview = validateAuthoringImportRows({
      source: 'csv',
      filename: 'unit.csv',
      rows: [editableRow()],
    });

    expect(preview).toMatchObject({
      source: 'csv',
      filename: 'unit.csv',
      totalQuestions: 1,
      validQuestions: 1,
      warningCount: 0,
      errorCount: 0,
      editableRows: [expect.objectContaining({ rowId: 'row-2', sourceRow: 2 })],
      sections: [
        {
          title: 'Listening',
          skill: 'listening',
          instructions: 'Listen and choose.',
          questions: [
            {
              responseMode: 'multiple_choice',
              prompt: 'What does the speaker want?',
              correctAnswer: 'A',
              media: [
                expect.objectContaining({
                  type: 'audio',
                  source: 'external_url',
                  url: 'https://cdn.example.com/audio.mp3',
                }),
              ],
            },
          ],
        },
      ],
    });
  });

  it('keeps missing response mode as an editable row error until repaired', () => {
    const broken = validateAuthoringImportRows({
      source: 'csv',
      filename: 'unit.csv',
      rows: [editableRow({ responseMode: '' })],
    });

    expect(broken.validQuestions).toBe(0);
    expect(broken.issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'invalid_response_mode',
        row: 2,
        field: 'responseMode',
      })
    );

    const repaired = validateAuthoringImportRows({
      source: 'csv',
      filename: 'unit.csv',
      rows: [{ ...broken.editableRows[0], responseMode: 'multiple_choice' }],
    });

    expect(repaired.validQuestions).toBe(1);
    expect(repaired.errorCount).toBe(0);
  });

  it('exports current import issues to csv', () => {
    const preview = validateAuthoringImportRows({
      source: 'csv',
      filename: 'unit.csv',
      rows: [editableRow({ responseMode: '' })],
    });

    const csv = buildAuthoringImportIssuesCsv(preview);

    expect(csv.split('\n')[0]).toBe(
      'filename,source,row,questionNumber,severity,field,code,message,sectionTitle'
    );
    expect(csv).toContain('unit.csv,csv,2,1,error,responseMode,invalid_response_mode');
  });

  it('stores last import report when applying a preview', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    const preview = validateAuthoringImportRows({
      source: 'csv',
      filename: 'unit.csv',
      rows: [editableRow()],
    });

    const next = applyAuthoringImportPreview(draft, preview, 'append', '2026-06-12T01:00:00.000Z');

    expect(next.lastImportReport).toEqual({
      filename: 'unit.csv',
      source: 'csv',
      appliedAt: '2026-06-12T01:00:00.000Z',
      mode: 'append',
      totalQuestions: 1,
      validQuestions: 1,
      warningCount: 0,
      errorCount: 0,
    });
  });

  it('omits last import report from publish payload', () => {
    const draft = {
      ...applyStructureTemplate(createBlankAuthoringDraft('teacher-1'), 'listening-practice'),
      title: 'Listening unit 1',
      classId: 'class-1',
      dueDate: '2026-06-30T10:00:00.000Z',
      lastImportReport: {
        filename: 'unit.csv',
        source: 'csv' as const,
        appliedAt: '2026-06-12T01:00:00.000Z',
        mode: 'append' as const,
        totalQuestions: 1,
        validQuestions: 1,
        warningCount: 0,
        errorCount: 0,
      },
    };
    draft.assessmentDraft.sections[0].questions = [
      {
        ...draft.assessmentDraft.sections[0].questions[0],
        prompt: 'What does the speaker want?',
        options: [
          { key: 'A', text: 'A ticket' },
          { key: 'B', text: 'A book' },
        ],
        correctAnswer: 'A',
      },
    ];

    const payload = buildAssignmentPayloadFromAuthoringDraft(draft);

    expect(payload).not.toHaveProperty('lastImportReport');
  });

  it('adds a new section with one blank question', () => {
    const draft = createBlankAuthoringDraft('teacher-1');
    const next = addSectionToDraft(draft, {
      title: 'Writing',
      skill: 'writing',
      instructions: 'Write in complete sentences.',
    });

    expect(next.assessmentDraft.sections).toHaveLength(draft.assessmentDraft.sections.length + 1);
    expect(next.assessmentDraft.sections.at(-1)).toEqual(
      expect.objectContaining({
        title: 'Writing',
        skill: 'writing',
        instructions: 'Write in complete sentences.',
        questions: [expect.objectContaining({ skill: 'writing', responseMode: 'short_answer' })],
      })
    );
    expect(next.localRevision).toBe(draft.localRevision + 1);
  });

  it('moves selected questions to a target section in order', () => {
    const draft = applyStructureTemplate(
      createBlankAuthoringDraft('teacher-1'),
      'mixed-skills-homework'
    );
    const sourceSection = draft.assessmentDraft.sections[0];
    const targetSection = draft.assessmentDraft.sections[1];
    const movedIds = sourceSection.questions.slice(0, 1).map((question) => question.id);

    const next = moveQuestionsToSection(draft, movedIds, targetSection.id);

    expect(next.assessmentDraft.sections[0].questions.map((question) => question.id)).not.toEqual(
      expect.arrayContaining(movedIds)
    );
    expect(
      next.assessmentDraft.sections[1].questions.slice(-1).map((question) => question.id)
    ).toEqual(movedIds);
  });

  it('deletes selected questions but keeps every section publishable', () => {
    const draft = applyStructureTemplate(
      createBlankAuthoringDraft('teacher-1'),
      'listening-practice'
    );
    const section = draft.assessmentDraft.sections[0];
    const next = deleteQuestionsFromDraft(
      draft,
      section.questions.slice(1).map((question) => question.id)
    );

    expect(next.assessmentDraft.sections[0].questions).toHaveLength(1);
    expect(() =>
      deleteQuestionsFromDraft(next, [next.assessmentDraft.sections[0].questions[0].id])
    ).toThrow('Each section must keep at least one question');
  });

  it('bulk updates selected question points, level, and skill', () => {
    const draft = applyStructureTemplate(
      createBlankAuthoringDraft('teacher-1'),
      'mixed-skills-homework'
    );
    const ids = draft.assessmentDraft.sections
      .flatMap((section) => section.questions)
      .slice(0, 2)
      .map((question) => question.id);

    const next = bulkUpdateQuestions(draft, ids, { points: 3, level: 'B1', skill: 'reading' });
    const updated = next.assessmentDraft.sections
      .flatMap((section) => section.questions)
      .filter((question) => ids.includes(question.id));

    expect(updated).toEqual([
      expect.objectContaining({ points: 3, level: 'B1', skill: 'reading' }),
      expect.objectContaining({ points: 3, level: 'B1', skill: 'reading' }),
    ]);
  });

  it('includes delivery policy in the authoring publish payload', () => {
    const draft = updateAuthoringDraftFields(
      applyStructureTemplate(createBlankAuthoringDraft('teacher-1'), 'listening-practice'),
      {
        title: 'Targeted assignment',
        classId: 'class-1',
        dueDate: '2026-06-30T10:00:00.000Z',
        deliveryPolicy: {
          targetMode: 'selected_students',
          assignedStudentIds: ['student-1'],
          availableFrom: '2026-06-12T10:00:00.000Z',
          resultReleasePolicy: 'after_due',
        },
      }
    );
    draft.assessmentDraft.sections[0].questions = [
      {
        ...draft.assessmentDraft.sections[0].questions[0],
        prompt: 'What does the speaker want?',
        options: [
          { key: 'A', text: 'A ticket' },
          { key: 'B', text: 'A book' },
        ],
        correctAnswer: 'B',
      },
    ];

    const payload = buildAssignmentPayloadFromAuthoringDraft(draft);
    expect(payload.deliveryPolicy).toEqual({
      targetMode: 'selected_students',
      assignedStudentIds: ['student-1'],
      availableFrom: '2026-06-12T10:00:00.000Z',
      resultReleasePolicy: 'after_due',
    });
  });
});

it('reorders sections by destination index', () => {
  const draft = addSectionToDraft(createBlankAuthoringDraft('teacher-1'), {
    title: 'Reading',
    skill: 'reading',
  });
  const firstId = draft.assessmentDraft.sections[0].id;
  const secondId = draft.assessmentDraft.sections[1].id;

  const next = reorderSectionInDraft(draft, secondId, 0);

  expect(next.assessmentDraft.sections.map((section) => section.id)).toEqual([secondId, firstId]);
  expect(next.localRevision).toBe(draft.localRevision + 1);
});

it('blocks publishing a non-runner interaction type until runner support exists', () => {
  const draft = createBlankAuthoringDraft('teacher-1');
  draft.title = 'Matching homework';
  draft.classId = 'class-1';
  draft.dueDate = '10:00 30/06/2026';
  draft.assessmentDraft.sections[0].questions[0] = {
    ...draft.assessmentDraft.sections[0].questions[0],
    prompt: 'Match the words.',
    interactionType: 'matching',
    responseMode: 'short_answer',
  };

  expect(getAuthoringValidationIssues(draft)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'unsupported_interaction_type',
        area: 'question',
      }),
    ])
  );
});
