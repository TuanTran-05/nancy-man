// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { studentProfileReportQueryOptions } from './studentProfileQueries';
import { fetchStudentAdminReport } from '../api/studentAdminReportApi';

vi.mock('../api/studentAdminReportApi', () => ({
  fetchStudentAdminReport: vi.fn(),
}));

const OFFICE = { uid: 'office-1', role: 'office' };
const ADMIN = { uid: 'admin-1', role: 'admin' };

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('studentProfileQueries', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  it('caches student profile report and reuses on remount without extra network reads', async () => {
    vi.mocked(fetchStudentAdminReport).mockResolvedValue({
      student: { id: 's1', name: 'Student 1' } as any,
    } as any);

    const wrapper = createWrapper(queryClient);
    const { result, unmount } = renderHook(
      () => useQuery(studentProfileReportQueryOptions(OFFICE, 's1', true)),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.student.name).toBe('Student 1');
    expect(fetchStudentAdminReport).toHaveBeenCalledTimes(1);

    unmount();

    const remount = renderHook(
      () => useQuery(studentProfileReportQueryOptions(OFFICE, 's1', true)),
      { wrapper }
    );

    await waitFor(() => expect(remount.result.current.isSuccess).toBe(true));
    expect(remount.result.current.data?.student.name).toBe('Student 1');
    expect(fetchStudentAdminReport).toHaveBeenCalledTimes(1);
  });

  it('isolates cache between different studentIds and roles', async () => {
    vi.mocked(fetchStudentAdminReport)
      .mockResolvedValueOnce({ student: { id: 's1', name: 'S1' } } as any)
      .mockResolvedValueOnce({ student: { id: 's2', name: 'S2' } } as any)
      .mockResolvedValueOnce({ student: { id: 's1', name: 'S1' } } as any);

    const wrapper = createWrapper(queryClient);

    const q1 = renderHook(() => useQuery(studentProfileReportQueryOptions(OFFICE, 's1', true)), {
      wrapper,
    });
    const q2 = renderHook(() => useQuery(studentProfileReportQueryOptions(OFFICE, 's2', true)), {
      wrapper,
    });
    const q3 = renderHook(() => useQuery(studentProfileReportQueryOptions(ADMIN, 's1', true)), {
      wrapper,
    });

    await waitFor(() => {
      expect(q1.result.current.isSuccess).toBe(true);
      expect(q2.result.current.isSuccess).toBe(true);
      expect(q3.result.current.isSuccess).toBe(true);
    });

    expect(fetchStudentAdminReport).toHaveBeenCalledTimes(3);
  });
});
