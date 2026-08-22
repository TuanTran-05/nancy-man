// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { listPendingStudents, readRecentAdmissions } from './admissionsApi';
import {
  admissionsHistoryPageQueryOptions,
  admissionsPendingQueryOptions,
} from './admissionsQueries';

vi.mock('./admissionsApi', () => ({
  listPendingStudents: vi.fn(),
  readRecentAdmissions: vi.fn(),
}));

const OFFICE = { uid: 'office-1', role: 'office' };
const ADMIN = { uid: 'admin-1', role: 'admin' };

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('admissionsQueries', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(listPendingStudents).mockReset();
    vi.mocked(readRecentAdmissions).mockReset();
  });

  it('separates history pages by cursor and reuses cache on remount', async () => {
    vi.mocked(readRecentAdmissions)
      .mockResolvedValueOnce({
        admissions: [{ id: 'adm-1', studentName: 'Student 1' } as any],
        page: { limit: 10, nextCursor: 'cursor-2', hasMore: true },
      })
      .mockResolvedValueOnce({
        admissions: [{ id: 'adm-2', studentName: 'Student 2' } as any],
        page: { limit: 10, nextCursor: null, hasMore: false },
      });

    const wrapper = createWrapper(queryClient);

    const first = renderHook(
      () => useQuery(admissionsHistoryPageQueryOptions(OFFICE, 10, null, true)),
      { wrapper }
    );
    const second = renderHook(
      () => useQuery(admissionsHistoryPageQueryOptions(OFFICE, 10, 'cursor-2', true)),
      { wrapper }
    );

    await waitFor(() => {
      expect(first.result.current.isSuccess).toBe(true);
      expect(second.result.current.isSuccess).toBe(true);
    });

    expect(readRecentAdmissions).toHaveBeenNthCalledWith(1, 10, undefined);
    expect(readRecentAdmissions).toHaveBeenNthCalledWith(2, 10, 'cursor-2');

    // Remount first page
    first.unmount();
    const remount = renderHook(
      () => useQuery(admissionsHistoryPageQueryOptions(OFFICE, 10, null, true)),
      { wrapper }
    );
    await waitFor(() => expect(remount.result.current.isSuccess).toBe(true));
    expect(readRecentAdmissions).toHaveBeenCalledTimes(2);
  });

  it('reuses pending students query on remount', async () => {
    vi.mocked(listPendingStudents).mockResolvedValueOnce({
      students: [{ id: 'p1', name: 'Pending 1' } as any],
    });

    const wrapper = createWrapper(queryClient);
    const { result, unmount } = renderHook(
      () => useQuery(admissionsPendingQueryOptions(OFFICE, true)),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'p1', name: 'Pending 1' }]);
    expect(listPendingStudents).toHaveBeenCalledTimes(1);

    unmount();
    const remount = renderHook(() => useQuery(admissionsPendingQueryOptions(OFFICE, true)), {
      wrapper,
    });
    await waitFor(() => expect(remount.result.current.isSuccess).toBe(true));
    expect(listPendingStudents).toHaveBeenCalledTimes(1);
  });

  it('isolates cache between office and admin', async () => {
    vi.mocked(listPendingStudents)
      .mockResolvedValueOnce({
        students: [{ id: 'p1', name: 'Pending 1' } as any],
      })
      .mockResolvedValueOnce({
        students: [{ id: 'p1', name: 'Pending 1' } as any],
      });

    const wrapper = createWrapper(queryClient);
    const r1 = renderHook(() => useQuery(admissionsPendingQueryOptions(OFFICE, true)), {
      wrapper,
    });
    await waitFor(() => expect(r1.result.current.isSuccess).toBe(true));

    const r2 = renderHook(() => useQuery(admissionsPendingQueryOptions(ADMIN, true)), {
      wrapper,
    });
    await waitFor(() => expect(r2.result.current.isSuccess).toBe(true));

    expect(listPendingStudents).toHaveBeenCalledTimes(2);
  });
});
