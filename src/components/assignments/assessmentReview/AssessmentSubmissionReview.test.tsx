// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  AssignmentAssessment,
  AssessmentAnswer,
  AssessmentScore,
} from '../../../../shared/assignmentAssessment';
import { AssessmentSubmissionReview } from './AssessmentSubmissionReview';

vi.mock('../../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      assessmentReview: {
        points: '{points}/{max} pts',
        selectedAnswer: 'Selected answer',
        textAnswer: 'Text answer',
        noAnswer: 'No answer',
        correctAnswer: 'Correct answer',
        acceptedAnswers: 'Accepted answers',
        teacherFeedback: 'Teacher feedback',
        scoreInput: 'Score',
        questionMedia: 'Question media',
        audio: 'Audio',
        video: 'Video',
        openDocument: 'Open document',
        recording: 'Recording',
        questionFeedback: 'Question feedback',
        uploadedFile: 'Uploaded file',
        openFile: 'Open file',
        pendingGrading: 'Pending manual grading',
      },
    },
  }),
}));

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
      id: 's1',
      title: 'Listening',
      skill: 'listening',
      questions: [
        {
          id: 'q1',
          skill: 'listening',
          prompt: 'Choose the place.',
          responseMode: 'multiple_choice',
          media: [
            {
              id: 'm1',
              type: 'audio',
              source: 'external_url',
              url: 'https://cdn.example.com/a.mp3',
            },
          ],
          points: 2,
          options: [
            { key: 'A', text: 'Station' },
            { key: 'B', text: 'Library' },
          ],
        },
        {
          id: 'q2',
          skill: 'speaking',
          prompt: 'Say one sentence.',
          responseMode: 'speaking_recording',
          media: [],
          points: 3,
        },
      ],
    },
  ],
};

const answers: AssessmentAnswer[] = [
  { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' },
  {
    questionId: 'q2',
    responseMode: 'speaking_recording',
    recording: {
      id: 'r1',
      type: 'audio',
      source: 'upload',
      url: 'https://cdn.example.com/r.webm',
      storagePath: 'answers/r.webm',
    },
  },
];

const score: AssessmentScore = {
  totalPoints: 2,
  maxPoints: 5,
  questionScores: [
    { questionId: 'q1', pointsAwarded: 2, maxPoints: 2, gradingMode: 'auto' },
    { questionId: 'q2', pointsAwarded: 0, maxPoints: 3, gradingMode: 'manual' },
  ],
};

describe('AssessmentSubmissionReview', () => {
  it('renders teacher grading controls, answer keys, media, and recordings', () => {
    const onDraftChange = vi.fn();
    render(
      <AssessmentSubmissionReview
        assessment={assessment}
        answers={answers}
        score={score}
        keyMap={{ q1: { questionId: 'q1', correctAnswer: 'A', gradingMode: 'auto' } }}
        canGrade
        showCorrectAnswers
        gradingDraft={{
          q1: { questionId: 'q1', pointsAwarded: '2', feedback: '' },
          q2: { questionId: 'q2', pointsAwarded: '0', feedback: '' },
        }}
        onDraftChange={onDraftChange}
      />
    );

    expect(screen.getByText('Choose the place.')).toBeInTheDocument();
    expect(screen.getByText(/Correct answer/)).toBeInTheDocument();
    expect(screen.getByText('Recording')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Score for Say one sentence.'), {
      target: { value: '2.5' },
    });
    expect(onDraftChange).toHaveBeenCalled();
  });

  it('hides answer keys in student-safe review mode', () => {
    render(
      <AssessmentSubmissionReview
        assessment={assessment}
        answers={answers}
        score={score}
        keyMap={{ q1: { questionId: 'q1', correctAnswer: 'A', gradingMode: 'auto' } }}
        canGrade={false}
        showCorrectAnswers={false}
      />
    );

    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();
    expect(screen.getByText('Selected answer')).toBeInTheDocument();
  });

  it('shows read-only per-question feedback to students', () => {
    render(
      <AssessmentSubmissionReview
        assessment={assessment}
        answers={[{ questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' }]}
        score={{
          totalPoints: 1,
          maxPoints: 2,
          questionScores: [
            {
              questionId: 'q1',
              pointsAwarded: 1,
              maxPoints: 2,
              gradingMode: 'auto',
              feedback: 'Review the second paragraph.',
            },
          ],
        }}
        canGrade={false}
        showCorrectAnswers={false}
      />
    );

    expect(screen.getByText('Review the second paragraph.')).toBeInTheDocument();
  });

  it('renders file_upload answer metadata and download link', () => {
    const fileAssessment = {
      ...assessment,
      sections: [
        {
          id: 's-file',
          title: 'File Upload Section',
          skill: 'reading',
          questions: [
            {
              id: 'q-file',
              skill: 'reading',
              prompt: 'Submit your PDF file.',
              responseMode: 'file_upload',
              media: [],
              points: 5,
            },
          ],
        },
      ],
    } as AssignmentAssessment;

    const fileAnswers: AssessmentAnswer[] = [
      {
        questionId: 'q-file',
        responseMode: 'file_upload',
        uploadedFile: {
          id: 'upload-1',
          type: 'document',
          source: 'upload',
          url: 'https://cdn.example.com/essay.pdf',
          storagePath: 'answers/essay.pdf',
          title: 'essay.pdf',
        },
      },
    ];

    render(
      <AssessmentSubmissionReview
        assessment={fileAssessment}
        answers={fileAnswers}
        score={{
          totalPoints: 0,
          maxPoints: 5,
          questionScores: [
            { questionId: 'q-file', pointsAwarded: 0, maxPoints: 5, gradingMode: 'manual' },
          ],
        }}
        canGrade={false}
        showCorrectAnswers={false}
      />
    );

    expect(screen.getByText('Submit your PDF file.')).toBeInTheDocument();
    expect(screen.getByText('Uploaded file')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'essay.pdf' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://cdn.example.com/essay.pdf');
  });

  it('renders pendingGrading status badge in reviewer interface when manual grading has not completed', () => {
    render(
      <AssessmentSubmissionReview
        assessment={assessment}
        answers={answers}
        score={score}
        canGrade={true}
        showCorrectAnswers={false}
        submissionStatus="submitted"
      />
    );

    // Q2 has responseMode: 'speaking_recording' and is graded manually.
    // Since submissionStatus is "submitted", it should show the "Pending manual grading" badge.
    expect(screen.getByText('Pending manual grading')).toBeInTheDocument();
  });
});
