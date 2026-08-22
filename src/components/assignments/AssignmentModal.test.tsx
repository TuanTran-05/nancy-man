// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AssignmentModal } from './AssignmentModal';

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock('../common/ModalPortal', () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({
    t: {
      assignmentModal: {
        close: 'Close',
        essayType: 'Essay',
        quizType: 'Quiz',
        titleLabel: 'Title',
        descLabel: 'Description',
        dueDate: 'Due date',
        classLabel: 'Class',
        selectClass: 'Select class',
        maxAttempts: 'Allowed attempts',
        maxAttemptsPlaceholder: 'Example: 1',
        maxAttemptsHint: 'Students can retry up to this number of attempts.',
        proctoringMode: 'Proctoring mode',
        strictMode: 'Strict mode',
        strictModeHint: 'Fullscreen and tab-switch checks are enforced.',
        normalMode: 'Normal mode',
        normalModeHint: 'Students may switch tabs or minimize freely.',
        cancel: 'Cancel',
        saving: 'Saving...',
        createTitle: 'New Assignment',
        editTitle: 'Edit Assignment',
        titlePlaceholder: 'Title...',
        contentPlaceholder: 'Content...',
        update: 'Update',
        assign: 'Assign',
        questionList: 'Question list ({count})',
        addQuestion: 'Add question',
        importFromJson: 'Import from JSON',
        importCode: 'Import code',
        aiHint: 'AI hint:',
        aiHintDesc: 'Use JSON.',
        createWithAI: 'Create with AI',
        questionPrefix: 'Question',
        correctAnswer: 'Correct answer',
        difficulty: 'Difficulty',
        questionPlaceholder: 'Question...',
        optionPlaceholder: 'Option {key}',
        levels: ['Easy', 'Medium', 'Hard'],
      },
    },
  }),
}));

vi.mock('../../lib/classes/sortClasses', () => ({
  sortClassesByTeacherThenName: (classes: any[]) => classes,
  formatClassNameWithTeacher: (cls: any) => cls.name,
}));

function baseProps(overrides = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    editingAssignment: null,
    formData: {
      title: '',
      description: '',
      dueDate: '',
      classId: '',
      type: 'essay' as const,
      questions: [],
      attemptsAllowed: 1,
      proctoringMode: 'strict' as const,
    },
    setFormData: vi.fn(),
    classes: [{ id: 'class-1', name: 'Class 1' }] as any,
    teachers: [],
    onSubmit: vi.fn((event) => event.preventDefault()),
    isSaving: false,
    jsonInput: '',
    setJsonInput: vi.fn(),
    onImportJson: vi.fn(),
    onAddQuestion: vi.fn(),
    onUpdateQuestion: vi.fn(),
    onRemoveQuestion: vi.fn(),
    ...overrides,
  };
}

describe('AssignmentModal proctoring mode', () => {
  it('renders strict mode selected by default', () => {
    render(<AssignmentModal {...baseProps()} />);

    expect(screen.getByRole('button', { name: /Strict mode/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: /Normal mode/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('selecting normal mode updates form data', () => {
    const props = baseProps();
    render(<AssignmentModal {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /Normal mode/i }));

    expect(props.setFormData).toHaveBeenCalledWith({
      ...props.formData,
      proctoringMode: 'normal',
    });
  });
});
