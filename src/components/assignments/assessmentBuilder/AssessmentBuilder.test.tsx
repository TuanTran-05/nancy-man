// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AssessmentBuilder } from './AssessmentBuilder';

vi.mock('../../../common/ModalPortal', () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock('../../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      assessmentBuilder: {
        title: 'Advanced assignment builder',
        subtitle: 'Create listening and reading assignments with media.',
        studentPreview: 'Student preview',
        titleLabel: 'Title',
        classLabel: 'Class',
        selectClass: 'Select class',
        dueDate: 'Due date',
        attempts: 'Attempts',
        description: 'Description',
        cancel: 'Cancel',
        saving: 'Saving...',
        create: 'Create advanced assignment',
        addListening: 'Add listening',
        addReading: 'Add reading',
        addMixed: 'Add mixed',
        settingsTitle: 'Assignment settings',
        canvasTitle: 'Questions',
        formDescriptionPlaceholder: 'Describe the assignment',
        assignmentTitlePlaceholder: 'Untitled advanced assignment',
        proctoringMode: 'Proctoring mode',
        strictMode: 'Strict mode',
        normalMode: 'Normal mode',
        allowFreeMediaPlayback: 'Allow free media playback',
        showCorrectAnswersAfterSubmit: 'Show answers after submit',
        showTranscriptDuringAttempt: 'Show transcript during attempt',
        addMultipleChoice: 'Add multiple choice',
        addShortAnswer: 'Add short answer',
        addSpeakingRecording: 'Add speaking recording',
        duplicateQuestion: 'Duplicate question',
        removeQuestion: 'Remove question',
        removeSection: 'Remove section',
        sectionTitle: 'Section title',
        sectionInstructions: 'Instructions',
        questionPrompt: 'Question prompt',
        points: 'Points',
        questionMedia: 'Question media',
        addMedia: 'Add media',
        hideMedia: 'Hide media',
      },
    },
  }),
}));

describe('AssessmentBuilder', () => {
  it('submits an assessment v2 payload', () => {
    const onSubmit = vi.fn();
    render(
      <AssessmentBuilder
        isOpen
        onClose={vi.fn()}
        classes={[{ id: 'class-1', name: 'Class 1' } as any]}
        isSaving={false}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Listening quiz' } });
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'class-1' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '10:30 30/06/2026' } });
    fireEvent.change(screen.getByLabelText('Question 1 prompt'), {
      target: { value: 'What does the speaker want?' },
    });
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'A ticket' } });
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'A book' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create advanced assignment' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Listening quiz',
        classId: 'class-1',
        dueDate: '2026-06-30T03:30:00.000Z',
        type: 'quiz',
        assessment: expect.objectContaining({
          version: 2,
          sections: expect.any(Array),
        }),
      })
    );
  });

  it('shows validation messages before submit', () => {
    const onSubmit = vi.fn();
    render(
      <AssessmentBuilder
        isOpen
        onClose={vi.fn()}
        classes={[{ id: 'class-1', name: 'Class 1' } as any]}
        isSaving={false}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create advanced assignment' }));

    expect(screen.getByText('Title is required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders a Google Forms-style canvas with an EduTrack settings panel', () => {
    render(
      <AssessmentBuilder
        isOpen
        onClose={vi.fn()}
        classes={[{ id: 'class-1', name: 'Class 1' } as any]}
        isSaving={false}
        onSubmit={vi.fn()}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Advanced assignment builder' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Questions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Assignment settings' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Untitled advanced assignment')).toBeInTheDocument();
    expect(screen.getByLabelText('Class')).toBeInTheDocument();
    expect(screen.getByLabelText('Due date')).toBeInTheDocument();
    expect(screen.getByLabelText('Strict mode')).toBeChecked();
    expect(screen.getByLabelText('Allow free media playback')).toBeChecked();
    expect(screen.getByText('Student preview')).toBeInTheDocument();
  });

  it('submits changed proctoring and assessment settings in the existing assessment v2 payload', () => {
    const onSubmit = vi.fn();
    render(
      <AssessmentBuilder
        isOpen
        onClose={vi.fn()}
        classes={[{ id: 'class-1', name: 'Class 1' } as any]}
        isSaving={false}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Untitled advanced assignment'), {
      target: { value: 'Forms-style listening quiz' },
    });
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'class-1' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '10:30 30/06/2026' } });
    fireEvent.change(screen.getByLabelText('Question 1 prompt'), {
      target: { value: 'What does the speaker want?' },
    });
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'A ticket' } });
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'A book' } });
    fireEvent.click(screen.getByLabelText('Normal mode'));
    fireEvent.click(screen.getByLabelText('Allow free media playback'));
    fireEvent.click(screen.getByLabelText('Show answers after submit'));
    fireEvent.click(screen.getByLabelText('Show transcript during attempt'));
    fireEvent.click(screen.getByRole('button', { name: 'Create advanced assignment' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Forms-style listening quiz',
        classId: 'class-1',
        proctoringMode: 'normal',
        assessment: expect.objectContaining({
          version: 2,
          settings: {
            allowFreeMediaPlayback: false,
            showCorrectAnswersAfterSubmit: true,
            showTranscriptDuringAttempt: true,
          },
        }),
      })
    );
  });

  it('adds a speaking recording question from the compact toolbar', () => {
    render(
      <AssessmentBuilder
        isOpen
        onClose={vi.fn()}
        classes={[{ id: 'class-1', name: 'Class 1' } as any]}
        isSaving={false}
        onSubmit={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Add speaking recording' })[0]);

    expect(screen.getByLabelText('Question 2 prompt')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Response mode')[1]).toHaveValue('speaking_recording');
  });

  it('keeps responsive toolbar buttons available to assistive technology', () => {
    render(
      <AssessmentBuilder
        isOpen
        onClose={vi.fn()}
        classes={[{ id: 'class-1', name: 'Class 1' } as any]}
        isSaving={false}
        onSubmit={vi.fn()}
      />
    );

    expect(
      document.body.querySelector('[class*="md:hidden"][aria-hidden="true"]')
    ).not.toBeInTheDocument();
  });
});
