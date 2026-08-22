// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionTypeToolbar } from './QuestionTypeToolbar';

describe('QuestionTypeToolbar', () => {
  it('renders all question type buttons', () => {
    render(
      <QuestionTypeToolbar
        onAddQuestion={vi.fn()}
        onOpenQuestionBank={vi.fn()}
        onAddSection={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /Multiple choice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add section/i })).toBeInTheDocument();
  });
});
