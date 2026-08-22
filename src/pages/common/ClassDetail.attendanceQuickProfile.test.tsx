// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let hostProps: any = null;
let resolvePendingEdit: (() => void) | null = null;

vi.mock('./classDetail/components/ClassAttendanceStudentQuickProfile', () => ({
  ClassAttendanceStudentQuickProfile: (props: any) => {
    hostProps = props;
    const [editingStudentName, setEditingStudentName] = React.useState<string | null>(null);
    if (!props.student) return null;
    return (
      <div data-testid="quick-profile-host">
        <button
          type="button"
          onClick={() => {
            const selectedName = props.student.name;
            void new Promise<void>((resolve) => {
              resolvePendingEdit = resolve;
            }).then(() => setEditingStudentName(selectedName));
          }}
        >
          Start Edit
        </button>
        {editingStudentName && <div>Editing {editingStudentName}</div>}
      </div>
    );
  },
}));

vi.mock('./classDetail/components/ClassDetailTabs', () => ({
  ClassDetailTabs: (props: any) => (
    <div>
      <button
        type="button"
        onClick={() => props.onOpenAttendanceStudent({ id: 'student-1', name: 'Nguyễn Minh Anh' })}
      >
        Open Student A
      </button>
      <button
        type="button"
        onClick={() => props.onOpenAttendanceStudent({ id: 'student-2', name: 'Trần Minh Bình' })}
      >
        Open Student B
      </button>
      <button type="button" onClick={props.onSelectedAttendanceStudentHidden}>
        Hide Selected Student
      </button>
    </div>
  ),
}));

vi.mock('./classDetail/hooks/useClassDetailView', () => ({
  useClassDetailView: () => ({
    id: 'class-1',
    profile: { uid: 'admin-1', role: 'admin' },
    activeTab: 'attendance',
    setActiveTab: vi.fn(),
    coursePeriod: { start: '', end: '' },
    setCoursePeriod: vi.fn(),
    selectedMonth: new Date('2026-08-01'),
    setSelectedMonth: vi.fn(),
    searchTerm: '',
    setSearchTerm: vi.fn(),
    exportWord: vi.fn(),
    isExporting: false,
    selectedAttendanceForDetail: null,
    setSelectedAttendanceForDetail: vi.fn(),
    notifyAbsenceDate: null,
    setNotifyAbsenceDate: vi.fn(),
    selectedEvaluation: null,
    handleEditEval: vi.fn(),
    handleDeleteEval: vi.fn(),
    isEvalSelectOpen: false,
    setIsEvalSelectOpen: vi.fn(),
    selectedEvalStudent: null,
    selectedMidtermEval: null,
    selectedFinalEval: null,
    handleOpenEvalSelect: vi.fn(),
  }),
}));

const mockRefreshStudents = vi.fn().mockResolvedValue(undefined);
vi.mock('../../hooks/useClassData', () => ({
  useClassData: () => ({
    classData: { id: 'class-1', name: 'Movers 2' },
    students: [],
    attendanceData: [],
    classDates: [],
    classSessions: [],
    courseClosing: { snapshot: null },
    filteredClassEvaluations: [],
    isArchived: false,
    isPaused: false,
    loading: false,
    error: null,
    evaluations: [],
    assignments: [],
    submissions: [],
    dailyReports: [],
    holidays: [],
    refreshStudents: mockRefreshStudents,
    refreshEvaluations: vi.fn(),
  }),
}));

vi.mock('./classDetail/hooks/useClassAttendanceController', () => ({
  useClassAttendanceController: () => ({
    isTogglingAttendance: false,
    confirmingSessionDate: null,
    isAttendancePending: vi.fn().mockReturnValue(false),
    handleAttendanceToggle: vi.fn(),
    handleConfirmSession: vi.fn(),
    handleMarkAllPresent: vi.fn(),
    handleMarkAllPresentError: vi.fn(),
    exportAttendanceReport: vi.fn(),
    handleDeleteDates: vi.fn(),
  }),
}));

vi.mock('./classDetail/components/ClassHeaderWithStudentCreate', () => ({
  ClassHeaderWithStudentCreate: () => null,
}));
vi.mock('./classDetail/components/ClassCourseClosingCard', () => ({
  ClassCourseClosingCard: () => null,
}));
vi.mock('./classDetail/components/AttendanceDetailModal', () => ({
  AttendanceDetailModal: () => null,
}));
vi.mock('./classDetail/components/NotifyAbsenceModal', () => ({
  NotifyAbsenceModal: () => null,
}));
vi.mock('./classDetail/components/ClassEvaluationSelectModal', () => ({
  ClassEvaluationSelectModal: () => null,
}));
vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return {
    useLanguage: () => ({ language: 'vi', t: translations.vi }),
  };
});
vi.mock('react-router', () => ({
  useParams: () => ({ classId: 'class-1' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ classId: 'class-1' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('../../lib/api/zaloOaNotificationApi', () => ({
  sendZaloEvaluationFromCard: vi.fn(),
}));

import ClassDetail from './ClassDetail';

describe('ClassDetail quick profile integration', () => {
  beforeEach(() => {
    hostProps = null;
    resolvePendingEdit = null;
  });

  it('passes selected attendance student and host callbacks', () => {
    render(<ClassDetail profile={{ uid: 'admin-1', role: 'admin' } as any} />);
    expect(screen.queryByTestId('quick-profile-host')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open Student A' }));
    expect(hostProps.student).toEqual({ id: 'student-1', name: 'Nguyễn Minh Anh' });
    expect(hostProps.refreshStudents).toBe(mockRefreshStudents);

    fireEvent.click(screen.getByRole('button', { name: 'Hide Selected Student' }));
    expect(screen.queryByTestId('quick-profile-host')).toBeNull();
  });

  it('discards an in-flight edit when the selected student changes', async () => {
    render(<ClassDetail profile={{ uid: 'admin-1', role: 'admin' } as any} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Student A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Selected Student' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Student B' }));

    expect(hostProps.student).toEqual({ id: 'student-2', name: 'Trần Minh Bình' });
    await act(async () => resolvePendingEdit?.());

    expect(screen.queryByText('Editing Nguyễn Minh Anh')).toBeNull();
  });
});
