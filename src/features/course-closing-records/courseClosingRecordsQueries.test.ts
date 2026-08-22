// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../lib/api/apiClient.js';
import {
  courseClosingRecordFileQueryOptions,
  courseClosingRecordsQueryOptions,
  fetchCourseClosingRecordFile,
  useCourseClosingRecordMonthQuery,
  useCourseClosingRecordFileQuery,
  useCourseClosingRecordsQuery,
} from './courseClosingRecordsQueries.js';

vi.mock('../../lib/api/apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  current: { uid: 'admin-1', role: 'admin' },
}));

vi.mock('../../contexts/AuthContext.js', () => ({
  useAuth: () => ({ profile: { uid: authState.current.uid, role: authState.current.role } }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('courseClosingRecordsQueries', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    authState.current = { uid: 'admin-1', role: 'admin' };
  });

  it('fetches month through the path-style classes action', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ success: true, month: '2026-07' });

    renderHook(() => useCourseClosingRecordMonthQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/classes/course-closing-record-month')
    );
  });

  it('fetches records query correctly', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      success: true,
      month: '2026-07',
      records: [],
      truncated: false,
    });
    const { result } = renderHook(() => useCourseClosingRecordsQuery('2026-07', 'An'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toBeDefined();
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/api/v1/classes/course-closing-records?month=2026-07&q=An'
      )
    );
  });

  it('uses URLSearchParams to encode submitted search values', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      success: true,
      month: '2026-07',
      records: [],
      truncated: false,
    });

    renderHook(() => useCourseClosingRecordsQuery('2026-07', 'An & Bình'), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/api/v1/classes/course-closing-records?month=2026-07&q=An+%26+B%C3%ACnh'
      )
    );
  });

  it('normalizes the search value once, so padding cannot split the cache', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      success: true,
      month: '2026-07',
      records: [],
      truncated: false,
    });
    const wrapper = createWrapper();

    const padded = renderHook(() => useCourseClosingRecordsQuery('2026-07', '  An  '), {
      wrapper,
    });
    await waitFor(() => expect(padded.result.current.isSuccess).toBe(true));

    const trimmed = renderHook(() => useCourseClosingRecordsQuery('2026-07', 'An'), { wrapper });
    await waitFor(() => expect(trimmed.result.current.isSuccess).toBe(true));

    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.filter(([url]) => String(url).includes('course-closing-records'))
    ).toHaveLength(1);
  });

  it('requests an inline signed URL with encoded identifiers', async () => {
    const response = {
      success: true as const,
      url: 'https://storage.test/evaluation.docx?signature=inline',
      downloadFilename: 'Student_One_Evaluation.docx',
      expiresAt: '2026-07-27T10:10:00.000Z',
    };
    vi.mocked(apiRequest).mockResolvedValueOnce(response);

    const { result } = renderHook(
      () => useCourseClosingRecordFileQuery('course 1/student', 'evaluation'),
      {
        wrapper: createWrapper(),
      }
    );

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        '/api/v1/classes/course-closing-record-file?recordId=course+1%2Fstudent&documentType=evaluation&mode=inline'
      )
    );
    await waitFor(() => expect(result.current.data).toEqual(response));
  });

  it('requests a fresh attachment URL for download', async () => {
    const response = {
      success: true as const,
      url: 'https://storage.test/tuition.docx?signature=attachment',
      downloadFilename: 'Student_One_Tuition.docx',
      expiresAt: '2026-07-27T10:10:00.000Z',
    };
    vi.mocked(apiRequest).mockResolvedValueOnce(response);

    await expect(
      fetchCourseClosingRecordFile('course 1/student', 'tuition', 'attachment')
    ).resolves.toEqual(response);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/classes/course-closing-record-file?recordId=course+1%2Fstudent&documentType=tuition&mode=attachment'
    );
  });

  it('does not request an inline URL until both selection values exist', () => {
    renderHook(() => useCourseClosingRecordFileQuery(undefined, undefined), {
      wrapper: createWrapper(),
    });

    expect(apiRequest).not.toHaveBeenCalled();
  });

  // The server narrows this endpoint by role — accounting never sees
  // `not_requested` rows or evaluation documents — while `queryClient` is a
  // module-level singleton that survives sign-out, so a shared cache entry
  // would hand one role the other's projection.
  describe('identity scoping', () => {
    function sharedClientWrapper() {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      return ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);
    }

    it('refetches records for a second identity instead of reusing the first cache entry', async () => {
      const adminRecords = {
        success: true,
        month: '2026-07',
        records: [{ id: 'record-1', evaluationDocument: { status: 'ready' } }],
        truncated: false,
      };
      const accountingRecords = { success: true, month: '2026-07', records: [], truncated: false };
      vi.mocked(apiRequest)
        .mockResolvedValueOnce(adminRecords)
        .mockResolvedValueOnce(accountingRecords);
      const wrapper = sharedClientWrapper();

      const asAdmin = renderHook(() => useCourseClosingRecordsQuery('2026-07'), { wrapper });
      await waitFor(() => expect(asAdmin.result.current.data).toEqual(adminRecords));
      asAdmin.unmount();

      authState.current = { uid: 'accounting-1', role: 'accounting' };
      const asAccounting = renderHook(() => useCourseClosingRecordsQuery('2026-07'), { wrapper });

      await waitFor(() => expect(asAccounting.result.current.isSuccess).toBe(true));
      expect(asAccounting.result.current.data).toEqual(accountingRecords);
      expect(apiRequest).toHaveBeenCalledTimes(2);
    });

    it('refetches the default month for a second identity', async () => {
      vi.mocked(apiRequest)
        .mockResolvedValueOnce({ success: true, month: '2026-07' })
        .mockResolvedValueOnce({ success: true, month: '2026-06' });
      const wrapper = sharedClientWrapper();

      const asAdmin = renderHook(() => useCourseClosingRecordMonthQuery(), { wrapper });
      await waitFor(() => expect(asAdmin.result.current.isSuccess).toBe(true));
      asAdmin.unmount();

      authState.current = { uid: 'accounting-1', role: 'accounting' };
      const asAccounting = renderHook(() => useCourseClosingRecordMonthQuery(), { wrapper });

      await waitFor(() => expect(asAccounting.result.current.isSuccess).toBe(true));
      expect(asAccounting.result.current.data).toEqual({ success: true, month: '2026-06' });
      expect(apiRequest).toHaveBeenCalledTimes(2);
    });

    it('sets 15min stale/gc times for records and gcTime 0 for signed file URLs', () => {
      const recordsOpts = courseClosingRecordsQueryOptions(
        { uid: 'office-1', role: 'office' },
        '2026-08',
        'query'
      );
      expect(recordsOpts.staleTime).toBe(15 * 60_000);
      expect(recordsOpts.gcTime).toBe(15 * 60_000);

      const fileOpts = courseClosingRecordFileQueryOptions(
        { uid: 'office-1', role: 'office' },
        'rec-1',
        'evaluation'
      );
      expect(fileOpts.staleTime).toBe(5 * 60_000);
      expect(fileOpts.gcTime).toBe(0);
    });
  });
});
