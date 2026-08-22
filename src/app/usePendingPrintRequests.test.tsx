// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../lib/api/readApi';
import { usePendingPrintRequests } from './usePendingPrintRequests';

vi.mock('../lib/api/readApi', () => ({ readChannel: vi.fn() }));

describe('usePendingPrintRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('polls only for office users and returns pending count', async () => {
    vi.mocked(readChannel).mockResolvedValue({
      requests: Array.from({ length: 7 }, (_, index) => ({ id: `request-${index}` })),
    } as any);

    const { result } = renderHook(() =>
      usePendingPrintRequests({ uid: 'office-1' }, { uid: 'office-1', role: 'office' } as any)
    );

    await waitFor(() => expect(result.current).toBe(7));
    expect(readChannel).toHaveBeenCalledWith('print-requests', { status: 'pending' });
  });

  it('does not poll for teachers', () => {
    renderHook(() =>
      usePendingPrintRequests({ uid: 'teacher-1' }, { uid: 'teacher-1', role: 'teacher' } as any)
    );

    expect(readChannel).not.toHaveBeenCalled();
  });
});
