// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAllStudentPages } from '../api/readApi';
import { studentRosterQueryOptions } from './studentDirectoryQueries';

vi.mock('../api/readApi', () => ({
  readAllStudentPages: vi.fn(),
  readChannel: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('student directory query policy', () => {
  it('refreshes an actively observed roster at 15 minutes, not before', async () => {
    vi.useFakeTimers();
    vi.mocked(readAllStudentPages).mockResolvedValue([]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const hook = renderHook(
      () => useQuery(studentRosterQueryOptions({ uid: 'admin-1', role: 'admin' }, true)),
      { wrapper }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readAllStudentPages).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60_000 + 59_999);
    });
    expect(readAllStudentPages).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(readAllStudentPages).toHaveBeenCalledTimes(2);

    hook.unmount();
    queryClient.clear();
  });
});
