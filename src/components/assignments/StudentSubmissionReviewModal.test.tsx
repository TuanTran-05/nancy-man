// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentSubmissionReviewModal } from './StudentSubmissionReviewModal';

vi.mock('../../lib/api/apiClient', () => ({
  apiRequest: vi.fn().mockResolvedValue({
    success: true,
    data: { q1: { questionId: 'q1', correctAnswer: 'A', gradingMode: 'auto' } },
  }),
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      studentSubmissionReviewModal: {
        title: 'Review',
        submittedAtLabel: '{title} at {time}',
        close: 'Close',
        answersWillShow: 'Answers will show later',
        yourSubmission: 'Your submission',
        teacherEvaluation: 'Teacher evaluation',
        scoreLabel: '{grade}/10',
        noComments: 'No comments',
        awaitingGrading: 'Awaiting teacher grading',
        graded: 'Graded',
        answersLockedByPolicy: 'Correct answers are not released yet.',
      },
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
        uploadedFile: 'Uploaded file',
        openFile: 'Open file',
        pendingGrading: 'Pending manual grading',
      },
    },
  }),
}));

describe('StudentSubmissionReviewModal Assessment v2', () => {
  const assignment = {
    id: 'assignment-1',
    title: 'Assessment',
    type: 'quiz',
    assessment: {
      version: 2,
      mode: 'practice',
      settings: {
        allowFreeMediaPlayback: true,
        showCorrectAnswersAfterSubmit: true,
        showTranscriptDuringAttempt: false,
      },
      sections: [
        {
          id: 's1',
          title: 'Reading',
          skill: 'reading',
          questions: [
            {
              id: 'q1',
              skill: 'reading',
              prompt: 'Choose.',
              responseMode: 'multiple_choice',
              media: [],
              points: 2,
              options: [
                { key: 'A', text: 'A' },
                { key: 'B', text: 'B' },
              ],
            },
          ],
        },
      ],
    },
  } as any;

  const submission = {
    id: 'submission-1',
    assignmentId: 'assignment-1',
    studentId: 'student-1',
    teacherId: 'teacher-1',
    classId: 'class-1',
    content: '',
    assessmentAnswers: [{ questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'B' }],
    assessmentScore: {
      totalPoints: 2,
      maxPoints: 2,
      questionScores: [{ questionId: 'q1', pointsAwarded: 2, maxPoints: 2, gradingMode: 'auto' }],
    },
    status: 'graded',
    grade: 8,
    feedback: 'Good work',
    submittedAt: '2026-06-11T00:00:00.000Z',
  } as any;

  it('renders Assessment v2 answers in review mode', async () => {
    render(
      <StudentSubmissionReviewModal
        isOpen
        onClose={vi.fn()}
        assignment={assignment}
        submission={submission}
        showCorrectAnswers
      />
    );

    expect(await screen.findByText('Choose.')).toBeInTheDocument();
    expect(screen.getByText('Selected answer')).toBeInTheDocument();
  });

  it('hides Assessment v2 answer keys until allowed', () => {
    render(
      <StudentSubmissionReviewModal
        isOpen
        onClose={vi.fn()}
        assignment={assignment}
        submission={submission}
        showCorrectAnswers={false}
      />
    );

    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();
    expect(screen.getByText('Correct answers are not released yet.')).toBeInTheDocument();
  });

  it('shows awaiting grading state for submitted Assessment v2 work', () => {
    render(
      <StudentSubmissionReviewModal
        isOpen
        onClose={vi.fn()}
        assignment={assignment}
        submission={{ ...submission, status: 'submitted', grade: null, assessmentScore: null }}
        showCorrectAnswers={false}
      />
    );

    expect(screen.getByText('Awaiting teacher grading')).toBeInTheDocument();
  });

  it('shows grade and global feedback when graded results are released', () => {
    render(
      <StudentSubmissionReviewModal
        isOpen
        onClose={vi.fn()}
        assignment={assignment}
        submission={{ ...submission, status: 'graded', grade: 8, feedback: 'Good work' }}
        showCorrectAnswers
      />
    );

    expect(screen.getByText('8/10')).toBeInTheDocument();
    expect(screen.getByText('Good work')).toBeInTheDocument();
    expect(screen.getByText('2/2 pts')).toBeInTheDocument();
  });

  it('hides graded Assessment v2 scores while result release is locked', () => {
    render(
      <StudentSubmissionReviewModal
        isOpen
        onClose={vi.fn()}
        assignment={assignment}
        submission={{ ...submission, status: 'graded', grade: 8, feedback: 'Good work' }}
        showCorrectAnswers={false}
      />
    );

    expect(screen.queryByText('8/10')).not.toBeInTheDocument();
    expect(screen.queryByText('Good work')).not.toBeInTheDocument();
    expect(screen.queryByText('2/2 pts')).not.toBeInTheDocument();
    expect(screen.getByText('Correct answers are not released yet.')).toBeInTheDocument();
  });

  it('does not crash when closed without an assignment or submission', () => {
    expect(() =>
      render(
        <StudentSubmissionReviewModal
          isOpen={false}
          onClose={vi.fn()}
          assignment={null}
          submission={null}
          showCorrectAnswers={false}
        />
      )
    ).not.toThrow();
  });
});
