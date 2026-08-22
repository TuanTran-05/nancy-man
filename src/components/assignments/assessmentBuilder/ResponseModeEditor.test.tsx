// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResponseModeEditor } from './ResponseModeEditor';
import type { AssessmentQuestionInput } from '../../../../shared/assignmentAssessment';

const question: AssessmentQuestionInput = {
  id: 'q1',
  skill: 'listening',
  prompt: 'Question',
  media: [],
  responseMode: 'multiple_choice',
  options: [
    { key: 'A', text: 'First option' },
    { key: 'B', text: 'Second option' },
  ],
  correctAnswer: 'A',
  gradingMode: 'auto',
};

describe('ResponseModeEditor', () => {
  it('updates multiple-choice options and correct answer', () => {
    const onChange = vi.fn();
    render(<ResponseModeEditor question={question} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'Updated A' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { key: 'A', text: 'Updated A' },
          { key: 'B', text: 'Second option' },
        ],
      })
    );

    fireEvent.change(screen.getByLabelText('Correct answer'), { target: { value: 'B' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ correctAnswer: 'B' }));
  });

  it('switches to short answer with manual grading defaults', () => {
    const onChange = vi.fn();
    render(<ResponseModeEditor question={question} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Response mode'), { target: { value: 'short_answer' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseMode: 'short_answer',
        options: undefined,
        correctAnswer: undefined,
        acceptedAnswers: [],
        gradingMode: 'manual',
      })
    );
  });

  it('switches a question to speaking recording with manual grading', () => {
    const onChange = vi.fn();
    render(<ResponseModeEditor question={question} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Response mode'), {
      target: { value: 'speaking_recording' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseMode: 'speaking_recording',
        options: undefined,
        correctAnswer: undefined,
        acceptedAnswers: undefined,
        gradingMode: 'manual',
      })
    );
  });

  it('does not show accepted-answer inputs for speaking recording questions', () => {
    render(
      <ResponseModeEditor
        question={{
          ...question,
          responseMode: 'speaking_recording',
          options: undefined,
          correctAnswer: undefined,
          acceptedAnswers: undefined,
          gradingMode: 'manual',
        }}
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('Accepted answers')).not.toBeInTheDocument();
  });

  it('keeps all advanced response modes available in the selector', () => {
    render(<ResponseModeEditor question={question} onChange={vi.fn()} />);

    expect(screen.getByRole('option', { name: 'Multiple choice' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Short answer' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Speaking recording' })).toBeInTheDocument();
  });
});
