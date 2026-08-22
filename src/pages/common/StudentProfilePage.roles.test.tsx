// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import StudentProfilePage from './StudentProfilePage';
import { fetchStudentAdminReport } from '../../lib/api/studentAdminReportApi';
import { getDocs } from '@/src/test/legacyDataTestApi';

let mockRole = 'admin';

vi.mock('../../lib/api/studentAdminReportApi', () => ({
  fetchStudentAdminReport: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: `${mockRole}-1` },
    profile: { uid: `${mockRole}-1`, role: mockRole, displayName: mockRole },
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

vi.mock('./studentProfile/StudentOverviewTab', () => ({
  StudentOverviewTab: () => <div data-testid="overview-tab">overview</div>,
}));

vi.mock('../admin/components/studentReport/StudentReportHeader', () => ({
  StudentReportHeader: ({ studentName }: any) => (
    <div data-testid="report-header">{studentName}</div>
  ),
}));

vi.mock('../admin/components/studentReport/StudentReportKpis', () => ({
  StudentReportKpis: () => <div data-testid="report-kpis">kpis</div>,
}));

vi.mock('../admin/components/studentReport/StudentAttendanceReportTab', () => ({
  StudentAttendanceReportTab: () => <div data-testid="attendance-tab">attendance</div>,
}));

vi.mock('../admin/components/studentReport/StudentFinanceReportTab', () => ({
  StudentFinanceReportTab: () => <div data-testid="finance-tab">finance</div>,
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
  attendanceRows: [],
  ledgers: [
    {
      id: 'l1',
      periodKey: 'p1',
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

function renderPage(entry = '/students/stu-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/students/:studentId" element={<StudentProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('StudentProfilePage role-scoped tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'admin';
    vi.mocked(getDocs).mockResolvedValue(docsFor([]) as any);
    vi.mocked(fetchStudentAdminReport).mockResolvedValue(MOCK_REPORT as any);
  });

  it('shows overview, academic, and finance tabs for admin', async () => {
    mockRole = 'admin';
    renderPage();

    await waitFor(() => expect(screen.getByTestId('tab-overview')).toBeInTheDocument());
    expect(screen.getByTestId('tab-academic')).toBeInTheDocument();
    expect(screen.getByTestId('tab-finance')).toBeInTheDocument();
  });

  it('shows overview and finance, but not academic, for accounting', async () => {
    mockRole = 'accounting';
    renderPage();

    await waitFor(() => expect(screen.getByTestId('tab-overview')).toBeInTheDocument());
    expect(screen.queryByTestId('tab-academic')).not.toBeInTheDocument();
    expect(screen.getByTestId('tab-finance')).toBeInTheDocument();
  });

  it('falls back to overview when teacher opens a finance deep link', async () => {
    mockRole = 'teacher';
    renderPage('/students/stu-1?tab=finance');

    await waitFor(() =>
      expect(screen.getByTestId('tab-overview')).toHaveAttribute('aria-selected', 'true')
    );
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('finance-tab')).not.toBeInTheDocument();
  });

  it('keeps the finance tab active for admin finance deep links', async () => {
    mockRole = 'admin';
    renderPage('/students/stu-1?tab=finance');

    await waitFor(() =>
      expect(screen.getByTestId('tab-finance')).toHaveAttribute('aria-selected', 'true')
    );
    expect(screen.getByTestId('finance-tab')).toBeInTheDocument();
  });
});
