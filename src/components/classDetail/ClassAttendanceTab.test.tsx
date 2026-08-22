// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClassAttendanceTab } from './ClassAttendanceTab';

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return {
    useLanguage: () => ({ language: 'en', t: translations.en }),
  };
});

const baseProps = {
  selectedMonth: new Date('2026-05-01T00:00:00'),
  setSelectedMonth: vi.fn(),
  attendanceData: [],
  classDates: [new Date('2026-05-10T00:00:00')],
  onAttendanceToggle: vi.fn(),
  onOpenDetail: vi.fn(),
  onNotifyAbsence: vi.fn(),
  onExportReport: vi.fn(),
  onOpenStudent: vi.fn(),
};

describe('ClassAttendanceTab student filtering', () => {
  it('hides revoked soft-deleted students from active class attendance', () => {
    render(
      <ClassAttendanceTab
        {...baseProps}
        students={[
          {
            id: 'revoked-student',
            name: 'Revoked Student',
            studentId: 'HS260047',
            enrollmentStatus: 'active',
            isRevoked: true,
          } as any,
          {
            id: 'active-student',
            name: 'Active Student',
            studentId: 'HS260048',
            enrollmentStatus: 'active',
          } as any,
        ]}
      />
    );

    expect(screen.queryByText('Revoked Student')).toBeNull();
    expect(screen.getByText('Active Student')).toBeDefined();
  });

  it('renders both rows of a duplicated pair rather than choosing between them', () => {
    // Two different codes, same child. Which one is real is a question the
    // server answers from enrollments; guessing here on name, date of birth,
    // and contact hides a duplicate that somebody needs to see and fix.
    render(
      <ClassAttendanceTab
        {...baseProps}
        students={[
          {
            id: 'newer-duplicate',
            name: 'Che Tran An Nhien',
            studentId: 'HS260322',
            enrollmentStatus: 'active',
            dob: '2014-03-17',
            contact: '0964050327',
          } as any,
          {
            id: 'current-record',
            name: 'Che Tran An Nhien',
            studentId: 'HS260319',
            enrollmentStatus: 'active',
            dob: '2014-03-17',
            contact: '0964050327',
          } as any,
        ]}
      />
    );

    expect(screen.getAllByText('Che Tran An Nhien')).toHaveLength(2);
  });

  it('keeps a historical enrollment roster row even when the current profile is archived', () => {
    render(
      <ClassAttendanceTab
        {...baseProps}
        termScope={{ classId: 'class-1', termStart: '2026-01-05', termEnd: '2026-05-31' }}
        students={[
          {
            id: 'historical-student',
            name: 'Historical Student',
            studentId: 'HS260049',
            classId: 'class-2',
            enrollmentStatus: 'promoted',
            studentLifecycle: 'archived',
            attendanceEnrollment: {
              id: 'historical-enrollment',
              classId: 'class-1',
              termStart: '2026-01-05',
              termEnd: '2026-05-31',
              joinedAt: '2026-01-05',
              endedAt: '2026-05-31',
              status: 'completed',
            },
          } as any,
        ]}
      />
    );

    expect(screen.getByText('Historical Student')).toBeInTheDocument();
  });

  it('opens the selected student from the name button without toggling attendance', () => {
    const onOpenStudent = vi.fn();
    const onAttendanceToggle = vi.fn();
    const student = {
      id: 'student-1',
      name: 'Nguyễn Minh Anh',
      studentId: 'HS-0248',
      enrollmentStatus: 'active',
    } as any;
    render(
      <ClassAttendanceTab
        {...baseProps}
        students={[student]}
        onOpenStudent={onOpenStudent}
        onAttendanceToggle={onAttendanceToggle}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /open profile for Nguyễn Minh Anh/i }));
    expect(onOpenStudent).toHaveBeenCalledWith(student);
    expect(onAttendanceToggle).not.toHaveBeenCalled();
  });

  it('notifies the parent when the selected student leaves the visible roster', () => {
    const onSelectedStudentHidden = vi.fn();
    const { rerender } = render(
      <ClassAttendanceTab
        {...baseProps}
        students={[{ id: 'student-1', name: 'Student One', enrollmentStatus: 'active' } as any]}
        selectedStudentId="student-1"
        onOpenStudent={vi.fn()}
        onSelectedStudentHidden={onSelectedStudentHidden}
      />
    );
    rerender(
      <ClassAttendanceTab
        {...baseProps}
        students={[{ id: 'student-1', name: 'Student One', enrollmentStatus: 'dropped' } as any]}
        selectedStudentId="student-1"
        onOpenStudent={vi.fn()}
        onSelectedStudentHidden={onSelectedStudentHidden}
      />
    );
    expect(onSelectedStudentHidden).toHaveBeenCalledTimes(1);
  });
});

describe('ClassAttendanceTab teacher session controls', () => {
  it('does not render teacher self-confirm controls', () => {
    render(
      <ClassAttendanceTab
        selectedMonth={new Date('2026-05-01T00:00:00')}
        setSelectedMonth={vi.fn()}
        attendanceData={[]}
        students={[]}
        classDates={[new Date('2026-05-10T00:00:00')]}
        onAttendanceToggle={vi.fn()}
        onOpenDetail={vi.fn()}
        onNotifyAbsence={vi.fn()}
        onExportReport={vi.fn()}
        onOpenStudent={vi.fn()}
        daysOfWeek={[1]}
        classSessions={[]}
        onConfirmSession={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Taught' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Absent' })).not.toBeInTheDocument();
  });
});

describe('ClassAttendanceTab export loading', () => {
  it('shows loading while exporting the attendance report', () => {
    render(<ClassAttendanceTab {...baseProps} students={[]} isExportingReport={true} />);

    const exportButton = screen.getByRole('button', { name: /exporting/i });
    expect(exportButton).toHaveAttribute('aria-busy', 'true');
    expect(exportButton).toBeDisabled();
  });
});

describe('ClassAttendanceTab mark all present', () => {
  it('marks every non-present visible student present for the selected class date', () => {
    const onMarkAllPresent = vi.fn();

    render(
      <ClassAttendanceTab
        {...baseProps}
        students={[
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
        attendanceData={[
          {
            id: 'attendance-absent',
            classId: 'class-1',
            studentId: 'absent-student',
            date: '2026-05-10',
            status: 'absent',
            teacherId: 'teacher-1',
            updatedAt: '2026-05-10T00:00:00.000Z',
          },
          {
            id: 'attendance-present',
            classId: 'class-1',
            studentId: 'present-student',
            date: '2026-05-10',
            status: 'present',
            teacherId: 'teacher-1',
            updatedAt: '2026-05-10T00:00:00.000Z',
          },
        ]}
        onMarkAllPresent={onMarkAllPresent}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /mark all present/i }));

    expect(onMarkAllPresent).toHaveBeenCalledWith('2026-05-10', [
      'unmarked-student',
      'absent-student',
    ]);
  });

  it('includes an existing real record even when corrected metadata is ineligible', () => {
    const onMarkAllPresent = vi.fn();

    render(
      <ClassAttendanceTab
        {...baseProps}
        termScope={{ classId: 'class-1', termStart: '2026-05-01', termEnd: '2026-08-31' }}
        students={[
          {
            id: 'existing-absent',
            name: 'Existing Absent',
            studentId: 'HS260104',
            enrollmentStatus: 'active',
            classId: 'class-1',
            attendanceEnrollment: {
              id: 'enrollment-1',
              classId: 'class-1',
              termStart: '2026-05-01',
              termEnd: '2026-08-31',
              joinedAt: '2026-05-20',
              endedAt: null,
              status: 'active',
            },
          } as any,
          {
            id: 'empty-ineligible',
            name: 'Empty Ineligible',
            studentId: 'HS260105',
            enrollmentStatus: 'active',
            classId: 'class-1',
            attendanceEnrollment: {
              id: 'enrollment-2',
              classId: 'class-1',
              termStart: '2026-05-01',
              termEnd: '2026-08-31',
              joinedAt: '2026-05-20',
              endedAt: null,
              status: 'active',
            },
          } as any,
        ]}
        attendanceData={[
          {
            id: 'attendance-existing',
            classId: 'class-1',
            studentId: 'existing-absent',
            date: '2026-05-10',
            status: 'absent',
            teacherId: 'teacher-1',
            updatedAt: '2026-05-10T00:00:00.000Z',
          },
        ]}
        onMarkAllPresent={onMarkAllPresent}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /mark all present/i }));

    expect(onMarkAllPresent).toHaveBeenCalledWith('2026-05-10', ['existing-absent']);
  });

  it('reports rejected bulk mark requests to the error handler', async () => {
    const error = new Error('bulk failed');
    const onMarkAllPresent = vi.fn().mockRejectedValue(error);
    const onMarkAllPresentError = vi.fn();

    render(
      <ClassAttendanceTab
        {...baseProps}
        students={[
          {
            id: 'unmarked-student',
            name: 'Unmarked Student',
            studentId: 'HS260101',
            enrollmentStatus: 'active',
          } as any,
        ]}
        onMarkAllPresent={onMarkAllPresent}
        onMarkAllPresentError={onMarkAllPresentError}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /mark all present/i }));

    await waitFor(() => {
      expect(onMarkAllPresentError).toHaveBeenCalledWith(error);
    });
  });

  it('renders per-cell eligibility and override request button for ineligible students', () => {
    const onAttendanceOverrideRequested = vi.fn();
    render(
      <ClassAttendanceTab
        {...baseProps}
        termScope={{ classId: 'class-1', termStart: '2026-05-01', termEnd: '2026-08-31' }}
        students={[
          {
            id: 'student-not-enrolled',
            name: 'Nguyen Minh Anh',
            studentId: 'HS001',
            classId: 'class-1',
            attendanceEnrollment: {
              id: 'e1',
              classId: 'class-1',
              termStart: '2026-05-01',
              termEnd: '2026-08-31',
              joinedAt: '2026-05-20',
              endedAt: null,
              status: 'active',
            },
          } as any,
        ]}
        onAttendanceOverrideRequested={onAttendanceOverrideRequested}
      />
    );

    const normalCell = screen.getByRole('button', {
      name: /Nguyen Minh Anh - 10\/05\/2026 - Not Enrolled/i,
    });
    expect(normalCell).toBeDisabled();

    const overrideBtn = screen.getByRole('button', {
      name: /Attendance Override - Nguyen Minh Anh - 10\/05\/2026/i,
    });
    expect(overrideBtn).toBeEnabled();

    fireEvent.click(overrideBtn);
    expect(onAttendanceOverrideRequested).toHaveBeenCalledWith(
      'student-not-enrolled',
      '2026-05-10',
      'not_enrolled'
    );
  });
});
