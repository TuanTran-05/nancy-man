// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MediaBankPanel } from './MediaBankPanel';
import { searchMediaBank } from '../../../lib/api/assignmentAuthoringApi';

vi.mock('../../../lib/api/assignmentAuthoringApi', () => ({
  searchMediaBank: vi.fn(),
}));

describe('MediaBankPanel', () => {
  it('loads saved media and inserts one', async () => {
    vi.mocked(searchMediaBank).mockResolvedValue({
      items: [
        {
          id: 'media-1',
          ownerUid: 'teacher-1',
          visibility: 'private',
          type: 'audio',
          source: 'external_url',
          url: 'https://cdn.example.com/dialogue.mp3',
          title: 'Dialogue audio',
          tags: [],
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z',
        },
      ] as any,
      nextCursor: null,
    });
    const onInsert = vi.fn();

    render(<MediaBankPanel onInsert={onInsert} />);

    expect(await screen.findByText('Dialogue audio')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dialogue audio/i }));

    await waitFor(() =>
      expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'media-1' }))
    );
  });
});
