// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionBankPanel } from './QuestionBankPanel';
import { searchQuestionBank } from '../../../lib/api/assignmentAuthoringApi';

vi.mock('../../../lib/api/assignmentAuthoringApi', () => ({
  searchQuestionBank: vi.fn(),
}));

describe('QuestionBankPanel', () => {
  it('loads reusable questions and inserts one', async () => {
    vi.mocked(searchQuestionBank).mockResolvedValue({
      items: [
        {
          id: 'bank-q1',
          prompt: 'Reusable prompt',
          skill: 'listening',
          responseMode: 'short_answer',
          media: [],
          points: 1,
          tags: [],
          ownerUid: 'teacher-1',
          visibility: 'private',
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z',
        },
      ] as any,
      nextCursor: null,
    });
    const onInsert = vi.fn();
    render(<QuestionBankPanel onInsert={onInsert} />);

    expect(await screen.findByText('Reusable prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Insert/i }));

    await waitFor(() =>
      expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'bank-q1' }))
    );
  });
});
