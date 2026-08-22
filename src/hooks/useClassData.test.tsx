// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readChannel } from '../lib/api/readApi';
import {
  readAssignmentsData,
  readCalendarReferences,
  readClassDetailData,
} from '../lib/api/frontendReadApi';
import {
  canReadClassTeachingData,
  getClassDetailStudentScope,
  useClassData,
} from './useClassData';

vi.mock('../lib/api/readApi', () => ({ readChannel: vi.fn() }));
vi.mock('../lib/api/frontendReadApi', () => ({
  FRONTEND_READ_POLL_INTERVAL_MS: 15_000,
  readAssignmentsData: vi.fn(),
  readCalendarReferences: vi.fn(),
  readClassDetailData: vi.fn(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useClassData HTTP integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readClassDetailData).mockResolvedValue({
      class: { id: 'class-1', name: 'Class One' },
      evaluations: [
        { id: 'evaluation-own', teacherId: 'teacher-1' },
        { id: 'evaluation-other', teacherId: 'teacher-2' },
      ],
      sessions: [{ id: 'session-1' }],
      reports: [
        { id: 'report-own', teacherId: 'teacher-1' },
        { id: 'report-other', teacherId: 'teacher-2' },
      ],
    } as any);
    vi.mocked(readAssignmentsData).mockResolvedValue({
      assignments: [{ id: 'assignment-1', classId: 'class-1' }],
      submissions: [{ id: 'submission-1', classId: 'class-1' }],
    } as any);
    vi.mocked(readCalendarReferences).mockResolvedValue({ systemHolidays: ['2026-09-02'] } as any);
    vi.mocked(readChannel).mockResolvedValue({ students: [{ id: 'student-1' }] } as any);
  });

  it('keeps role scoping explicit', () => {
    expect(getClassDetailStudentScope('class-1', { role: 'office' } as any, 'office-1')).toEqual({
      classId: 'class-1',
    });
    expect(getClassDetailStudentScope('class-1', { role: 'teacher' } as any, 'teacher-1')).toEqual({
      classId: 'class-1',
      teacherId: 'teacher-1',
    });
    expect(canReadClassTeachingData({ role: 'student' } as any, true)).toBe(true);
  });

  it('loads class data and filters teacher-owned rows', async () => {
    const { result } = renderHook(
      () => useClassData('class-1', { uid: 'teacher-1', role: 'teacher' } as any),
      { wrapper }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.classData?.id).toBe('class-1'));
    expect(result.current.students).toEqual([{ id: 'student-1' }]);
    expect(result.current.evaluations).toEqual([
      { id: 'evaluation-own', teacherId: 'teacher-1' },
    ]);
    expect(result.current.dailyReports).toEqual([{ id: 'report-own', teacherId: 'teacher-1' }]);
    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.holidays).toEqual(['2026-09-02']);
  });

  it('requests a term-scoped roster refresh for attendance', async () => {
    const { result } = renderHook(
      () => useClassData('class-1', { uid: 'office-1', role: 'office' } as any),
      { wrapper }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(readChannel).mockClear();

    await act(async () => {
      await result.current.refreshAttendanceStudents({ attendanceTermStart: '2026-08-01' });
    });
    expect(readChannel).toHaveBeenCalledWith('class-detail', {
      view: 'roster',
      classId: 'class-1',
      attendanceTermStart: '2026-08-01',
    });
  });
});
