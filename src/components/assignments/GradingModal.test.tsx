// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GradingModal } from './GradingModal';

vi.mock('../../lib/api/apiClient', () => ({
  apiRequest: vi.fn().mockResolvedValue({
    success: true,
    data: { q2: { questionId: 'q2', acceptedAnswers: ['station'], gradingMode: 'manual' } },
  }),
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      common: { cancel: 'Cancel' },
      gradingModal: {
        title: 'Grade submission',
        studentPrefix: 'Student:',
        closeLabel: 'Close',
        studentFallback: 'Student',
        saving: 'Saving',
        saveResult: 'Save result',
        updateComment: 'Update comment',
        quizResults: 'Quiz results',
        submissionContent: 'Submission content',
        examTracking: 'Exam tracking',
        tabSwitches: 'Tab switches',
        focusLosses: 'Focus losses',
        fullscreenExits: 'Fullscreen exits',
        sessionStarted: 'Started',
        autoSubmitted: 'Auto submitted',
        autoSubmitTabReason: 'Tab limit {count}',
        autoSubmitFullscreenReason: 'Fullscreen limit {count}',
        scoreLabel: 'Score',
        commentLabel: 'Comment',
        commentPlaceholder: 'Comment',
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
      },
    },
  }),
}));

describe('GradingModal Assessment v2', () => {
  it('submits per-question Assessment v2 scores', async () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(
      <GradingModal
        isOpen
        onClose={vi.fn()}
        selectedSubmission={{
          id: 'submission-1',
          assignmentId: 'assignment-1',
          studentId: 'student-1',
          teacherId: 'teacher-1',
          classId: 'class-1',
          content: '',
          assessmentAnswers: [
            { questionId: 'q2', responseMode: 'short_answer', textAnswer: 'station' },
          ],
          assessmentScore: {
            totalPoints: 0,
            maxPoints: 3,
            questionScores: [
              { questionId: 'q2', pointsAwarded: 0, maxPoints: 3, gradingMode: 'manual' },
            ],
          },
          status: 'submitted',
          submittedAt: '2026-06-11T00:00:00.000Z',
        }}
        assignments={[
          {
            id: 'assignment-1',
            title: 'Assessment',
            description: '',
            dueDate: '2026-06-12T00:00:00.000Z',
            classId: 'class-1',
            teacherId: 'teacher-1',
            createdAt: '2026-06-11T00:00:00.000Z',
            type: 'quiz',
            assessment: {
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
                  title: 'Reading',
                  skill: 'reading',
                  questions: [
                    {
                      id: 'q2',
                      skill: 'reading',
                      prompt: 'Write one word.',
                      responseMode: 'short_answer',
                      media: [],
                      points: 3,
                    },
                  ],
                },
              ],
            },
          },
        ]}
        students={[{ id: 'student-1', name: 'An' } as any]}
        gradingData={{ grade: '', feedback: '' }}
        setGradingData={vi.fn()}
        onSubmit={onSubmit}
        isGrading={false}
        INTEGRITY_TAB_FOCUS_AUTO_SUBMIT={3}
        INTEGRITY_FULLSCREEN_AUTO_SUBMIT={2}
      />
    );

    await waitFor(() => expect(screen.getByText('Write one word.')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Score for Write one word.'), {
      target: { value: '2.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
