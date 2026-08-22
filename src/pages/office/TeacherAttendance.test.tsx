// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeacherAttendance from './TeacherAttendance';
import { translations } from '../../lib/i18n/translations';
import { LanguageProvider } from '../../lib/i18n/useLanguage';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  markTeacherAttendance,
  readTeacherAttendanceWeek,
} from '../../lib/api/teacherAttendanceApi';

function renderAttendance(ui?: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>{ui ?? <TeacherAttendance />}</QueryClientProvider>
  );
}
import { readOfficeTeachersMonth } from '../../lib/api/officeTeachersApi';
import { readTeacherPayrollMonth } from '../../lib/api/teacherPayrollApi';
import { exportTeacherAttendanceReportWorkbook } from '../../lib/exports/teacherAttendanceReportExport';

const authMocks = vi.hoisted(() => ({
  profile: { uid: 'office-uid', role: 'office' } as { uid: string; role: string },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: authMocks.profile }),
}));

vi.mock('../../lib/api/teacherAttendanceApi', () => ({
  readTeacherAttendanceWeek: vi.fn(),
  markTeacherAttendance: vi.fn(),
}));

vi.mock('../../lib/api/officeTeachersApi', () => ({
  readOfficeTeachersMonth: vi.fn(),
}));

vi.mock('../../lib/api/teacherPayrollApi', () => ({
  readTeacherPayrollMonth: vi.fn(),
}));

vi.mock('../../lib/exports/teacherAttendanceReportExport', () => ({
  exportTeacherAttendanceReportWorkbook: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('date-fns', () => ({
  startOfWeek: () => new Date('2026-06-01T00:00:00.000Z'),
  endOfWeek: () => new Date('2026-06-07T23:59:59.999Z'),
  format: (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  },
  addDays: (date: Date, days: number) => {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  },
}));

describe('TeacherAttendance page', () => {
  type AttendanceWeek = Awaited<ReturnType<typeof readTeacherAttendanceWeek>>;
  type AttendanceSession = AttendanceWeek['sessions'][number];

  const makeSession = (overrides: Partial<AttendanceSession>): AttendanceSession => ({
    id: 'class-1_2026-06-01',
    classId: 'class-1',
    className: '6A Global Success',
    teacherId: 'teacher-1',
    teacherName: 'Teacher One',
    date: '2026-06-01',
    schedule: '17:30 - 19:00',
    sessionStatus: 'taught',
    sessionKind: 'scheduled',
    isVirtual: true,
    teacherAttendanceStatus: 'pending',
    canMark: true,
    ...overrides,
  });

  const defaultWeekResponse = (): AttendanceWeek => ({
    teachers: [
      { uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher@test.com' },
      { uid: 'teacher-2', displayName: 'Teacher Two', email: 'teacher-two@test.com' },
    ],
    classes: [{ id: 'class-1', name: '6A Global Success' }],
    serverTime: Date.now(),
    sessions: [
      {
        id: 'class-1_2026-06-01',
        classId: 'class-1',
        className: '6A Global Success',
        teacherId: 'teacher-1',
        teacherName: 'Teacher One',
        date: '2026-06-01',
        schedule: '17:30 - 19:00',
        room: 'Room 2',
        sessionStatus: 'taught',
        sessionKind: 'scheduled',
        isVirtual: true,
        teacherAttendanceStatus: 'pending',
        canMark: true,
      },
      {
        id: 'class-1_2026-06-03',
        classId: 'class-1',
        className: '6A Global Success',
        teacherId: 'teacher-1',
        teacherName: 'Teacher One',
        date: '2026-06-03',
        schedule: '17:30 - 19:00',
        sessionStatus: 'cancelled',
        sessionKind: 'cancelled',
        isVirtual: false,
        teacherAttendanceStatus: 'pending',
        canMark: false,
        disabledReason: 'cancelled',
      },
    ],
  });

  beforeEach(() => {
    authMocks.profile = { uid: 'office-uid', role: 'office' };
    vi.clearAllMocks();
    localStorage.setItem('language', 'vi');
    vi.mocked(readTeacherAttendanceWeek).mockResolvedValue(defaultWeekResponse());
    vi.mocked(markTeacherAttendance).mockResolvedValue({
      success: true,
      id: 'class-1_2026-06-01',
      status: 'present',
    });
    vi.mocked(readOfficeTeachersMonth).mockResolvedValue({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers: [
        { uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher@test.com' },
        { uid: 'teacher-2', displayName: 'Teacher Two', email: 'teacher-two@test.com' },
      ],
      classes: [
        {
          id: 'class-1',
          name: '6A Global Success',
          teacherId: 'teacher-1',
          daysOfWeek: [1],
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          schedule: '17:30 - 19:00',
          salaryPerSession: 150000,
        },
      ],
      sessions: [],
      substitutes: [],
      serverTime: Date.now(),
    });
    vi.mocked(readTeacherPayrollMonth).mockResolvedValue({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers: [
        { uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher@test.com' },
        { uid: 'teacher-2', displayName: 'Teacher Two', email: 'teacher-two@test.com' },
      ],
      classes: [
        {
          id: 'class-1',
          name: '6A Global Success',
          teacherId: 'teacher-1',
          daysOfWeek: [1],
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          schedule: '17:30 - 19:00',
          salaryPerSession: 150000,
        },
      ],
      sessions: [],
      substitutes: [],
      serverTime: Date.now(),
    });
    vi.mocked(exportTeacherAttendanceReportWorkbook).mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders Vietnamese weekly teacher attendance rows counters and filters', async () => {
    renderAttendance();

    expect(
      await screen.findByText(translations.vi.teacherAttendancePage.title)
    ).toBeInTheDocument();
    expect(screen.getByText(translations.vi.teacherAttendancePage.subtitle)).toBeInTheDocument();
    expect(
      screen.getByText(translations.vi.teacherAttendancePage.metrics.total)
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(translations.vi.teacherAttendancePage.status.pending).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(translations.vi.teacherAttendancePage.status.present).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(translations.vi.teacherAttendancePage.status.absent).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(translations.vi.teacherAttendancePage.status.cancelled).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole('searchbox', {
        name: translations.vi.teacherAttendancePage.search.label,
      })
    ).toHaveAttribute('placeholder', translations.vi.teacherAttendancePage.search.hint);
    expect(
      screen.getByRole('option', {
        name: translations.vi.teacherAttendancePage.filters.allTeachers,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', {
        name: translations.vi.teacherAttendancePage.filters.allClasses,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', {
        name: translations.vi.teacherAttendancePage.filters.allStatuses,
      })
    ).toBeInTheDocument();

    const row = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01');
    expect(within(row).getByText('6A Global Success')).toBeInTheDocument();
    expect(within(row).getByText(/Teacher One/)).toBeInTheDocument();
    expect(
      within(row).getByText(translations.vi.teacherAttendancePage.status.pending)
    ).toBeInTheDocument();
  });

  it('marks a session present and shows localized success toast', async () => {
    renderAttendance();
    expect(
      await screen.findByText(translations.vi.teacherAttendancePage.title)
    ).toBeInTheDocument();

    const row = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01');
    await userEvent.click(
      within(row).getByRole('button', {
        name: translations.vi.teacherAttendancePage.actions.present,
      })
    );

    await waitFor(() => {
      expect(markTeacherAttendance).toHaveBeenCalledWith({
        classId: 'class-1',
        date: '2026-06-01',
        status: 'present',
      });
      expect(toast.success).toHaveBeenCalledWith(
        translations.vi.teacherAttendancePage.toast.markedPresent
      );
    });
  });

  it('hides attendance action buttons after a session is marked', async () => {
    const verified = defaultWeekResponse();
    verified.sessions[0] = {
      ...verified.sessions[0],
      teacherAttendanceStatus: 'present',
      isVirtual: false,
    };
    vi.mocked(readTeacherAttendanceWeek)
      .mockResolvedValueOnce(defaultWeekResponse())
      .mockResolvedValue(verified);

    renderAttendance();
    expect(
      await screen.findByText(translations.vi.teacherAttendancePage.title)
    ).toBeInTheDocument();

    const row = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01');
    await userEvent.click(
      within(row).getByRole('button', {
        name: translations.vi.teacherAttendancePage.actions.present,
      })
    );

    await waitFor(() => {
      expect(
        within(row).queryByRole('button', {
          name: translations.vi.teacherAttendancePage.actions.present,
        })
      ).not.toBeInTheDocument();
      expect(
        within(row).queryByRole('button', {
          name: translations.vi.teacherAttendancePage.actions.absent,
        })
      ).not.toBeInTheDocument();
    });
  });

  it('hides attendance action buttons for sessions already marked present or absent', async () => {
    vi.mocked(readTeacherAttendanceWeek).mockResolvedValueOnce({
      teachers: [{ uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher@test.com' }],
      classes: [{ id: 'class-1', name: '6A Global Success' }],
      serverTime: new Date('2026-06-03T02:00:00.000Z').getTime(),
      sessions: [
        makeSession({
          id: 'class-1_2026-06-02',
          date: '2026-06-02',
          teacherAttendanceStatus: 'present',
          isVirtual: false,
        }),
        makeSession({
          id: 'class-1_2026-06-03',
          date: '2026-06-03',
          teacherAttendanceStatus: 'absent',
          isVirtual: false,
        }),
      ],
    });

    renderAttendance();

    const presentRow = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-02');
    const absentRow = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-03');

    [presentRow, absentRow].forEach((row) => {
      expect(
        within(row).queryByRole('button', {
          name: translations.vi.teacherAttendancePage.actions.present,
        })
      ).not.toBeInTheDocument();
      expect(
        within(row).queryByRole('button', {
          name: translations.vi.teacherAttendancePage.actions.absent,
        })
      ).not.toBeInTheDocument();
    });
  });

  it('moves sessions from the current server date to the top of the list', async () => {
    vi.mocked(readTeacherAttendanceWeek).mockResolvedValueOnce({
      teachers: [{ uid: 'teacher-1', displayName: 'Teacher One', email: 'teacher@test.com' }],
      classes: [{ id: 'class-1', name: '6A Global Success' }],
      serverTime: new Date('2026-06-03T02:00:00.000Z').getTime(),
      sessions: [
        makeSession({ id: 'class-1_2026-06-01', date: '2026-06-01' }),
        makeSession({ id: 'class-1_2026-06-04', date: '2026-06-04' }),
        makeSession({ id: 'class-1_2026-06-03', date: '2026-06-03' }),
      ],
    });

    renderAttendance();

    const todayRow = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-03');
    const mondayRow = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01');
    const thursdayRow = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-04');

    expect(todayRow.compareDocumentPosition(mondayRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(todayRow.compareDocumentPosition(thursdayRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('shows localized update error toast when marking fails', async () => {
    vi.mocked(markTeacherAttendance).mockRejectedValueOnce(new Error('network failed'));

    renderAttendance();
    expect(
      await screen.findByText(translations.vi.teacherAttendancePage.title)
    ).toBeInTheDocument();

    const row = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01');
    await userEvent.click(
      within(row).getByRole('button', {
        name: translations.vi.teacherAttendancePage.actions.absent,
      })
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        translations.vi.teacherAttendancePage.toast.updateError
      );
    });
  });

  it('puts the row back when marking fails', async () => {
    vi.mocked(markTeacherAttendance).mockRejectedValueOnce(new Error('server refused'));
    renderAttendance();
    expect(
      await screen.findByText(translations.vi.teacherAttendancePage.title)
    ).toBeInTheDocument();

    const row = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01');

    // Hang the verification refetch that `onSettled` triggers, so the only
    // thing that can restore this row is the rollback itself.
    vi.mocked(readTeacherAttendanceWeek).mockImplementation(() => new Promise(() => {}));

    await userEvent.click(
      within(row).getByRole('button', {
        name: translations.vi.teacherAttendancePage.actions.present,
      })
    );

    await waitFor(() => {
      expect(
        within(row).getByRole('button', {
          name: translations.vi.teacherAttendancePage.actions.present,
        })
      ).toBeInTheDocument();
      expect(
        within(row).getByRole('button', {
          name: translations.vi.teacherAttendancePage.actions.absent,
        })
      ).toBeInTheDocument();
    });
  });

  it('shows localized loading on the active attendance action', async () => {
    vi.mocked(markTeacherAttendance).mockImplementation(() => new Promise(() => {}));

    renderAttendance();
    expect(
      await screen.findByText(translations.vi.teacherAttendancePage.title)
    ).toBeInTheDocument();

    const row = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01');
    await userEvent.click(
      within(row).getByRole('button', {
        name: translations.vi.teacherAttendancePage.actions.absent,
      })
    );

    const absentButton = await within(row).findByRole('button', {
      name: translations.vi.teacherAttendancePage.actions.markingAbsent,
    });
    const presentButton = within(row).getByRole('button', {
      name: translations.vi.teacherAttendancePage.actions.present,
    });

    expect(absentButton).toHaveAttribute('aria-busy', 'true');
    expect(absentButton).toBeDisabled();
    expect(presentButton).toHaveAttribute('aria-busy', 'false');
  });

  it('disables actions for cancelled sessions with localized status', async () => {
    renderAttendance();
    expect(
      await screen.findByText(translations.vi.teacherAttendancePage.title)
    ).toBeInTheDocument();

    const cancelledRow = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-03');
    expect(
      within(cancelledRow).getByText(translations.vi.teacherAttendancePage.status.cancelled)
    ).toBeInTheDocument();
    expect(cancelledRow.querySelectorAll('button[disabled]').length).toBeGreaterThan(0);
  });

  it('renders English copy from the translation module', async () => {
    localStorage.setItem('language', 'en');

    renderAttendance();

    expect(await screen.findByText('Teacher Attendance')).toBeInTheDocument();
    expect(
      screen.getByText('Office/admin weekly attendance confirmation for teacher payroll.')
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search attendance shifts/i })).toHaveAttribute(
      'placeholder',
      'Search class, teacher, room...'
    );
    expect(screen.getByRole('option', { name: 'All teachers' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All classes' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All statuses' })).toBeInTheDocument();

    const row = await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01');
    expect(within(row).getByText('Pending')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /present/i })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /absent/i })).toBeInTheDocument();
  });

  it('exports a monthly report for a selected group of teachers', async () => {
    localStorage.setItem('language', 'en');
    const user = userEvent.setup();

    renderAttendance();

    expect(await screen.findByText('Teacher Attendance')).toBeInTheDocument();
    expect(
      await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export report' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Export teacher attendance report',
    });
    const monthInput = within(dialog).getByLabelText('Report month');
    fireEvent.change(monthInput, { target: { value: '2026-06' } });
    expect(monthInput).toHaveValue('2026-06');

    const teacherTwoCheckbox = within(dialog).getByRole('checkbox', { name: 'Teacher Two' });
    await waitFor(() => expect(teacherTwoCheckbox).toBeChecked());
    await user.click(teacherTwoCheckbox);
    await waitFor(() => expect(teacherTwoCheckbox).not.toBeChecked());

    const exportButton = within(dialog).getByRole('button', { name: 'Export Excel' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    await user.click(exportButton);

    await waitFor(() => {
      expect(readTeacherPayrollMonth).toHaveBeenCalledWith('2026-06');
      expect(readOfficeTeachersMonth).not.toHaveBeenCalled();
      expect(exportTeacherAttendanceReportWorkbook).toHaveBeenCalledWith({
        data: expect.objectContaining({ month: '2026-06' }),
        selectedTeacherIds: ['teacher-1'],
        includeSalary: false,
      });
    });
  });

  it('uses the latest language for load error toast after language changes while loading', async () => {
    const pending = createDeferred<Awaited<ReturnType<typeof readTeacherAttendanceWeek>>>();
    vi.mocked(readTeacherAttendanceWeek).mockReturnValueOnce(pending.promise);

    renderAttendance(
      <LanguageProvider>
        <TeacherAttendance />
      </LanguageProvider>
    );

    expect(
      await screen.findByText(translations.vi.teacherAttendancePage.title)
    ).toBeInTheDocument();

    await act(async () => {
      localStorage.setItem('language', 'en');
      window.dispatchEvent(new Event('language-change'));
    });

    expect(
      await screen.findByText(translations.en.teacherAttendancePage.title)
    ).toBeInTheDocument();

    await act(async () => {
      pending.reject(new Error('network failed'));
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        translations.en.teacherAttendancePage.toast.loadError
      );
    });
  });

  it('keeps metric card DOM nodes mounted when the language changes', async () => {
    renderAttendance(
      <LanguageProvider>
        <TeacherAttendance />
      </LanguageProvider>
    );

    const viTotalLabel = await screen.findByText(
      translations.vi.teacherAttendancePage.metrics.total
    );
    const totalMetricCard = viTotalLabel.closest('.group');
    expect(totalMetricCard).not.toBeNull();

    await act(async () => {
      localStorage.setItem('language', 'en');
      window.dispatchEvent(new Event('language-change'));
    });

    const enTotalLabel = await screen.findByText(
      translations.en.teacherAttendancePage.metrics.total
    );

    expect(enTotalLabel.closest('.group')).toBe(totalMetricCard);
  });

  it('exports without money for office', async () => {
    localStorage.setItem('language', 'en');
    const user = userEvent.setup();

    renderAttendance();

    expect(
      await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export report' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Export teacher attendance report',
    });
    const exportButton = within(dialog).getByRole('button', { name: 'Export Excel' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    await user.click(exportButton);

    await waitFor(() => {
      expect(exportTeacherAttendanceReportWorkbook).toHaveBeenCalledWith(
        expect.objectContaining({ includeSalary: false })
      );
    });
  });

  it('exports with money for admin', async () => {
    localStorage.setItem('language', 'en');
    authMocks.profile = { uid: 'admin-uid', role: 'admin' };
    const user = userEvent.setup();

    renderAttendance();

    expect(
      await screen.findByTestId('teacher-attendance-row-class-1_2026-06-01')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Export report' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Export teacher attendance report',
    });
    const exportButton = within(dialog).getByRole('button', { name: 'Export Excel' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    await user.click(exportButton);

    await waitFor(() => {
      expect(exportTeacherAttendanceReportWorkbook).toHaveBeenCalledWith(
        expect.objectContaining({ includeSalary: true })
      );
    });
  });
});
