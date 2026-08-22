// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ClassDetailTabs } from './ClassDetailTabs';

vi.mock('../../../../components/classDetail/ClassExportControls', () => ({
  ClassExportControls: () => null,
}));

vi.mock('../../../../components/classDetail/ClassStudentsTab', () => ({
  ClassStudentsTab: () => <div>Roster Content</div>,
}));

vi.mock('../../../../components/classDetail/ClassAttendanceTab', () => ({
  ClassAttendanceTab: (props: any) => (
    <button
      type="button"
      onClick={() =>
        props.onOpenStudent({ id: 'student-1', name: 'Student One', studentId: 'HS-001' })
      }
    >
      Open mocked student
    </button>
  ),
}));

vi.mock('../../Reports', () => ({
  default: () => null,
}));

const attendanceTabProps: React.ComponentProps<typeof ClassDetailTabs> = {
  activeTab: 'attendance',
  setActiveTab: vi.fn(),
  profile: { uid: 'admin-1', role: 'admin' } as any,
  classData: { id: 'class-1' } as any,
  courseClosing: {
    snapshot: null,
    loading: false,
    approving: false,
    error: null,
    refresh: vi.fn(),
    approve: vi.fn(),
  },
  coursePeriod: { start: '', end: '' },
  setCoursePeriod: vi.fn(),
  selectedMonth: new Date('2026-08-01T00:00:00'),
  setSelectedMonth: vi.fn(),
  exportWord: vi.fn(),
  isExporting: false,
  reportDataLength: 0,
  students: [],
  searchTerm: '',
  setSearchTerm: vi.fn(),
  filteredClassEvaluations: [],
  handleEditEval: vi.fn(),
  handleDeleteEval: vi.fn(),
  handleOpenEvalSelect: vi.fn(),
  isArchived: false,
  isPaused: false,
  handleSendZaloFromCard: vi.fn(),
  isSendingZalo: false,
  attendanceData: [],
  classDates: [],
  handleAttendanceToggle: vi.fn(),
  handleMarkAllPresent: vi.fn(),
  handleMarkAllPresentError: vi.fn(),
  setSelectedAttendanceForDetail: vi.fn(),
  setNotifyAbsenceDate: vi.fn(),
  exportAttendanceReport: vi.fn(),
  handleDeleteDates: vi.fn(),
  classSessions: [],
  handleConfirmSession: vi.fn(),
  isTogglingAttendance: false,
  isAttendancePending: vi.fn(),
  confirmingSessionDate: null,
  onOpenAttendanceStudent: vi.fn(),
  selectedAttendanceStudentId: null,
  onSelectedAttendanceStudentHidden: vi.fn(),
};

describe('ClassDetailTabs office academic access', () => {
  it('renders the student roster for office users', () => {
    render(
      <ClassDetailTabs
        {...attendanceTabProps}
        activeTab="students"
        profile={{ role: 'office' } as any}
      />
    );

    expect(screen.getByText('Roster Content')).toBeDefined();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('shows the Students tab to Admin users', () => {
    render(
      <ClassDetailTabs
        {...attendanceTabProps}
        activeTab="students"
        profile={{ uid: 'admin-1', role: 'admin' } as any}
      />
    );

    expect(screen.getByRole('button', { name: /students/i })).toBeDefined();
    expect(screen.getByText('Roster Content')).toBeDefined();
  });

  it('forwards attendance student profile selection callbacks', () => {
    const onOpenAttendanceStudent = vi.fn();
    render(
      <ClassDetailTabs
        {...attendanceTabProps}
        activeTab="attendance"
        onOpenAttendanceStudent={onOpenAttendanceStudent}
        selectedAttendanceStudentId="student-1"
        onSelectedAttendanceStudentHidden={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open mocked student' }));
    expect(onOpenAttendanceStudent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'student-1' })
    );
  });
});
