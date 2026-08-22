// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Teachers from './Teachers';
import { readOfficeTeachersMonth } from '../../lib/api/officeTeachersApi';
import { readOfficeTeacherReferences } from '../../lib/api/frontendReadApi';
import { translations } from '../../lib/i18n/translations';

const authMocks = vi.hoisted(() => ({
  profile: { uid: 'office-uid', role: 'office' } as { uid: string; role: string },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: authMocks.profile }),
}));

vi.mock('../../lib/api/apiClient', () => ({
  apiRequest: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api/officeTeachersApi', () => ({
  readOfficeTeachersMonth: vi.fn(),
}));

vi.mock('../../lib/api/frontendReadApi', () => ({
  readOfficeTeacherReferences: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderTeachers() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Teachers />
    </QueryClientProvider>
  );
  return { ...view, queryClient };
}

describe('Office Teachers page', () => {
  const RealDate = global.Date;

  beforeEach(() => {
    authMocks.profile = { uid: 'office-uid', role: 'office' };
    vi.clearAllMocks();
    vi.mocked(readOfficeTeachersMonth).mockReset();
    vi.mocked(readOfficeTeacherReferences).mockResolvedValue({
      teachers: [
        {
          uid: 'teacher-1',
          displayName: 'Teacher One',
          email: 'one@test.com',
          phone: '+84384072314',
          blockedTeacher: false,
        },
      ],
    });
    localStorage.setItem('language', 'vi');
    const mockDate = new RealDate('2026-06-04T00:00:00.000Z');
    const MockDateConstructor = function (this: any, ...args: any[]) {
      if (args.length === 0) return mockDate;
      return new (RealDate as any)(...args);
    };
    Object.getOwnPropertyNames(RealDate).forEach((key) => {
      if (key === 'length' || key === 'name' || key === 'prototype') return;
      (MockDateConstructor as any)[key] = (RealDate as any)[key];
    });
    MockDateConstructor.prototype = RealDate.prototype;
    MockDateConstructor.now = () => mockDate.getTime();
    vi.stubGlobal('Date', MockDateConstructor);

    vi.mocked(readOfficeTeachersMonth).mockResolvedValue({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers: [
        {
          uid: 'teacher-1',
          displayName: 'Teacher One',
          email: 'one@test.com',
          phone: '+84384072314',
          blockedTeacher: false,
        },
      ],
      classes: [
        {
          id: 'class-1',
          name: '6A Global Success',
          teacherId: 'teacher-1',
          daysOfWeek: [1, 3],
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          startTime: '17:30',
          schedule: '17:30 - 19:00',
          room: 'Room 2',
          status: 'active',
          holidays: [],
          salaryPerSession: 200000,
        },
      ],
      sessions: [
        {
          id: 'class-1_2026-06-03',
          classId: 'class-1',
          teacherId: 'teacher-1',
          date: '2026-06-03',
          status: 'taught',
          teacherAttendanceStatus: 'present',
        },
        {
          id: 'class-1_2026-06-05',
          classId: 'class-1',
          teacherId: 'teacher-1',
          date: '2026-06-05',
          status: 'makeup',
        },
      ],
      substitutes: [],
      serverTime: Date.now(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders Vietnamese teacher contact classes metrics and calendar', async () => {
    renderTeachers();

    expect(await screen.findByText('Danh sách giáo viên')).toBeInTheDocument();
    expect(
      screen.getByText('Xem SĐT, lớp đang dạy và lịch dạy theo tháng của giáo viên.')
    ).toBeInTheDocument();
    expect(screen.getAllByText('Teacher One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0384072314').length).toBeGreaterThan(0);
    expect(screen.getAllByText('6A Global Success').length).toBeGreaterThan(0);
    expect(screen.getAllByText('17:30 - 19:00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Đã dạy').length).toBeGreaterThan(0);
    expect(screen.getByText('Đang hoạt động')).toBeInTheDocument();
  });

  it('renders the lightweight teacher list while monthly details are still loading', async () => {
    const monthRequest = deferred<Awaited<ReturnType<typeof readOfficeTeachersMonth>>>();
    vi.mocked(readOfficeTeachersMonth).mockReturnValue(monthRequest.promise);

    renderTeachers();

    expect(await screen.findByText('Teacher One')).toBeInTheDocument();
    expect(screen.getByTestId('teacher-details-loading')).toHaveTextContent(
      translations.vi.officeTeachersPage.loadingDetails
    );

    await act(async () => {
      monthRequest.resolve({
        month: '2026-06',
        range: { from: '2026-06-01', to: '2026-06-30' },
        teachers: [],
        classes: [],
        sessions: [],
        substitutes: [],
        serverTime: Date.now(),
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('teacher-details-loading')).not.toBeInTheDocument();
    });
  });

  it('filters teachers by the displayed local phone number', async () => {
    renderTeachers();

    await screen.findByText('Danh sách giáo viên');
    await userEvent.type(screen.getByRole('searchbox', { name: /tìm giáo viên/i }), '0384');

    expect(screen.getAllByText('Teacher One').length).toBeGreaterThan(0);
  });

  it('lets the teacher list fill the stretched side panel beside the calendar', async () => {
    renderTeachers();

    await screen.findByText('Danh sách giáo viên');

    const panel = screen.getByTestId('teacher-list-panel');
    const list = screen.getByTestId('teacher-list-scroll');

    expect(panel).toHaveClass('flex', 'h-full', 'flex-col');
    expect(list).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    expect(list.className).not.toContain('max-h-');
  });

  it('shows full shifts for the selected day with Vietnamese status labels', async () => {
    renderTeachers();

    await screen.findByText('Danh sách giáo viên');
    const dayButton = screen.getByRole('button', { name: /2026-06-03/i });
    await userEvent.click(dayButton);

    const details = screen.getByTestId('teacher-day-details');
    expect(within(details).getByText('6A Global Success')).toBeInTheDocument();
    expect(within(details).getByText('Đã dạy')).toBeInTheDocument();
  });

  it('shows localized reload action when data loading fails', async () => {
    vi.mocked(readOfficeTeachersMonth).mockRejectedValueOnce(new Error('network failed'));

    renderTeachers();

    expect(await screen.findByText('Không tải được danh sách giáo viên')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /tải lại/i }));

    await waitFor(() => {
      expect(readOfficeTeachersMonth).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps the cached month visible and offers retry after background failure', async () => {
    const { queryClient } = renderTeachers();
    expect(await screen.findByText(translations.vi.officeTeachersPage.title)).toBeInTheDocument();
    vi.mocked(readOfficeTeachersMonth).mockRejectedValueOnce(
      new Error('background network failure')
    );

    await act(async () => {
      await queryClient.invalidateQueries();
    });

    expect(screen.getAllByText('Teacher One').length).toBeGreaterThan(0);
    expect(
      await screen.findByText(translations.vi.officeTeachersPage.error.staleWarning)
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', {
        name: translations.vi.officeTeachersPage.error.staleRetry,
      })
    );

    await waitFor(() => {
      expect(readOfficeTeachersMonth).toHaveBeenCalledTimes(3);
      expect(
        screen.queryByText(translations.vi.officeTeachersPage.error.staleWarning)
      ).not.toBeInTheDocument();
    });
  });

  it('shows makeup as a localized badge without counting it as taught before attendance is present', async () => {
    renderTeachers();

    expect(await screen.findByText('Danh sách giáo viên')).toBeInTheDocument();
    expect(screen.getAllByText('Teacher One').length).toBeGreaterThan(0);
    expect(screen.getByText('1 đã dạy')).toBeInTheDocument();

    const dayButton = screen.getByRole('button', { name: '2026-06-05' });
    await userEvent.click(dayButton);

    const details = screen.getByTestId('teacher-day-details');
    expect(within(details).getByText('Bù')).toBeInTheDocument();
    expect(within(details).getByText('Dự kiến')).toBeInTheDocument();
  });

  it('renders English copy from the translation module', async () => {
    localStorage.setItem('language', 'en');

    renderTeachers();

    expect(await screen.findByText('Teacher List')).toBeInTheDocument();
    expect(
      screen.getByText(
        'View teacher phone numbers, active classes, and monthly teaching schedules.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search teachers/i })).toHaveAttribute(
      'placeholder',
      'Search name, email, phone...'
    );
    expect(screen.getAllByText('Taught').length).toBeGreaterThan(0);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});

describe('Teachers page salary visibility', () => {
  beforeEach(() => {
    authMocks.profile = { uid: 'office-uid', role: 'office' };
    vi.clearAllMocks();
    vi.mocked(readOfficeTeachersMonth).mockResolvedValue({
      month: '2026-06',
      range: { from: '2026-06-01', to: '2026-06-30' },
      teachers: [
        {
          uid: 'teacher-1',
          displayName: 'Teacher One',
          email: 'one@test.com',
          phone: '+84384072314',
          blockedTeacher: false,
        },
      ],
      classes: [
        {
          id: 'class-1',
          name: '6A Global Success',
          teacherId: 'teacher-1',
          daysOfWeek: [1, 3],
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          startTime: '17:30',
          schedule: '17:30 - 19:00',
          room: 'Room 2',
          status: 'active',
          holidays: [],
          salaryPerSession: 200000,
        },
      ] as any,
      sessions: [
        {
          id: 'class-1_2026-06-03',
          classId: 'class-1',
          teacherId: 'teacher-1',
          date: '2026-06-03',
          status: 'taught',
          teacherAttendanceStatus: 'present',
        },
        {
          id: 'class-1_2026-06-05',
          classId: 'class-1',
          teacherId: 'teacher-1',
          date: '2026-06-05',
          status: 'makeup',
        },
      ] as any,
      substitutes: [],
      serverTime: Date.now(),
    });
  });

  it('shows the per-teacher salary for admin', async () => {
    authMocks.profile = { uid: 'admin-uid', role: 'admin' };

    renderTeachers();

    expect((await screen.findAllByText('200.000 đ')).length).toBeGreaterThan(0);
  });

  it('hides the salary from office', async () => {
    renderTeachers();

    await screen.findByText('Danh sách giáo viên');

    expect(screen.queryByText('200.000 đ')).not.toBeInTheDocument();
  });

  it('counts only present sessions toward the salary total', async () => {
    authMocks.profile = { uid: 'admin-uid', role: 'admin' };

    renderTeachers();

    // Fixture has one present session (2026-06-03) and one makeup with no
    // attendance status (2026-06-05). Only the present one is payable.
    expect((await screen.findAllByText('200.000 đ')).length).toBeGreaterThan(0);
    expect(screen.queryByText('400.000 đ')).not.toBeInTheDocument();
  });

  it('shows the rate column for admin and hides it from office', async () => {
    authMocks.profile = { uid: 'admin-uid', role: 'admin' };
    const { unmount } = renderTeachers();

    expect(await screen.findByText('Đơn giá')).toBeInTheDocument();
    unmount();

    authMocks.profile = { uid: 'office-uid', role: 'office' };
    renderTeachers();

    await screen.findByText('Danh sách giáo viên');
    expect(screen.queryByText('Đơn giá')).not.toBeInTheDocument();
  });

  it('shows the rate to a salary-readable non-admin role', async () => {
    authMocks.profile = { uid: 'accounting-uid', role: 'accounting' };

    renderTeachers();

    expect(await screen.findByText('Đơn giá')).toBeInTheDocument();
  });

  it('renders the rate read-only, with no edit control even for admin', async () => {
    const { apiRequest } = await import('../../lib/api/apiClient');
    authMocks.profile = { uid: 'admin-uid', role: 'admin' };

    renderTeachers();

    const table = within(await screen.findByRole('table'));
    expect(await table.findByText('200.000 đ')).toBeInTheDocument();

    // The rate is a property of the class, not of the teacher: a teacher
    // assigned to a class earns that class's rate. It is edited from the class
    // form, so this teacher-centric view must never write it.
    expect(table.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(table.queryByRole('button')).not.toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('shows a salary badge on each sidebar row for admin only', async () => {
    authMocks.profile = { uid: 'admin-uid', role: 'admin' };
    const { unmount } = renderTeachers();

    await screen.findByText('Danh sách giáo viên');
    const adminPanel = screen.getByTestId('teacher-list-panel');
    expect(within(adminPanel).getByText('200.000 đ')).toBeInTheDocument();
    unmount();

    authMocks.profile = { uid: 'office-uid', role: 'office' };
    renderTeachers();

    await screen.findByText('Danh sách giáo viên');
    const officePanel = screen.getByTestId('teacher-list-panel');
    expect(within(officePanel).queryByText('200.000 đ')).not.toBeInTheDocument();
  });
});
