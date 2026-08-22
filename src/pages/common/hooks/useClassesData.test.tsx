// @vitest-environment jsdom
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { useClassesData } from './useClassesData';
import { getStudentDirectory } from '../../../lib/api/studentDirectoryApi';
import { apiRequest } from '../../../lib/api/apiClient';
import {
  readCalendarReferences,
  readClassesData,
  readOfficeTeacherReferences,
} from '../../../lib/api/frontendReadApi';
import { readChannel } from '../../../lib/api/readApi';
import { buildClassStudentCounts } from '../../../lib/student/classStudentCounts';
import { officeQueryKeys } from '../../../lib/office/officeQueryKeys';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/api/apiClient', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../../lib/api/studentDirectoryApi', () => ({
  getStudentDirectory: vi.fn(),
}));

vi.mock('../../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'teacher-1' } },
}));

vi.mock('../../../lib/api/frontendReadApi', () => ({
  FRONTEND_READ_POLL_INTERVAL_MS: 15_000,
  readCalendarReferences: vi.fn(),
  readClassesData: vi.fn(),
  readOfficeTeacherReferences: vi.fn(),
}));

vi.mock('../../../lib/api/readApi', () => ({
  readChannel: vi.fn(),
}));

const OFFICE_PROFILE = { uid: 'office-1', role: 'office' };
const TEACHER_PROFILE = { uid: 'teacher-1', role: 'teacher' };

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockStudents = [
  { id: 's1', name: 'Student 1', currentClassId: 'c1', status: 'enrolled' },
  { id: 's2', name: 'Student 2', currentClassId: 'c1', status: 'trial' },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useClassesData', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockResolvedValue({ success: true });
    vi.mocked(getStudentDirectory).mockResolvedValue({
      students: mockStudents as any,
      meta: {} as any,
      page: {} as any,
    });
    const classes = [{ id: 'c1', name: 'Class 1', status: 'active', grade: 6 }];
    vi.mocked(readClassesData).mockResolvedValue({ classes } as any);
    vi.mocked(readOfficeTeacherReferences).mockResolvedValue({
      classes: classes as any,
      teachers: [
        {
          uid: 't1',
          displayName: 'Teacher 1',
          email: 't1@test.com',
          blockedTeacher: false,
        },
      ],
    } as any);
    vi.mocked(readCalendarReferences).mockResolvedValue({
      classes: [],
      attendance: [],
      attendanceCounts: {},
      systemHolidays: ['2026-01-01'],
    });
    vi.mocked(readChannel).mockResolvedValue({ requests: [], classes: [] });
  });

  it('office remount reuses classes, teachers, holidays, and student index without new reads', async () => {
    const wrapper = createWrapper(queryClient);

    const { result, unmount } = renderHook(() => useClassesData(OFFICE_PROFILE), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.classes).toHaveLength(1);
    expect(result.current.teachers).toHaveLength(1);
    expect(result.current.systemHolidays).toEqual(['2026-01-01']);
    expect(result.current.studentCounts['c1']).toEqual(
      buildClassStudentCounts(mockStudents as any)['c1']
    );

    expect(readClassesData).toHaveBeenCalledTimes(1);
    expect(readOfficeTeacherReferences).toHaveBeenCalledTimes(1);
    expect(readCalendarReferences).toHaveBeenCalledTimes(1);
    expect(getStudentDirectory).toHaveBeenCalledTimes(1); // student index

    unmount();

    const { result: remountResult } = renderHook(() => useClassesData(OFFICE_PROFILE), { wrapper });
    expect(remountResult.current.loading).toBe(false);
    expect(remountResult.current.classes).toHaveLength(1);

    // Zero new reads
    expect(readClassesData).toHaveBeenCalledTimes(1);
    expect(readOfficeTeacherReferences).toHaveBeenCalledTimes(1);
    expect(readCalendarReferences).toHaveBeenCalledTimes(1);
    expect(getStudentDirectory).toHaveBeenCalledTimes(1);
  });

  it('shows classes as soon as the primary query resolves while details keep loading', async () => {
    const teachers = deferred<any>();
    const holidays = deferred<any>();
    const students = deferred<any>();
    vi.mocked(readOfficeTeacherReferences).mockReturnValue(teachers.promise);
    vi.mocked(readCalendarReferences).mockReturnValue(holidays.promise);
    vi.mocked(getStudentDirectory).mockReturnValue(students.promise);

    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useClassesData(OFFICE_PROFILE), { wrapper });

    await waitFor(() => expect(result.current.classes).toHaveLength(1));
    expect(result.current.loading).toBe(false);
    expect(result.current.loadingDetails).toBe(true);
    expect(result.current.teacherReferencesLoading).toBe(true);

    await act(async () => {
      teachers.resolve({ teachers: [] });
      holidays.resolve({ systemHolidays: [] });
      students.resolve({ students: [], meta: {}, page: {} });
    });

    await waitFor(() => expect(result.current.loadingDetails).toBe(false));
  });

  it('computes identical student counts to pre-migration baseline', async () => {
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useClassesData(OFFICE_PROFILE), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const expected = buildClassStudentCounts(mockStudents as any);
    expect(result.current.studentCounts).toEqual(expected);
  });

  it('teacher role loads session-scoped HTTP references without using the office cache branch', async () => {
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useClassesData(TEACHER_PROFILE), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(readClassesData).toHaveBeenCalledTimes(1);
    expect(readCalendarReferences).toHaveBeenCalledTimes(1);
    expect(readChannel).toHaveBeenCalledWith(
      'substitute-requests',
      expect.objectContaining({ status: 'accepted' })
    );
  });

  it('quick status change updates cache optimistically and rolls back on failure', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Status update failed'));
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useClassesData(OFFICE_PROFILE), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    const cls = result.current.classes[0];
    await act(async () => {
      await result.current.handleQuickStatusChange(cls, 'paused', {
        changedStatus: 'Changed status to ',
        filterActive: 'active',
        filterPaused: 'paused',
        filterArchived: 'archived',
        permissionError: 'Permission error',
      });
    });

    // Rolled back to active
    const classes = queryClient.getQueryData<any[]>(officeQueryKeys.classList(OFFICE_PROFILE));
    expect(classes?.[0]?.status).toBe('active');
  });

  it('delete class updates cache optimistically and rolls back on rejection', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Delete failed'));
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useClassesData(OFFICE_PROFILE), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const ok = await result.current.handleDelete('c1', 'Success', 'Error');
      expect(ok).toBe(false);
    });

    // Restored in cache
    const classes = queryClient.getQueryData<any[]>(officeQueryKeys.classList(OFFICE_PROFILE));
    expect(classes).toHaveLength(1);
  });
});
