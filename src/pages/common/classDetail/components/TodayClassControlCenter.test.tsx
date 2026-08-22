// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TodayClassControlCenter } from './TodayClassControlCenter';

vi.mock('../../../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../../../lib/i18n/translations');
  return {
    useLanguage: () => ({ language: 'en', t: translations.en }),
  };
});

const baseProps = {
  classData: {
    id: 'class-1',
    name: 'Class 1',
    startTime: '18:00',
  } as any,
  todayStr: '2026-06-06',
  todaySessionSummary: {
    date: '2026-06-06',
    pendingAttendanceCount: 2,
    absentCount: 1,
    lateCount: 0,
    overdueAssignmentStudentCount: 0,
    riskStudentCount: 0,
    completionState: 'pending_attendance',
  } as any,
  isPaused: false,
  isArchived: false,
  rosterSearchTerm: '',
  setRosterSearchTerm: vi.fn(),
  rosterFilter: 'all' as const,
  setRosterFilter: vi.fn(),
  setActiveTab: vi.fn(),
  setIsFaceModalOpen: vi.fn(),
  openDailyReportModal: vi.fn(),
  isTogglingAttendance: false,
  actionRosterStudents: [],
  todayAttendanceMap: new Map(),
  isAttendancePending: vi.fn(() => false),
  getPendingAttendanceStatus: vi.fn(),
  savingAbsencePermissionStudentId: null,
  riskByStudent: new Map(),
  evaluations: [],
  overdueAssignmentCountByStudent: new Map(),
  highlightMatch: (text: string) => text,
  handleTodayAttendanceStatus: vi.fn(),
  handleToggleAbsencePermission: vi.fn(),
  openTodayAttendanceDetail: vi.fn(),
  confirmingDeleteAttendanceId: null,
  setConfirmingDeleteAttendanceId: vi.fn(),
  deletingAttendanceRecordId: null,
  setDeletingAttendanceRecordId: vi.fn(),
};

describe('TodayClassControlCenter mark all present', () => {
  it('renders a bulk present action for the control center', () => {
    const handleMarkAllPresentForToday = vi.fn();

    render(
      <TodayClassControlCenter
        {...baseProps}
        todayAttendanceTargetStudents={[
          {
            id: 'unmarked-student',
            name: 'Unmarked Student',
            studentId: 'HS260101',
            enrollmentStatus: 'active',
          } as any,
          {
            id: 'absent-student',
            name: 'Absent Student',
            studentId: 'HS260102',
            enrollmentStatus: 'active',
          } as any,
          {
            id: 'present-student',
            name: 'Present Student',
            studentId: 'HS260103',
            enrollmentStatus: 'active',
          } as any,
        ]}
        todayAttendanceMap={
          new Map([
            [
              'absent-student',
              {
                id: 'attendance-absent',
                classId: 'class-1',
                studentId: 'absent-student',
                date: '2026-06-06',
                status: 'absent',
                teacherId: 'teacher-1',
                updatedAt: '2026-06-06T00:00:00.000Z',
              } as any,
            ],
            [
              'present-student',
              {
                id: 'attendance-present',
                classId: 'class-1',
                studentId: 'present-student',
                date: '2026-06-06',
                status: 'present',
                teacherId: 'teacher-1',
                updatedAt: '2026-06-06T00:00:00.000Z',
              } as any,
            ],
          ])
        }
        handleMarkAllPresentForToday={handleMarkAllPresentForToday}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /mark all present/i }));

    expect(handleMarkAllPresentForToday).toHaveBeenCalledWith([
      'unmarked-student',
      'absent-student',
    ]);
  });

  it('reports rejected bulk present requests to the error handler', async () => {
    const error = new Error('bulk failed');
    const handleMarkAllPresentForToday = vi.fn().mockRejectedValue(error);
    const onMarkAllPresentError = vi.fn();

    render(
      <TodayClassControlCenter
        {...baseProps}
        todayAttendanceTargetStudents={[
          {
            id: 'unmarked-student',
            name: 'Unmarked Student',
            studentId: 'HS260101',
            enrollmentStatus: 'active',
          } as any,
        ]}
        handleMarkAllPresentForToday={handleMarkAllPresentForToday}
        onMarkAllPresentError={onMarkAllPresentError}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /mark all present/i }));

    await waitFor(() => {
      expect(onMarkAllPresentError).toHaveBeenCalledWith(error);
    });
  });
});

describe('TodayClassControlCenter parent messaging', () => {
  it('does not render quick parent messaging actions in the control center', () => {
    render(
      <TodayClassControlCenter
        {...baseProps}
        actionRosterStudents={[
          {
            id: 'student-1',
            name: 'Student One',
            studentId: 'HS260101',
            enrollmentStatus: 'active',
          } as any,
        ]}
        todayAttendanceTargetStudents={[]}
        handleMarkAllPresentForToday={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /message parents/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /send notification to filtered group/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^message$/i })).not.toBeInTheDocument();
  });
});
