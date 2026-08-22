// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BankReviewPanel } from './BankReviewPanel';
import {
  reviewQuestionBankItem,
  searchQuestionBank,
} from '../../../lib/api/assignmentAuthoringApi';

vi.mock('../../../lib/api/assignmentAuthoringApi', () => ({
  searchQuestionBank: vi.fn(),
  reviewQuestionBankItem: vi.fn(),
}));

describe('BankReviewPanel', () => {
  it('approves pending questions', async () => {
    vi.mocked(searchQuestionBank).mockResolvedValue({
      items: [{ id: 'bank-q1', prompt: 'Pending prompt', visibility: 'pending_review' }],
      nextCursor: null,
    });
    vi.mocked(reviewQuestionBankItem).mockResolvedValue(undefined);

    render(<BankReviewPanel />);

    expect(await screen.findByText('Pending prompt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));

    await waitFor(() =>
      expect(reviewQuestionBankItem).toHaveBeenCalledWith({ id: 'bank-q1', decision: 'approve' })
    );
  });
});
