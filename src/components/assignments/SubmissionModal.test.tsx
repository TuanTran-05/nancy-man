// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SubmissionModal } from './SubmissionModal';

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock('../students/StudentDictionaryPanel', () => ({
  StudentDictionaryPanel: () => null,
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      submissionModal: {
        multipleChoice: 'Multiple Choice',
        essay: 'Essay',
        topic: 'Topic',
        lostFocus: 'Lost focus',
        totalFocusWarning: 'Total warning {warnLimit}/{autoLimit}',
        fullExit: 'Full exit',
        fullExitProgress: '{count}/{limit}',
        noExtraRequests: 'No additional requirements.',
        doAssignment: 'Do Assignment',
        dictionary: 'Dictionary',
        timeRemaining: 'Time Remaining',
        requirements: 'Requirements',
        strictMode: 'Strict Exam Mode',
        strictNoFullscreen: 'You must stay in fullscreen mode during the exam.',
        strictTabSwitch: 'Tab switching is detected.',
        strictQuizEmpty: 'Please answer all questions before submitting.',
        strictDictionary: 'Dictionary is available during the exam.',
        normalMode: 'Normal Mode',
        normalTabSwitchAllowed: 'You can switch tabs or minimize during this assignment.',
        normalNoFullscreen: 'Fullscreen is not required.',
        cancel: 'Cancel',
        startFullscreen: 'Enter Fullscreen and Start',
        startNormal: 'Start Assignment',
        closeLabel: 'Close',
        yourAnswer: 'Your Answer',
        answerFullHint: 'Answer fully.',
        answerPlaceholder: 'Enter your answer...',
        undo: 'Undo',
        bold: 'Bold',
        italic: 'Italic',
        underline: 'Underline',
        bulletList: 'Bullet List',
        numberedList: 'Numbered List',
        alignLeft: 'Align Left',
        justify: 'Justify',
        insertImage: 'Insert Image',
        characterCount: '{count}/{limit}',
        examProgress: 'Exam Progress',
        questionList: 'Question List',
        answered: 'Answered',
        viewing: 'Viewing',
        unanswered: 'Unanswered',
        notes: 'Notes',
        selectOneAnswer: 'Select one answer',
        noScreenExit: 'Do not exit the screen',
        autoSubmitTime: 'Auto submit on time.',
        checkBeforeSubmit: 'Check before submit.',
        fullAnswerHint: 'Answer completely.',
        neatPresentation: 'Present neatly.',
        reviewBeforeSubmit: 'Review before submitting.',
        sentToTeacher: 'Sent to teacher.',
        shortcuts: 'Keyboard Shortcuts',
        nextQuestion: 'Next Question',
        viewAllQuestions: 'View All Questions',
        saveDraft: 'Save Draft',
        submit: 'Submit',
        tabFocusWarningTitle: 'Focus warning',
        tabFocusWarning: 'Focus warning {total} {warnLimit} {autoLimit}',
        fullscreenWarningTitle: 'Fullscreen warning',
        fullscreenWarning: 'Fullscreen warning {count} {limit}',
        understand: 'Understand',
        assessment: 'Assessment',
        answeredQuestions: 'Questions answered',
        completedSections: 'Sections completed',
        submitting: 'Submitting...',
        understood: 'Understand',
        warningTitle: 'Focus warning',
        draftSaving: 'Saving draft...',
        draftSaved: 'Draft saved',
        draftOffline: 'Offline draft saved',
        draftError: 'Could not sync draft',
        draftRestored: 'Saved draft restored',
        discardSavedDraft: 'Discard saved draft',
        devtoolsWarningTitle: 'DevTools warning',
        devtoolsWarning:
          'You are trying to access DevTools during a strict assignment. Focus loss count: {count}/{limit}.',
      },
    },
  }),
}));

const assignment = {
  id: 'assignment-1',
  title: 'Essay',
  description: 'Write something',
  dueDate: '2099-01-01T00:00:00.000Z',
  classId: 'class-1',
  teacherId: 'teacher-1',
  createdAt: '2026-06-11T00:00:00.000Z',
  type: 'essay' as const,
};

const assessmentAssignment = {
  ...assignment,
  title: 'Listening assessment',
  type: 'quiz' as const,
  questions: [],
  assessment: {
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
            prompt: 'What does the speaker want?',
            responseMode: 'multiple_choice' as const,
            media: [],
            options: [
              { key: 'A', text: 'A ticket' },
              { key: 'B', text: 'A book' },
            ],
          },
        ],
      },
    ],
  },
};

function props(overrides = {}) {
  return {
    isOpen: true,
    onClose: vi.fn().mockResolvedValue(undefined),
    selectedAssignment: assignment,
    submissionExamActive: false,
    dictionaryOpen: false,
    setDictionaryOpen: vi.fn(),
    onStartExamSession: vi.fn().mockResolvedValue(undefined),
    onSubmit: vi.fn((event) => event.preventDefault()),
    isSubmitting: false,
    submissionData: { content: '' },
    setSubmissionData: vi.fn(),
    quizAnswers: [],
    setQuizAnswers: vi.fn(),
    examMetrics: {
      tabSwitchCount: 0,
      focusLossCount: 0,
      fullscreenExitCount: 0,
      sessionStartedAt: null,
    },
    integrityOverlay: null,
    setIntegrityOverlay: vi.fn(),
    INTEGRITY_TAB_FOCUS_WARN: 2,
    INTEGRITY_TAB_FOCUS_AUTO_SUBMIT: 4,
    INTEGRITY_FULLSCREEN_AUTO_SUBMIT: 2,
    proctoringMode: 'strict' as const,
    assessmentAnswers: [],
    setAssessmentAnswers: vi.fn(),
    attemptDraftStatus: 'idle' as const,
    attemptDraftRestored: false,
    onClearAttemptDraft: vi.fn(),
    ...overrides,
  };
}

describe('SubmissionModal proctoring mode copy', () => {
  it('strict mode asks students to enter fullscreen', () => {
    render(<SubmissionModal {...props()} />);

    expect(screen.getByText('Strict Exam Mode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enter Fullscreen and Start/i })).toBeInTheDocument();
  });

  it('normal mode starts without fullscreen wording', () => {
    const onStartExamSession = vi.fn().mockResolvedValue(undefined);
    render(
      <SubmissionModal
        {...props({
          proctoringMode: 'normal',
          selectedAssignment: { ...assignment, proctoringMode: 'normal' },
          onStartExamSession,
        })}
      />
    );

    expect(screen.getByText('Normal Mode')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enter Fullscreen/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Start Assignment/i }));
    expect(onStartExamSession).toHaveBeenCalledTimes(1);
  });

  it('renders Assessment v2 runner during an active submission', () => {
    const setAssessmentAnswers = vi.fn();
    render(
      <SubmissionModal
        {...props({
          selectedAssignment: assessmentAssignment,
          submissionExamActive: true,
          setAssessmentAnswers,
        })}
      />
    );

    expect(screen.getByText('Assessment')).toBeInTheDocument();
    expect(screen.getByText('Listening')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /A ticket/i }));
    expect(setAssessmentAnswers).toHaveBeenCalledWith([
      { questionId: 'q1', responseMode: 'multiple_choice', selectedOption: 'A' },
    ]);
  });

  it('shows autosave status and restored draft action', () => {
    render(
      <SubmissionModal
        {...props({
          isOpen: true,
          submissionExamActive: true,
          attemptDraftStatus: 'saved',
          attemptDraftRestored: true,
          onClearAttemptDraft: vi.fn(),
        })}
      />
    );

    expect(screen.getByText(/Draft saved/i)).toBeInTheDocument();
    expect(screen.getByText(/Saved draft restored/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Discard saved draft/i })).toBeInTheDocument();
  });

  it('shows a DevTools-specific integrity warning during an active submission', () => {
    const setIntegrityOverlay = vi.fn();
    render(
      <SubmissionModal
        {...props({
          submissionExamActive: true,
          integrityOverlay: { kind: 'devtools', total: 2 },
          setIntegrityOverlay,
        })}
      />
    );

    expect(screen.getByText('DevTools warning')).toBeInTheDocument();
    expect(screen.getByText(/trying to access DevTools/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Understand/i }));
    expect(setIntegrityOverlay).toHaveBeenCalledWith(null);
  });
});
