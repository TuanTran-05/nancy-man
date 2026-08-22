import { describe, expect, it } from 'vitest';
import {
  assignmentAssessmentInputSchema,
  extractAssessmentKeys,
  projectAssignmentAssessmentForRole,
  getAssessmentQuestionList,
  getAssessmentProgress,
  normalizeAssessmentAnswers,
  scoreAssessmentMultipleChoice,
  applyAssessmentQuestionGrades,
  calculateAssessmentGrade,
  projectAssessmentKeysForReview,
} from './assignmentAssessment';

const validAssessment = {
  version: 2,
  mode: 'practice',
  settings: {
    showTranscriptDuringAttempt: false,
  },
  sections: [
    {
      id: 'section-listening',
      title: 'Listening Part 1',
      skill: 'listening',
      instructions: 'Listen and choose the best answer.',
      questions: [
        {
          id: 'q-audio-1',
          skill: 'listening',
          prompt: 'What does the speaker want?',
          responseMode: 'multiple_choice',
          media: [
            {
              id: 'media-audio-1',
              type: 'audio',
              source: 'external_url',
              url: 'https://cdn.example.com/audio/unit-1.mp3',
              title: 'Dialogue',
              transcript: 'Speaker transcript hidden during attempt.',
              displayMode: 'hidden_until_review',
            },
          ],
          options: [
            { key: 'A', text: 'A ticket' },
            { key: 'B', text: 'A book' },
          ],
          points: 1,
          correctAnswer: 'B',
          acceptedAnswers: ['B'],
          gradingMode: 'auto',
          rubric: [{ id: 'choice', label: 'Correct choice', maxPoints: 1 }],
        },
      ],
    },
  ],
};

describe('assignment assessment v2 schemas', () => {
  it('accepts a valid media assessment input', () => {
    const result = assignmentAssessmentInputSchema.safeParse(validAssessment);
    expect(result.success).toBe(true);
  });

  it('rejects duplicate question ids across sections', () => {
    const assessment = {
      ...validAssessment,
      sections: [
        validAssessment.sections[0],
        {
          id: 'section-reading',
          title: 'Reading Part 1',
          skill: 'reading',
          questions: [
            {
              id: 'q-audio-1',
              skill: 'reading',
              prompt: 'Choose the best heading.',
              responseMode: 'short_answer',
              media: [],
            },
          ],
        },
      ],
    };

    const result = assignmentAssessmentInputSchema.safeParse(assessment);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(
        result.error.issues.some((issue) => issue.message.includes('Duplicate question id'))
      ).toBe(true);
    }
  });

  it('rejects external media that is not https', () => {
    const assessment = structuredClone(validAssessment);
    assessment.sections[0].questions[0].media[0].url = 'http://cdn.example.com/audio.mp3';

    const result = assignmentAssessmentInputSchema.safeParse(assessment);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error.issues.some((issue) => issue.message.includes('https'))).toBe(true);
    }
  });

  it('requires upload media to include a storage path', () => {
    const assessment = structuredClone(validAssessment);
    assessment.sections[0].questions[0].media[0] = {
      id: 'media-upload-1',
      type: 'image',
      source: 'upload',
      url: 'https://app.example.com/api/v1/files/read?path=assignments%2Fimage.png&signed=test',
    } as any;

    const result = assignmentAssessmentInputSchema.safeParse(assessment);
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error.issues.some((issue) => issue.message.includes('storagePath'))).toBe(true);
    }
  });

  it('extracts private keys and returns a safe assessment payload', () => {
    const { safeAssessment, keyMap } = extractAssessmentKeys(validAssessment);

    expect(safeAssessment).toEqual({
      version: 2,
      mode: 'practice',
      settings: {
        allowFreeMediaPlayback: true,
        showCorrectAnswersAfterSubmit: false,
        showTranscriptDuringAttempt: false,
      },
      sections: [
        {
          id: 'section-listening',
          title: 'Listening Part 1',
          skill: 'listening',
          instructions: 'Listen and choose the best answer.',
          questions: [
            {
              id: 'q-audio-1',
              skill: 'listening',
              prompt: 'What does the speaker want?',
              responseMode: 'multiple_choice',
              media: [
                {
                  id: 'media-audio-1',
                  type: 'audio',
                  source: 'external_url',
                  url: 'https://cdn.example.com/audio/unit-1.mp3',
                  title: 'Dialogue',
                  transcript: 'Speaker transcript hidden during attempt.',
                  displayMode: 'hidden_until_review',
                },
              ],
              options: [
                { key: 'A', text: 'A ticket' },
                { key: 'B', text: 'A book' },
              ],
              points: 1,
            },
          ],
        },
      ],
    });
    expect(keyMap).toEqual({
      'q-audio-1': {
        questionId: 'q-audio-1',
        correctAnswer: 'B',
        acceptedAnswers: ['B'],
        gradingMode: 'auto',
        rubric: [{ id: 'choice', label: 'Correct choice', maxPoints: 1 }],
      },
    });
    expect(JSON.stringify(safeAssessment)).not.toContain('correctAnswer');
    expect(JSON.stringify(safeAssessment)).not.toContain('acceptedAnswers');
    expect(JSON.stringify(safeAssessment)).not.toContain('rubric');
  });

  it('hides transcripts from student and parent projections by default', () => {
    const { safeAssessment } = extractAssessmentKeys(validAssessment);

    const studentProjection = projectAssignmentAssessmentForRole(safeAssessment, 'student');
    const parentProjection = projectAssignmentAssessmentForRole(safeAssessment, 'parent');
    const teacherProjection = projectAssignmentAssessmentForRole(safeAssessment, 'teacher');

    expect(JSON.stringify(studentProjection)).not.toContain('Speaker transcript');
    expect(JSON.stringify(parentProjection)).not.toContain('Speaker transcript');
    expect(JSON.stringify(teacherProjection)).toContain('Speaker transcript');
  });
});

const runnableAssessment = {
  version: 2 as const,
  mode: 'practice' as const,
  settings: {
    allowFreeMediaPlayback: true,
    showCorrectAnswersAfterSubmit: false,
    showTranscriptDuringAttempt: false,
  },
  sections: [
    {
      id: 'listening',
      title: 'Listening',
      skill: 'listening' as const,
      questions: [
        {
          id: 'q1',
          skill: 'listening' as const,
          prompt: 'Listen and choose.',
          responseMode: 'multiple_choice' as const,
          media: [],
          options: [
            { key: 'A', text: 'A ticket' },
            { key: 'B', text: 'A book' },
          ],
          points: 2,
        },
        {
          id: 'q2',
          skill: 'listening' as const,
          prompt: 'Write the missing word.',
          responseMode: 'short_answer' as const,
          media: [],
          points: 3,
        },
      ],
    },
  ],
};

describe('assessment submission helpers', () => {
  it('flattens Assessment v2 questions in section order', () => {
    expect(getAssessmentQuestionList(runnableAssessment).map((question) => question.id)).toEqual([
      'q1',
      'q2',
    ]);
  });

  it('normalizes submitted assessment answers to known questions and supported fields', () => {
    expect(
      normalizeAssessmentAnswers(
        [
          { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' },
          { questionId: 'q2', responseMode: 'short_answer', textAnswer: '  station  ' },
          { questionId: 'unknown', responseMode: 'short_answer', textAnswer: 'ignored' },
        ],
        runnableAssessment
      )
    ).toEqual([
      { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' },
      { questionId: 'q2', responseMode: 'short_answer', textAnswer: 'station' },
    ]);
  });

  it('normalizes long text, recording, and uploaded-file answers', () => {
    const recording = {
      id: 'recording-1',
      type: 'audio' as const,
      source: 'upload' as const,
      url: 'https://cdn.example.com/recording.mp3',
      storagePath: 'assessment-answers/recording.mp3',
    };
    const uploadedFile = {
      id: 'upload-1',
      type: 'document' as const,
      source: 'upload' as const,
      url: 'https://cdn.example.com/file.pdf',
      storagePath: 'assessment-answers/file.pdf',
    };
    const extendedAssessment = {
      ...runnableAssessment,
      sections: [
        {
          ...runnableAssessment.sections[0],
          questions: [
            {
              id: 'q3',
              skill: 'writing' as const,
              prompt: 'Write a paragraph.',
              responseMode: 'long_answer' as const,
              media: [],
            },
            {
              id: 'q4',
              skill: 'speaking' as const,
              prompt: 'Record your answer.',
              responseMode: 'speaking_recording' as const,
              media: [],
            },
            {
              id: 'q5',
              skill: 'reading' as const,
              prompt: 'Upload your answer sheet.',
              responseMode: 'file_upload' as const,
              media: [],
            },
          ],
        },
      ],
    };

    expect(
      normalizeAssessmentAnswers(
        [
          { questionId: 'q3', responseMode: 'long_answer', textAnswer: '  My paragraph  ' },
          { questionId: 'q4', responseMode: 'speaking_recording', recording },
          { questionId: 'q5', responseMode: 'file_upload', uploadedFile },
        ],
        extendedAssessment
      )
    ).toEqual([
      { questionId: 'q3', responseMode: 'long_answer', textAnswer: 'My paragraph' },
      { questionId: 'q4', responseMode: 'speaking_recording', recording },
      { questionId: 'q5', responseMode: 'file_upload', uploadedFile },
    ]);
  });

  it('reports Assessment v2 progress from normalized answers', () => {
    expect(
      getAssessmentProgress(runnableAssessment, [
        { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' },
      ])
    ).toEqual({ answered: 1, total: 2, percent: 50 });
  });

  it('does not count blank short answers as answered progress', () => {
    expect(
      getAssessmentProgress(runnableAssessment, [
        { questionId: 'q2', responseMode: 'short_answer', textAnswer: '   ' },
      ])
    ).toEqual({ answered: 0, total: 2, percent: 0 });
  });

  it('auto-scores fully multiple-choice Assessment v2 submissions', () => {
    const assessment = {
      ...runnableAssessment,
      sections: [
        {
          ...runnableAssessment.sections[0],
          questions: [runnableAssessment.sections[0].questions[0]],
        },
      ],
    };

    expect(
      scoreAssessmentMultipleChoice(
        assessment,
        [{ questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' }],
        {
          q1: { questionId: 'q1', correctAnswer: 'B', gradingMode: 'auto' },
        }
      )
    ).toEqual({
      canAutoGradeAll: true,
      grade: 10,
      score: {
        totalPoints: 2,
        maxPoints: 2,
        questionScores: [
          {
            questionId: 'q1',
            pointsAwarded: 2,
            maxPoints: 2,
            gradingMode: 'auto',
          },
        ],
      },
    });
  });

  it('preserves manual grading when short-answer questions are present', () => {
    expect(
      scoreAssessmentMultipleChoice(
        runnableAssessment,
        [
          { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' },
          { questionId: 'q2', responseMode: 'short_answer', textAnswer: 'station' },
        ],
        {
          q1: { questionId: 'q1', correctAnswer: 'B', gradingMode: 'auto' },
          q2: { questionId: 'q2', acceptedAnswers: ['station'], gradingMode: 'manual' },
        }
      )
    ).toMatchObject({
      canAutoGradeAll: false,
      grade: null,
      score: {
        totalPoints: 2,
        maxPoints: 5,
      },
    });
  });

  it('applies per-question manual Assessment v2 grades and derives a 0-10 grade', () => {
    const result = applyAssessmentQuestionGrades(
      runnableAssessment,
      {
        totalPoints: 0,
        maxPoints: 5,
        questionScores: [
          { questionId: 'q1', pointsAwarded: 0, maxPoints: 2, gradingMode: 'auto' },
          { questionId: 'q2', pointsAwarded: 0, maxPoints: 3, gradingMode: 'manual' },
        ],
      },
      [
        { questionId: 'q1', pointsAwarded: 2 },
        { questionId: 'q2', pointsAwarded: 2.5, feedback: 'Good word choice' },
      ]
    );

    expect(result).toEqual({
      assessmentScore: {
        totalPoints: 4.5,
        maxPoints: 5,
        questionScores: [
          { questionId: 'q1', pointsAwarded: 2, maxPoints: 2, gradingMode: 'auto' },
          {
            questionId: 'q2',
            pointsAwarded: 2.5,
            maxPoints: 3,
            gradingMode: 'manual',
            feedback: 'Good word choice',
          },
        ],
      },
      grade: 9,
    });
  });

  it('rejects Assessment v2 grades above question max points', () => {
    expect(() =>
      applyAssessmentQuestionGrades(runnableAssessment, undefined, [
        { questionId: 'q2', pointsAwarded: 4 },
      ])
    ).toThrow('Invalid points for question q2');
  });

  it('calculates null Assessment v2 grade when max points is zero', () => {
    expect(
      calculateAssessmentGrade({ totalPoints: 0, maxPoints: 0, questionScores: [] })
    ).toBeNull();
  });

  it('projects private Assessment v2 keys for review without leaking rubric to students', () => {
    const keyMap = {
      q1: { questionId: 'q1', correctAnswer: 'B', gradingMode: 'auto' as const },
      q2: {
        questionId: 'q2',
        acceptedAnswers: ['station'],
        gradingMode: 'manual' as const,
        rubric: [{ id: 'r1', label: 'Accuracy', maxPoints: 3 }],
      },
    };

    expect(projectAssessmentKeysForReview(keyMap, 'teacher')).toEqual(keyMap);
    expect(projectAssessmentKeysForReview(keyMap, 'student')).toEqual({
      q1: { questionId: 'q1', correctAnswer: 'B', gradingMode: 'auto' },
      q2: { questionId: 'q2', acceptedAnswers: ['station'], gradingMode: 'manual' },
    });
  });
});

it('accepts optional authoring interaction metadata without exposing answers in safe assessment', () => {
  const parsed = assignmentAssessmentInputSchema.parse({
    version: 2,
    mode: 'practice',
    sections: [
      {
        id: 'section-1',
        title: 'Reading',
        skill: 'reading',
        questions: [
          {
            id: 'question-1',
            skill: 'reading',
            prompt: 'Order the events.',
            responseMode: 'short_answer',
            interactionType: 'ordering',
            orderingItems: [
              { id: 'item-1', text: 'First' },
              { id: 'item-2', text: 'Second' },
            ],
            acceptedAnswers: ['item-1,item-2'],
            gradingMode: 'manual',
            media: [],
            points: 2,
            required: true,
          },
        ],
      },
    ],
  });

  const { safeAssessment, keyMap } = extractAssessmentKeys(parsed);
  expect(safeAssessment.sections[0].questions[0]).toMatchObject({
    interactionType: 'ordering',
    required: true,
    orderingItems: [
      { id: 'item-1', text: 'First' },
      { id: 'item-2', text: 'Second' },
    ],
  });
  expect(keyMap['question-1']).toEqual({
    questionId: 'question-1',
    acceptedAnswers: ['item-1,item-2'],
    gradingMode: 'manual',
  });
});

it('accepts option media metadata for image choices', () => {
  const parsed = assignmentAssessmentInputSchema.parse({
    version: 2,
    mode: 'practice',
    sections: [
      {
        id: 'section-1',
        title: 'Image question',
        skill: 'reading',
        questions: [
          {
            id: 'question-1',
            skill: 'reading',
            prompt: 'Choose the picture.',
            responseMode: 'multiple_choice',
            interactionType: 'image_question',
            options: [
              { key: 'A', text: 'Park' },
              { key: 'B', text: 'Library' },
            ],
            optionMedia: {
              A: [
                {
                  id: 'media-a',
                  type: 'image',
                  source: 'external_url',
                  url: 'https://example.com/a.png',
                  altText: 'Park',
                },
              ],
            },
            correctAnswer: 'A',
            media: [],
          },
        ],
      },
    ],
  });

  expect(parsed.sections[0].questions[0].optionMedia?.A[0].type).toBe('image');
});
