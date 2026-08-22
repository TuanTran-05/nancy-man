// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { SafeStudent } from '../../types';
import type { StudentAdminReportResponse } from '../api/studentAdminReportApi';
import { ApiError } from '../api/apiClient';
import { useStudentProfileData } from './useStudentProfileData';
import { fetchStudentAdminReport } from '../api/studentAdminReportApi';
import { readClassesData, readOfficeAcademicReferences } from '../api/frontendReadApi';
import { getStudentDirectory } from '../api/studentDirectoryApi';

vi.mock('../api/studentAdminReportApi', () => ({
  fetchStudentAdminReport: vi.fn(),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'teacher-1' } },
  db: {},
}));

vi.mock('../api/frontendReadApi', () => ({
  readClassesData: vi.fn(),
  readOfficeAcademicReferences: vi.fn(),
}));

vi.mock('../api/studentDirectoryApi', () => ({
  getStudentDirectory: vi.fn(),
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const baseStudent: SafeStudent = {
  id: 'student-1',
  name: 'Seed Name',
  studentId: 'HS001',
  dob: '2012-08-06',
  contact: '0345647924',
  classId: 'class-1',
  teacherId: 'teacher-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  code: 'AT01',
  gender: 'female',
  enrollmentStatus: 'active',
  studentLifecycle: 'enrolled',
  enrollmentDate: '2026-02-03T04:05:06.000Z',
};

function reportFor(student: Partial<SafeStudent> = {}): StudentAdminReportResponse {
  return {
    student: { ...baseStudent, ...student },
    timeline: [],
    attendanceRows: [],
    sessionValueByTerm: {},
    ledgers: [],
    receipts: [],
    truncation: { attendance: false, ledgers: false, classSessions: false },
    generatedAt: '2026-07-18T00:00:00.000Z',
  };
}

function mockSupportData() {
  const classes = [
    {
      id: 'class-1',
      name: 'Advanced 9',
      teacherId: 'teacher-1',
      schedule: '',
      daysOfWeek: [],
      description: '',
      startDate: '2026-01-01',
      endDate: '',
      startTime: '',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  vi.mocked(readClassesData).mockResolvedValue({ classes } as any);
  vi.mocked(readOfficeAcademicReferences).mockResolvedValue({
    classes: classes as any,
    teachers: [
      {
        uid: 'teacher-1',
        displayName: 'Mrs. Huong',
        role: 'teacher',
        email: 'teacher@example.com',
      },
    ],
  });
}

describe('useStudentProfileData', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(readClassesData).mockResolvedValue({ classes: [] });
    vi.mocked(readOfficeAcademicReferences).mockResolvedValue({ classes: [], teachers: [] });
    vi.mocked(getStudentDirectory).mockResolvedValue({ students: [] } as any);
  });

  it('renders a matching seed first, then lets the authoritative report win', async () => {
    const pending = deferred<StudentAdminReportResponse>();
    vi.mocked(fetchStudentAdminReport).mockReturnValue(pending.promise);
    const wrapper = createWrapper(queryClient);

    const { result } = renderHook(
      () =>
        useStudentProfileData({
          studentId: 'student-1',
          role: 'teacher',
          seedStudent: baseStudent,
        }),
      { wrapper }
    );

    expect(result.current.student?.name).toBe('Seed Name');

    await act(async () => {
      pending.resolve(reportFor({ name: 'Report Name' }));
      await pending.promise;
    });

    await waitFor(() => expect(result.current.student?.name).toBe('Report Name'));
    expect(result.current.report?.student).toMatchObject({ name: 'Report Name' });
  });

  it('ignores a mismatched seed student and parent seed', async () => {
    vi.mocked(fetchStudentAdminReport).mockResolvedValue(reportFor({ id: 'student-1' }));
    const wrapper = createWrapper(queryClient);

    const { result } = renderHook(
      () =>
        useStudentProfileData({
          studentId: 'student-1',
          role: 'teacher',
          seedStudent: { ...baseStudent, id: 'student-2' },
          seedParentLogin: { updatedAt: '2026-07-18T01:02:03.000Z' },
        }),
      { wrapper }
    );

    expect(result.current.student).toBeNull();
    expect(result.current.parentLoginInfo).toBeUndefined();
    await waitFor(() => expect(result.current.student?.id).toBe('student-1'));
  });

  it('keeps the latest overlapping request result when reload resolves before the initial request', async () => {
    const first = deferred<StudentAdminReportResponse>();
    const second = deferred<StudentAdminReportResponse>();
    vi.mocked(fetchStudentAdminReport)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const wrapper = createWrapper(queryClient);

    const { result } = renderHook(
      () =>
        useStudentProfileData({
          studentId: 'student-1',
          role: 'teacher',
          seedStudent: baseStudent,
        }),
      { wrapper }
    );

    await act(async () => {
      void result.current.reload();
    });

    await act(async () => {
      second.resolve(reportFor({ name: 'Second Result' }));
      await second.promise;
    });
    await act(async () => {
      first.resolve(reportFor({ name: 'First Result' }));
      await first.promise;
    });

    await waitFor(() => expect(result.current.student?.name).toBe('Second Result'));
  });

  it('distinguishes 404 not-found errors from other API errors', async () => {
    vi.mocked(fetchStudentAdminReport).mockRejectedValueOnce(new ApiError('missing', 404, null));
    const wrapper = createWrapper(queryClient);

    const { result, rerender } = renderHook(
      ({ studentId }) => useStudentProfileData({ studentId, role: 'teacher' }),
      { initialProps: { studentId: 'missing-student' }, wrapper }
    );

    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.error).toBeNull();

    vi.mocked(fetchStudentAdminReport).mockRejectedValueOnce(
      new ApiError('server down', 500, null)
    );
    rerender({ studentId: 'error-student' });

    await waitFor(() => expect(result.current.error).toBe('server down'));
    expect(result.current.notFound).toBe(false);
  });

  it('preserves parent-login tri-state and only loads support data for admin or office', async () => {
    vi.mocked(fetchStudentAdminReport).mockResolvedValue(reportFor());
    const wrapper = createWrapper(queryClient);

    const { result, rerender } = renderHook(
      ({ role, seedParentLogin }) =>
        useStudentProfileData({
          studentId: 'student-1',
          role,
          seedStudent: baseStudent,
          seedParentLogin,
        }),
      { initialProps: { role: 'accounting', seedParentLogin: undefined as any }, wrapper }
    );

    expect(result.current.parentLoginInfo).toBeUndefined();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(readClassesData).not.toHaveBeenCalled();
    expect(readOfficeAcademicReferences).not.toHaveBeenCalled();

    rerender({ role: 'accounting', seedParentLogin: null });
    expect(result.current.parentLoginInfo).toBeNull();

    rerender({
      role: 'accounting',
      seedParentLogin: { updatedAt: '2026-07-18T01:02:03.000Z' },
    });
    expect(result.current.parentLoginInfo).toEqual({ updatedAt: '2026-07-18T01:02:03.000Z' });

    mockSupportData();
    rerender({
      role: 'admin',
      seedParentLogin: { updatedAt: '2026-07-18T01:02:03.000Z' },
    });

    await waitFor(() => expect(result.current.classes[0]?.id).toBe('class-1'));
    expect(readClassesData).toHaveBeenCalledTimes(1);
    expect(readOfficeAcademicReferences).toHaveBeenCalledTimes(1);
    // Admin reads references through the shared cached query, whose rows carry
    // the extra reference fields; the consumed contract is uid + displayName.
    expect(result.current.teachers[0]).toMatchObject({
      uid: 'teacher-1',
      displayName: 'Mrs. Huong',
    });
  });

  it('resets stale route data on studentId change and ignores late responses from the previous route', async () => {
    const first = deferred<StudentAdminReportResponse>();
    const second = deferred<StudentAdminReportResponse>();
    vi.mocked(fetchStudentAdminReport)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const wrapper = createWrapper(queryClient);

    const { result, rerender } = renderHook(
      ({ studentId, seedStudent }) =>
        useStudentProfileData({ studentId, role: 'teacher', seedStudent }),
      { initialProps: { studentId: 'student-1', seedStudent: baseStudent }, wrapper }
    );

    expect(result.current.student?.id).toBe('student-1');

    rerender({ studentId: 'student-2', seedStudent: null });
    expect(result.current.student).toBeNull();
    expect(result.current.report).toBeNull();

    await act(async () => {
      first.resolve(reportFor({ id: 'student-1', name: 'Old Route' }));
      second.resolve(reportFor({ id: 'student-2', name: 'New Route' }));
      await Promise.all([first.promise, second.promise]);
    });

    await waitFor(() => expect(result.current.student?.name).toBe('New Route'));
    expect(result.current.student?.id).toBe('student-2');
  });

  it('office role reuses cached report without extra network reads on remount', async () => {
    vi.mocked(fetchStudentAdminReport).mockResolvedValue(
      reportFor({ id: 'student-1', name: 'Office Student' })
    );
    const wrapper = createWrapper(queryClient);

    const { result, unmount } = renderHook(
      () => useStudentProfileData({ studentId: 'student-1', role: 'office' }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.student?.name).toBe('Office Student');
    expect(fetchStudentAdminReport).toHaveBeenCalledTimes(1);

    unmount();

    const remount = renderHook(
      () => useStudentProfileData({ studentId: 'student-1', role: 'office' }),
      { wrapper }
    );

    await waitFor(() => expect(remount.result.current.loading).toBe(false));
    expect(remount.result.current.student?.name).toBe('Office Student');
    expect(fetchStudentAdminReport).toHaveBeenCalledTimes(1);
  });

  it('admin role reuses cached report without extra network reads on remount', async () => {
    vi.mocked(fetchStudentAdminReport).mockResolvedValue(
      reportFor({ id: 'student-1', name: 'Admin Student' })
    );
    mockSupportData();
    const wrapper = createWrapper(queryClient);

    const { result, unmount } = renderHook(
      () => useStudentProfileData({ studentId: 'student-1', role: 'admin' }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.student?.name).toBe('Admin Student');
    expect(fetchStudentAdminReport).toHaveBeenCalledTimes(1);

    unmount();

    const remount = renderHook(
      () => useStudentProfileData({ studentId: 'student-1', role: 'admin' }),
      { wrapper }
    );

    await waitFor(() => expect(remount.result.current.loading).toBe(false));
    expect(remount.result.current.student?.name).toBe('Admin Student');
    expect(fetchStudentAdminReport).toHaveBeenCalledTimes(1);
  });

  it('keeps teacher profiles on the direct read path', async () => {
    vi.mocked(fetchStudentAdminReport).mockResolvedValue(
      reportFor({ id: 'student-1', name: 'Teacher View' })
    );
    const wrapper = createWrapper(queryClient);

    const { result, unmount } = renderHook(
      () => useStudentProfileData({ studentId: 'student-1', role: 'teacher' }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();

    const remount = renderHook(
      () => useStudentProfileData({ studentId: 'student-1', role: 'teacher' }),
      { wrapper }
    );
    await waitFor(() => expect(remount.result.current.loading).toBe(false));

    expect(fetchStudentAdminReport).toHaveBeenCalledTimes(2);
  });
});
