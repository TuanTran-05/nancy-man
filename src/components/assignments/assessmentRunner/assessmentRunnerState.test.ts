import { describe, expect, it } from 'vitest';
import type { AssignmentAssessment } from '../../../../shared/assignmentAssessment';
import {
  getAnswerForQuestion,
  getRunnerProgress,
  upsertAssessmentAnswer,
} from './assessmentRunnerState';

const assessment: AssignmentAssessment = {
  version: 2,
  mode: 'practice',
  settings: {
    allowFreeMediaPlayback: true,
    showCorrectAnswersAfterSubmit: false,
    showTranscriptDuringAttempt: false,
  },
  sections: [
    {
      id: 'listening',
      title: 'Listening',
      skill: 'listening',
      questions: [
        {
          id: 'q1',
          skill: 'listening',
          prompt: 'Choose.',
          responseMode: 'multiple_choice',
          media: [],
          options: [
            { key: 'A', text: 'A ticket' },
            { key: 'B', text: 'A book' },
          ],
        },
        {
          id: 'q2',
          skill: 'reading',
          prompt: 'Type.',
          responseMode: 'short_answer',
          media: [],
        },
      ],
    },
  ],
};

describe('assessment runner state', () => {
  it('upserts one answer per question', () => {
    const first = upsertAssessmentAnswer([], {
      questionId: 'q1',
      responseMode: 'multiple_choice',
      selectedOption: 'A',
    });
    const second = upsertAssessmentAnswer(first, {
      questionId: 'q1',
      responseMode: 'multiple_choice',
      selectedOption: 'B',
    });

    expect(second).toEqual([
      { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' },
    ]);
  });

  it('removes blank short answers instead of keeping them answered', () => {
    const answers = upsertAssessmentAnswer(
      [{ questionId: 'q2', responseMode: 'short_answer', textAnswer: 'station' }],
      { questionId: 'q2', responseMode: 'short_answer', textAnswer: '   ' }
    );

    expect(answers).toEqual([]);
  });

  it('keeps recording and uploaded-file answers with content', () => {
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

    expect(
      upsertAssessmentAnswer([], {
        questionId: 'q4',
        responseMode: 'speaking_recording',
        recording,
      })
    ).toEqual([{ questionId: 'q4', responseMode: 'speaking_recording', recording }]);
    expect(
      upsertAssessmentAnswer([], {
        questionId: 'q5',
        responseMode: 'file_upload',
        uploadedFile,
      })
    ).toEqual([{ questionId: 'q5', responseMode: 'file_upload', uploadedFile }]);
  });

  it('reads an answer by question id', () => {
    expect(
      getAnswerForQuestion(
        [{ questionId: 'q2', responseMode: 'short_answer', textAnswer: 'station' }],
        'q2'
      )
    ).toEqual({ questionId: 'q2', responseMode: 'short_answer', textAnswer: 'station' });
  });

  it('returns progress for the runner', () => {
    expect(
      getRunnerProgress(assessment, [
        { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'A' },
      ])
    ).toEqual({ answered: 1, total: 2, percent: 50 });
  });
});
