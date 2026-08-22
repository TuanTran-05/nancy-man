// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialWorkbenchState } from './authoringState';
import { AuthoringMainEditor } from './AuthoringMainEditor';

describe('AuthoringMainEditor', () => {
  it('dispatches update_section when editing section fields', () => {
    const state = createInitialWorkbenchState('teacher-1');
    const dispatch = vi.fn();
    render(<AuthoringMainEditor state={state} dispatch={dispatch} />);

    fireEvent.change(screen.getByLabelText('Section title'), {
      target: { value: 'Reading Part 1' },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'update_section',
      sectionId: state.selectedSectionId,
      section: expect.objectContaining({ title: 'Reading Part 1' }),
    });

    fireEvent.change(screen.getByLabelText('Section skill'), { target: { value: 'reading' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'update_section',
      sectionId: state.selectedSectionId,
      section: expect.objectContaining({ skill: 'reading' }),
    });

    fireEvent.change(screen.getByLabelText('Section instructions'), {
      target: { value: 'Read carefully.' },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'update_section',
      sectionId: state.selectedSectionId,
      section: expect.objectContaining({ instructions: 'Read carefully.' }),
    });
  });

  it('renders BulkQuestionActions when multiple questions are selected', () => {
    const initialState = createInitialWorkbenchState('teacher-1');
    const state = {
      ...initialState,
      selectedQuestionIds: ['q1', 'q2'],
    };
    const dispatch = vi.fn();
    render(<AuthoringMainEditor state={state} dispatch={dispatch} />);

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.queryByLabelText('Prompt')).not.toBeInTheDocument();
  });
});
