// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloatingInsertToolbar } from './FloatingInsertToolbar';

describe('FloatingInsertToolbar', () => {
  it('fires insert actions', () => {
    const onAddQuestion = vi.fn();
    const onAddSection = vi.fn();
    const onOpenQuestionBank = vi.fn();
    const onOpenMediaPicker = vi.fn();
    render(
      <FloatingInsertToolbar
        mode="floating"
        onAddQuestion={onAddQuestion}
        onAddSection={onAddSection}
        onOpenQuestionBank={onOpenQuestionBank}
        onOpenMediaPicker={onOpenMediaPicker}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    expect(onAddQuestion).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    expect(onAddSection).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Insert from question bank' }));
    expect(onOpenQuestionBank).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add image' }));
    expect(onOpenMediaPicker).toHaveBeenCalledWith('image');
  });
});
