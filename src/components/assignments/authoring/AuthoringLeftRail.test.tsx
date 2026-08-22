// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialWorkbenchState } from './authoringState';
import { AuthoringLeftRail } from './AuthoringLeftRail';

describe('AuthoringLeftRail', () => {
  it('shows sections/questions and duplicate action', () => {
    const state = createInitialWorkbenchState('teacher-1');
    const dispatch = vi.fn();
    render(<AuthoringLeftRail state={state} dispatch={dispatch} />);

    expect(screen.getByText('Listening')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/i }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'duplicate_question',
      questionId: state.selectedQuestionId,
    });
  });

  it('dispatches multi-select, add section, add question, and delete selected actions', () => {
    const state = createInitialWorkbenchState('teacher-1');
    const dispatch = vi.fn();
    render(<AuthoringLeftRail state={state} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'add_section',
      title: 'New section',
      skill: 'mixed',
      instructions: '',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'add_question',
      sectionId: state.selectedSectionId,
    });

    fireEvent.click(screen.getByLabelText(`Select question ${state.selectedQuestionId}`));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'select_question',
      questionId: state.selectedQuestionId,
      multi: true,
    });
  });
});
