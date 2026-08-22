// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialWorkbenchState } from './authoringState';
import { QuestionCanvas } from './QuestionCanvas';

describe('QuestionCanvas', () => {
  it('renders title card, section card, and question cards', () => {
    const state = createInitialWorkbenchState('teacher-1');
    render(
      <QuestionCanvas
        state={state}
        dispatch={vi.fn()}
        onTitleChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onSaveQuestionToBank={vi.fn()}
        onOpenMediaPicker={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Assignment title on canvas')).toBeInTheDocument();
    expect(screen.getByLabelText('Section title Listening')).toBeInTheDocument();
    expect(screen.getByLabelText('Question 1 prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag section Listening' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag question 1' })).toBeInTheDocument();
  });

  it('dispatches add question from the canvas section action', () => {
    const state = createInitialWorkbenchState('teacher-1');
    const dispatch = vi.fn();
    render(
      <QuestionCanvas
        state={state}
        dispatch={dispatch}
        onTitleChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onSaveQuestionToBank={vi.fn()}
        onOpenMediaPicker={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add question to Listening' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'add_question',
      sectionId: state.selectedSectionId,
    });
  });
});
