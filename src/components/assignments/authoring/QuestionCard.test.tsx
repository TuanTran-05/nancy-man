// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AssessmentQuestionInput } from '../../../../shared/assignmentAssessment';
import { QuestionCard } from './QuestionCard';

const question: AssessmentQuestionInput = {
  id: 'question-1',
  skill: 'reading',
  prompt: 'Choose the correct sentence.',
  responseMode: 'multiple_choice',
  media: [],
  options: [
    { key: 'A', text: 'I am going to study.' },
    { key: 'B', text: 'I going study.' },
  ],
  correctAnswer: 'A',
  points: 1,
  gradingMode: 'auto',
};

describe('QuestionCard', () => {
  it('edits prompt, option text, correct answer, and points', () => {
    const onChange = vi.fn();
    render(
      <QuestionCard
        sectionId="section-1"
        question={question}
        index={0}
        selected
        onSelect={vi.fn()}
        onChange={onChange}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onSaveToBank={vi.fn()}
        onOpenMediaPicker={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Question 1 prompt'), {
      target: { value: 'Updated prompt' },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Updated prompt' }));

    fireEvent.change(screen.getByLabelText('Option B'), {
      target: { value: 'Updated option' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { key: 'A', text: 'I am going to study.' },
          { key: 'B', text: 'Updated option' },
        ],
      })
    );

    fireEvent.change(screen.getByLabelText('Points for question 1'), {
      target: { value: '3' },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ points: 3 }));
  });

  it('exposes media, bank, duplicate, delete, and move actions', () => {
    const onOpenMediaPicker = vi.fn();
    const onSaveToBank = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    render(
      <QuestionCard
        sectionId="section-1"
        question={question}
        index={0}
        selected
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onSaveToBank={onSaveToBank}
        onOpenMediaPicker={onOpenMediaPicker}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add image to question 1' }));
    expect(onOpenMediaPicker).toHaveBeenCalledWith('question', 'image');
    fireEvent.click(screen.getByRole('button', { name: 'Add audio to question 1' }));
    expect(onOpenMediaPicker).toHaveBeenCalledWith('question', 'audio');
    fireEvent.click(screen.getByRole('button', { name: 'Add video to question 1' }));
    expect(onOpenMediaPicker).toHaveBeenCalledWith('question', 'video');
    fireEvent.click(screen.getByRole('button', { name: 'Save question 1 to question bank' }));
    expect(onSaveToBank).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate question 1' }));
    expect(onDuplicate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete question 1' }));
    expect(onDelete).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Move question 1 up' }));
    expect(onMoveUp).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Move question 1 down' }));
    expect(onMoveDown).toHaveBeenCalled();
  });

  it('shows draft-only copy for unsupported interaction types', () => {
    render(
      <QuestionCard
        sectionId="section-1"
        question={{ ...question, interactionType: 'matching', responseMode: 'short_answer' }}
        index={0}
        selected
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onSaveToBank={vi.fn()}
        onOpenMediaPicker={vi.fn()}
      />
    );
    expect(screen.getByText('Draft-only type')).toBeInTheDocument();
  });
});
