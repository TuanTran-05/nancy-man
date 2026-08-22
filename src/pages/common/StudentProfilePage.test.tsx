// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import StudentProfilePage from './StudentProfilePage';
import { fetchStudentAdminReport } from '../../lib/api/studentAdminReportApi';
import { ApiError } from '../../lib/api/apiClient';
import { getDocs } from '@/src/test/legacyDataTestApi';

vi.mock('../../lib/api/studentAdminReportApi', () => ({
  fetchStudentAdminReport: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'admin-1' },
    profile: { uid: 'admin-1', role: 'admin', displayName: 'Admin' },
    loading: false,
  }),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'admin-1', getIdToken: vi.fn().mockResolvedValue('token') } },
  db: {},
}));

vi.mock('@/src/test/legacyDataTestApi', () => ({
  collection: vi.fn((_db, name: string) => ({ kind: 'collection', name })),
  query: vi.fn((...parts: unknown[]) => ({ kind: 'query', parts })),
  where: vi.fn((...args: unknown[]) => ({ kind: 'where', args })),
  limit: vi.fn((count: number) => ({ kind: 'limit', count })),
  getDocs: vi.fn(),
}));

vi.mock('../../lib/student/faceImage', () => ({
  isStudentFaceStoragePath: (value?: string | null) =>
    typeof value === 'string' && value.startsWith('student_faces/'),
  resolveStudentFaceUrl: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

vi.mock('./components/students/StudentActionModals', () => ({
  useStudentActionModals: () => ({
    controller: {
      openCreate: vi.fn(),
      openEdit: vi.fn(),
      openStatus: vi.fn(),
      openTransfer: vi.fn(),
      openDelete: vi.fn(),
    },
    modals: null,
    isAnyOpen: false,
  }),
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: 'vi' }),
}));

vi.mock('../admin/components/studentReport/StudentReportHeader', () => ({
  StudentReportHeader: ({ studentName, onBack, onRefresh, t, isRefreshing }: any) => (
    <div>
      <div data-testid="report-header">{studentName}</div>
      <button data-testid="back-btn" onClick={onBack}>
        {t.backLabel}
      </button>
      <button data-testid="refresh-btn" onClick={onRefresh}>
        {isRefreshing ? 'Refreshing...' : t.refreshLabel}
      </button>
    </div>
  ),
}));

vi.mock('../admin/components/studentReport/StudentReportKpis', () => ({
  StudentReportKpis: ({ attendanceSummary, attendanceMode, refundableAmount }: any) => (
    <div>
      <div data-testid="kpi-attendance-rate">
        {attendanceSummary.attendanceRate !== null
          ? `${attendanceSummary.attendanceRate.toFixed(1)}%`
          : 'Chưa đủ dữ liệu'}
      </div>
      <div data-testid="kpi-mode">{attendanceMode}</div>
      <div data-testid="kpi-refundable-amount">{refundableAmount ?? ''}</div>
    </div>
  ),
}));

vi.mock('../admin/components/studentReport/StudentAttendanceReportTab', () => ({
  StudentAttendanceReportTab: ({
    rows,
    attendanceMode,
    todayIso,
    dateRangeFrom,
    dateRangeTo,
    sessionValue,
  }: any) => (
    <div data-testid="attendance-tab">
      rows={rows.length}
      <span data-testid="tab-attendance-mode">{attendanceMode}</span>
      <span data-testid="tab-today-iso">{todayIso}</span>
      <span data-testid="tab-date-range-from">{dateRangeFrom ?? ''}</span>
      <span data-testid="tab-date-range-to">{dateRangeTo ?? ''}</span>
      <span data-testid="tab-session-value">{sessionValue ? 'present' : ''}</span>
    </div>
  ),
}));

vi.mock('../admin/components/studentReport/StudentFinanceReportTab', () => ({
  StudentFinanceReportTab: ({ ledgers }: any) => (
    <div data-testid="finance-tab">ledgers={ledgers.length}</div>
  ),
}));

const MOCK_REPORT = {
  student: {
    id: 'stu-1',
    name: 'Nguyen Van A',
    studentId: 'HS001',
    enrollmentStatus: 'active',
    dob: '2012-08-06',
    contact: '0345647924',
    classId: 'cls-4a',
    teacherId: 'teacher-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    code: 'A001',
    gender: 'male',
    studentLifecycle: 'enrolled',
  },
  timeline: [
    {
      key: 'cls-3b::term_1',
      classId: 'cls-3b',
      className: 'Lớp 3B',
      classMissing: false,
      grade: 3,
      attendanceMode: 'marked_only',
      term: {
        termId: 'term_1',
        classId: 'cls-3b',
        index: 1,
        startDate: '2025-09-01',
        endDate: '2025-12-31',
        isCurrent: false,
        schedule: null,
      },
    },
    {
      key: 'cls-4a::current',
      classId: 'cls-4a',
      className: 'Lớp 4A',
      classMissing: false,
      grade: 4,
      attendanceMode: 'expected',
      term: {
        termId: 'current',
        classId: 'cls-4a',
        index: 1,
        startDate: '2026-01-01',
        endDate: '',
        isCurrent: true,
        schedule: null,
      },
    },
  ],
  attendanceRows: [
    {
      date: '2025-10-07',
      classId: 'cls-3b',
      termKey: 'cls-3b::term_1',
      status: 'present',
      absentWithPermission: false,
      minutesLate: 0,
      source: 'scheduled',
    },
    {
      date: '2025-11-04',
      classId: 'cls-3b',
      termKey: 'cls-3b::term_1',
      status: 'absent',
      absentWithPermission: false,
      minutesLate: 0,
      source: 'scheduled',
    },
    {
      date: '2026-02-03',
      classId: 'cls-4a',
      termKey: 'cls-4a::current',
      status: 'present',
      absentWithPermission: false,
      minutesLate: 0,
      source: 'scheduled',
    },
  ],
  ledgers: [
    {
      id: 'l1',
      periodKey: 'p1',
      classId: 'cls-3b',
      termKey: 'cls-3b::term_1',
      termStart: '2025-09-01',
      termEnd: '2025-12-31',
      termLabel: null,
      dueDate: '2025-09-10',
      grossAmount: 1000,
      discount: 0,
      netAmount: 1000,
      paid: 1000,
      outstanding: 0,
      displayStatus: 'paid',
      isOverdue: false,
      hasDueDate: true,
    },
    {
      id: 'l2',
      periodKey: 'p2',
      classId: 'cls-4a',
      termKey: 'cls-4a::current',
      termStart: '2026-01-01',
      termEnd: '',
      termLabel: null,
      dueDate: '2026-01-10',
      grossAmount: 2000,
      discount: 0,
      netAmount: 2000,
      paid: 0,
      outstanding: 2000,
      displayStatus: 'unpaid',
      isOverdue: false,
      hasDueDate: true,
    },
  ],
  receipts: [],
  sessionValueByTerm: {
    'cls-4a::current': {
      courseTotalSessions: 40,
      pricePerSession: 150_000,
      refundable: { sessions: 2, amount: 300_000 },
      notEnrolled: { sessions: 0, amount: 0 },
    },
  },
  truncation: { attendance: false, ledgers: false, classSessions: false },
  generatedAt: '2026-07-17T00:00:00.000Z',
};

function docsFor(rows: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function renderPage(studentId = 'stu-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/students/${studentId}?tab=academic`]}>
        <Routes>
          <Route path="/students/:studentId" element={<StudentProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('StudentProfilePage report states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDocs).mockResolvedValue(docsFor([]) as any);
  });

  it('renders loading state initially', () => {
    vi.mocked(fetchStudentAdminReport).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Đang tải/i)).toBeInTheDocument();
  });

  it('renders success state with student name and KPIs', async () => {
    vi.mocked(fetchStudentAdminReport).mockResolvedValue(MOCK_REPORT as any);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('report-header')).toBeInTheDocument());
    expect(screen.getByTestId('report-header').textContent).toBe('Nguyen Van A');
  });

  it('renders 404 state when student not found', async () => {
    vi.mocked(fetchStudentAdminReport).mockRejectedValue(
      new ApiError('Student not found', 404, null)
    );
    renderPage('stu-missing');

    await waitFor(() => expect(screen.getByText(/không tìm thấy học sinh/i)).toBeInTheDocument());
  });

  it('renders error state with retry button', async () => {
    vi.mocked(fetchStudentAdminReport).mockRejectedValue(new Error('Server error'));
    renderPage();

    await waitFor(() => expect(screen.getByText(/Thử lại/i)).toBeInTheDocument());
  });

  it('calls refresh when refresh button clicked', async () => {
    vi.mocked(fetchStudentAdminReport).mockResolvedValue(MOCK_REPORT as any);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('refresh-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('refresh-btn'));
    await waitFor(() => expect(fetchStudentAdminReport).toHaveBeenCalledTimes(2));
  });
});

describe('StudentProfilePage course filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDocs).mockResolvedValue(docsFor([]) as any);
    vi.mocked(fetchStudentAdminReport).mockResolvedValue(MOCK_REPORT as any);
  });

  it('defaults to the current course of the current class', async () => {
    renderPage();

    await waitFor(() =>
      expect((screen.getByTestId('filter-class') as HTMLSelectElement).value).toBe('cls-4a')
    );
    expect((screen.getByTestId('filter-class') as HTMLSelectElement).value).toBe('cls-4a');
    expect((screen.getByTestId('filter-term') as HTMLSelectElement).value).toBe('cls-4a::current');
    expect(screen.getByTestId('attendance-tab').textContent).toContain('rows=1');
  });

  it('scopes the finance tab to the selected course', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('filter-class')).toBeTruthy());

    fireEvent.click(screen.getByTestId('tab-finance'));

    await waitFor(() => expect(screen.getByTestId('finance-tab').textContent).toBe('ledgers=1'));
  });

  it('fetches once without date params', async () => {
    renderPage();

    await waitFor(() => expect(fetchStudentAdminReport).toHaveBeenCalledTimes(1));
    expect(fetchStudentAdminReport).toHaveBeenCalledWith({ studentId: 'stu-1' });
  });

  it('switches course without refetching', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('filter-class')).toBeTruthy());

    fireEvent.change(screen.getByTestId('filter-class'), { target: { value: 'cls-3b' } });

    await waitFor(() =>
      expect(screen.getByTestId('attendance-tab').textContent).toContain('rows=2')
    );
    expect(fetchStudentAdminReport).toHaveBeenCalledTimes(1);
  });

  it('renders every course in the timeline strip', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('report-timeline-strip')).toBeTruthy());

    expect(screen.getByTestId('timeline-segment-cls-3b::term_1')).toBeTruthy();
    expect(screen.getByTestId('timeline-segment-cls-4a::current')).toBeTruthy();
  });

  it('selects a course from the timeline strip', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('report-timeline-strip')).toBeTruthy());

    fireEvent.click(screen.getByTestId('timeline-segment-cls-3b::term_1'));

    await waitFor(() =>
      expect((screen.getByTestId('filter-class') as HTMLSelectElement).value).toBe('cls-3b')
    );
    expect((screen.getByTestId('filter-term') as HTMLSelectElement).value).toBe('cls-3b::term_1');
    expect(screen.getByTestId('kpi-mode').textContent).toBe('marked_only');
  });

  it('keeps the date range when selecting a course from the strip', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('report-timeline-strip')).toBeTruthy());

    fireEvent.change(screen.getByTestId('filter-from'), { target: { value: '2025-01-01' } });
    fireEvent.click(screen.getByTestId('timeline-segment-cls-3b::term_1'));

    await waitFor(() =>
      expect((screen.getByTestId('filter-from') as HTMLInputElement).value).toBe('2025-01-01')
    );
  });

  it('shows a truncation warning when the API truncated attendance', async () => {
    vi.mocked(fetchStudentAdminReport).mockResolvedValue({
      ...MOCK_REPORT,
      truncation: { attendance: true, ledgers: false, classSessions: false },
    } as any);
    renderPage();

    await waitFor(() => expect(screen.getByTestId('report-truncated-warning')).toBeTruthy());
  });

  it('passes attendanceMode to the attendance tab', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('tab-attendance-mode').textContent).toBe('expected')
    );
  });

  it('passes todayIso to the attendance tab', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('tab-today-iso')).toBeTruthy());
    const todayIso = screen.getByTestId('tab-today-iso').textContent ?? '';
    expect(todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('passes dateRangeFrom and dateRangeTo to the attendance tab', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('filter-from')).toBeTruthy());

    fireEvent.change(screen.getByTestId('filter-from'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByTestId('filter-to'), { target: { value: '2026-06-30' } });

    await waitFor(() =>
      expect(screen.getByTestId('tab-date-range-from').textContent).toBe('2026-01-01')
    );
    expect(screen.getByTestId('tab-date-range-to').textContent).toBe('2026-06-30');
  });

  it('shows the session value estimate for the default single-course selection', async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('tab-session-value').textContent).toBe('present')
    );
    expect(screen.getByTestId('kpi-refundable-amount').textContent).toBe('300000');
  });

  it('hides money everywhere once a date range is applied', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('tab-session-value').textContent).toBe('present')
    );

    fireEvent.change(screen.getByTestId('filter-from'), { target: { value: '2026-01-01' } });

    await waitFor(() => expect(screen.getByTestId('tab-session-value').textContent).toBe(''));
    expect(screen.getByTestId('kpi-refundable-amount').textContent).toBe('');
  });
});
