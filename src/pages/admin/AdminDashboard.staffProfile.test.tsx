// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collection } from '@/src/test/legacyDataTestApi';
import { MemoryRouter } from 'react-router';
import { readChannel } from '../../lib/api/readApi';
import { getStudentDirectory } from '../../lib/api/studentDirectoryApi';
import AdminDashboard from './AdminDashboard';
import toast from 'react-hot-toast';
import { apiRequest } from '../../lib/api/apiClient';
import { translations } from '../../lib/i18n/translations';
import { calculateStaffTenure } from '../../lib/auth/staffTenure';

let mockLanguage: 'en' | 'vi' = 'en';
let teacherCreatedAt: string | undefined = '2023-05-10T03:00:00.000Z';

type MockDoc = {
  id: string;
  data: () => Record<string, unknown>;
};

const collectionDocs: Record<string, MockDoc[]> = {
  allowed_teachers: [],
  blocked_teachers: [],
  users: [
    {
      id: 'teacher-1',
      data: () => ({
        email: 'huynhle.teacher@nancy.com',
        displayName: 'Ms. Huynh Le',
        role: 'teacher',
        phone: '0901234567',
        createdAt: teacherCreatedAt,
      }),
    },
    {
      id: 'office-1',
      data: () => ({
        email: 'frontdesk.office@nancy.com',
        displayName: 'Front Desk',
        role: 'office',
        phone: '0911111111',
        createdAt: '2023-05-10T03:00:00.000Z',
      }),
    },
    {
      id: 'accounting-1',
      data: () => ({
        email: 'finance.accounting@nancy.com',
        displayName: 'Finance Team',
        role: 'accounting',
        phone: '0922222222',
        createdAt: '2023-05-10T03:00:00.000Z',
      }),
    },
    {
      id: 'level-1',
      data: () => ({
        email: 'lower.office@nancy.com',
        displayName: 'Lower Secondary Lead',
        role: 'office',
        phone: '0933333333',
        createdAt: '2023-05-10T03:00:00.000Z',
      }),
    },
  ],
  classes: [
    {
      id: 'class-1',
      data: () => ({
        name: 'G2 - Huynh Le',
        teacherId: 'teacher-1',
        schedule: '17:30 - 19:00',
        daysOfWeek: [1, 3],
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        startTime: '17:30',
      }),
    },
    {
      id: 'class-2',
      data: () => ({
        name: 'Advanced 6',
        teacherId: 'teacher-1',
        schedule: '19:00 - 20:30',
        daysOfWeek: [2, 4],
        startDate: '2026-06-02',
        endDate: '2026-09-01',
        startTime: '19:00',
      }),
    },
    {
      id: 'class-3',
      data: () => ({ name: 'Other Class', teacherId: 'teacher-2' }),
    },
  ],
  students: [],
  evaluations: [],
};

vi.mock('@/src/test/legacyDataTestApi', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ kind: 'collection', name })),
  query: vi.fn((target) => target),
  limit: vi.fn((count: number) => ({ kind: 'limit', count })),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ kind: 'doc', path })),
  onSnapshot: vi.fn((target, onNext) => {
    if (target.kind === 'doc') {
      onNext({ exists: () => true, data: () => ({ dates: [] }) });
      return vi.fn();
    }

    onNext({
      docs: collectionDocs[target.name] || [],
    });
    return vi.fn();
  }),
}));

vi.mock('../../lib/auth/sessionAuth', () => ({
  db: {},
  auth: { currentUser: { getIdToken: vi.fn() } },
}));

vi.mock('../../lib/api/readApi', () => ({
  readChannel: vi.fn((channel: string) => {
    if (channel === 'admin-dashboard-summary') {
      return Promise.resolve({
        summary: {
          totalStudents: 0,
          activeStudents: 0,
          totalTeachers: 1,
          totalClasses: 3,
          activeClasses: 3,
        },
        students: [],
        evaluations: [],
        teachers: collectionDocs.users.map((doc) => ({ uid: doc.id, ...doc.data() })),
        classes: collectionDocs.classes.map((doc) => ({ id: doc.id, ...doc.data() })),
        classStudentCounts: {},
      });
    }
    if (channel === 'audit-log') return Promise.resolve({ logs: [] });
    return Promise.resolve({});
  }),
}));

vi.mock('../../lib/api/studentDirectoryApi', () => ({
  getStudentDirectory: vi.fn().mockResolvedValue({ students: [] }),
}));

vi.mock('../../lib/api/financeApi', () => ({
  fetchFinanceReport: vi.fn().mockResolvedValue({ balance: 0 }),
}));

vi.mock('../../lib/student/currentRecords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/student/currentRecords')>();
  return {
    ...actual,
    getCurrentStudentRecords: vi.fn((students) => students),
  };
});

vi.mock('../../lib/student/stripCredentials', () => ({
  stripStudentCredentials: vi.fn((student) => student),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: { uid: 'admin-1', displayName: 'Admin User', role: 'admin' },
  }),
}));

vi.mock('../../lib/api/apiClient', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: mockLanguage }),
}));

vi.mock('../../lib/auth/staffTenure', () => ({
  calculateStaffTenure: vi.fn(),
}));

vi.mock('../../components/zalo/ZaloOAStatusPanel', () => ({
  ZaloOAStatusPanel: () => <div>Zalo status</div>,
}));

vi.mock('../../components/students/CreateStaffModal', () => ({
  CreateStaffModal: () => null,
}));

vi.mock('../../lib/audit/auditLog', () => ({
  logAuditActivity: vi.fn(),
}));

vi.mock('./AdminOverviewTab', () => ({
  AdminOverviewTab: ({
    activeStudentsCount,
    studentsCount,
  }: {
    activeStudentsCount: number;
    studentsCount: number;
  }) => (
    <div>
      Overview headcount: {activeStudentsCount}/{studentsCount}
    </div>
  ),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get:
          (_target, element: string) =>
          ({ children, ...props }: { children: React.ReactNode }) =>
            React.createElement(element, props, children),
      }
    ),
  };
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const defaultReadChannelImplementation = vi.mocked(readChannel).getMockImplementation();

describe('AdminDashboard staff profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (defaultReadChannelImplementation) {
      vi.mocked(readChannel).mockImplementation(defaultReadChannelImplementation);
    }
    mockLanguage = 'en';
    teacherCreatedAt = '2023-05-10T03:00:00.000Z';
    vi.mocked(calculateStaffTenure).mockReturnValue({
      years: 3,
      months: 2,
      days: 5,
    });
    vi.mocked(apiRequest).mockResolvedValue({ success: true });
    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
    document.body.style.cssText = '';
    document.documentElement.style.cssText = '';
  });

  it('opens a staff profile with email, phone, full name, and assigned class times', async () => {
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: /Staff/i }));
    fireEvent.click(
      await screen.findByRole('button', { name: /View staff profile for Ms\. Huynh Le/i })
    );

    const dialog = screen.getByRole('dialog', { name: /Ms\. Huynh Le/i });
    const profile = within(dialog);

    expect(dialog).toBeInTheDocument();
    expect(profile.getByText('huynhle.teacher@nancy.com')).toBeInTheDocument();
    expect(profile.getByText('Full name')).toBeInTheDocument();
    expect(profile.getByText('Phone')).toBeInTheDocument();
    expect(profile.getByText('0901234567')).toBeInTheDocument();
    expect(profile.getByText('Assigned classes')).toBeInTheDocument();
    expect(profile.getByText('G2 - Huynh Le')).toBeInTheDocument();
    expect(profile.getByText('Mon 17:30 - 19:00 | Wed 17:30 - 19:00')).toBeInTheDocument();
    expect(profile.getByText('01/06/2026 - 31/08/2026')).toBeInTheDocument();
    expect(profile.getByText('Advanced 6')).toBeInTheDocument();
    expect(profile.getByText('Tue 19:00 - 20:30 | Thu 19:00 - 20:30')).toBeInTheDocument();
    expect(profile.queryByText('Other Class')).not.toBeInTheDocument();
  });

  it('loads dashboard projection without broad student, user, class, or evaluation listeners', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(readChannel).toHaveBeenCalledWith('admin-dashboard-summary');
      expect(getStudentDirectory).toHaveBeenCalledOnce();
    });

    const collectionNames = vi.mocked(collection).mock.calls.map((call) => call[1]);
    expect(collectionNames).not.toEqual(
      expect.arrayContaining(['students', 'users', 'classes', 'evaluations'])
    );
  });

  it('reports the server summary rather than recollapsing the directory', async () => {
    // With no canonical headcount on the projection, the fallback is the
    // server's own summary. Collapsing the directory here would key on name,
    // date of birth, and contact — the fields a duplicated pair shares — so it
    // can only hide duplicates, never count around them.
    vi.mocked(readChannel).mockImplementation(async (channel: string) => {
      if (channel === 'audit-log') return { logs: [] } as any;
      if (channel !== 'admin-dashboard-summary') return {} as any;
      return {
        summary: {
          totalStudents: 468,
          activeStudents: 343,
          totalTeachers: 1,
          totalClasses: 3,
          activeClasses: 3,
        },
        students: [],
        evaluations: [],
        teachers: [],
        classes: [],
        classStudentCounts: {},
      } as any;
    });
    vi.mocked(getStudentDirectory).mockResolvedValueOnce({
      students: [
        {
          id: 'active',
          studentId: 'HS01',
          name: 'Active Student',
          dob: '2012-01-01',
          studentLifecycle: 'enrolled',
          enrollmentStatus: 'active',
        },
        {
          id: 'trial',
          studentId: 'HS02',
          name: 'Trial Student',
          dob: '2012-02-02',
          studentLifecycle: 'trial',
          enrollmentStatus: 'active',
        },
        {
          id: 'on-leave',
          studentId: 'HS03',
          name: 'On Leave Student',
          dob: '2012-03-03',
          studentLifecycle: 'enrolled',
          enrollmentStatus: 'on_leave',
        },
      ],
    } as Awaited<ReturnType<typeof getStudentDirectory>>);

    renderDashboard();

    expect(await screen.findByText('Overview headcount: 343/468')).toBeInTheDocument();
  });

  it('locks page scrolling while the staff profile is open', async () => {
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: /Staff/i }));
    fireEvent.click(
      await screen.findByRole('button', { name: /View staff profile for Ms\. Huynh Le/i })
    );

    await waitFor(() => {
      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.body.style.position).toBe('fixed');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(document.documentElement.style.overflow).toBe('');
      expect(document.body.style.overflow).toBe('');
      expect(document.body.style.position).toBe('');
    });
  });

  it('groups staff accounts by role and opens non-teacher staff profiles', async () => {
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: /Staff/i }));

    expect(await screen.findByRole('heading', { name: 'Teachers signed in' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Office' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Accounting' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /View staff profile for Front Desk/i }));

    const officeDialog = screen.getByRole('dialog', { name: /Front Desk/i });
    expect(within(officeDialog).getByText('frontdesk.office@nancy.com')).toBeInTheDocument();
    expect(within(officeDialog).getAllByText('Office')[0]).toBeInTheDocument();
    expect(within(officeDialog).getByText('System role')).toBeInTheDocument();
    expect(within(officeDialog).queryByText('Assigned classes')).not.toBeInTheDocument();
  });

  it('uses staff copy when adding an authorized staff email fails', async () => {
    mockLanguage = 'vi';
    const originalTeacherError = translations.vi.adminDashboard.teachersTab.errorAdd;
    translations.vi.adminDashboard.teachersTab.errorAdd = 'LEGACY_TEACHER_ERROR';
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('network'));

    try {
      renderDashboard();

      fireEvent.click(await screen.findByRole('button', { name: /Nhân viên/i }));
      const input = await screen.findByPlaceholderText('Nhập email nhân viên...');

      fireEvent.change(input, { target: { value: 'newstaff.teacher@nancy.com' } });
      await waitFor(() => {
        const button = screen.getByRole('button', { name: /Thêm/i });
        expect(button).not.toBeDisabled();
      });

      const form = (await screen.findByPlaceholderText('Nhập email nhân viên...')).closest(
        'form'
      ) as HTMLFormElement;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Lỗi khi thêm email. Vui lòng thử lại.');
      });
    } finally {
      translations.vi.adminDashboard.teachersTab.errorAdd = originalTeacherError;
    }
  });

  it.each(['Ms. Huynh Le', 'Front Desk', 'Finance Team', 'Lower Secondary Lead'])(
    'shows employment start date and seniority for %s',
    async (displayName) => {
      renderDashboard();

      fireEvent.click(await screen.findByRole('button', { name: /Staff/i }));
      fireEvent.click(
        await screen.findByRole('button', {
          name: `View staff profile for ${displayName}`,
        })
      );

      const dialog = screen.getByRole('dialog', { name: displayName });
      const profile = within(dialog);
      expect(profile.getByText('Start date')).toBeInTheDocument();
      expect(profile.getByText('10/05/2023')).toBeInTheDocument();
      expect(profile.getByText('Seniority')).toBeInTheDocument();
      expect(profile.getByText('3 years 2 months 5 days')).toBeInTheDocument();
    }
  );

  it('shows two unavailable values when createdAt is missing', async () => {
    teacherCreatedAt = undefined;
    vi.mocked(calculateStaffTenure).mockReturnValue(null);
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: /Staff/i }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: /View staff profile for Ms\. Huynh Le/i,
      })
    );

    const profile = within(screen.getByRole('dialog', { name: /Ms\. Huynh Le/i }));
    expect(profile.getByText('Start date')).toBeInTheDocument();
    expect(profile.getByText('Seniority')).toBeInTheDocument();
    expect(profile.getAllByText('Not available')).toHaveLength(2);
  });

  it('renders Vietnamese employment labels and duration', async () => {
    mockLanguage = 'vi';
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: /Nhân viên/i }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: /Xem hồ sơ nhân viên Ms\. Huynh Le/i,
      })
    );

    const profile = within(screen.getByRole('dialog', { name: /Ms\. Huynh Le/i }));
    expect(profile.getByText('Bắt đầu làm')).toBeInTheDocument();
    expect(profile.getByText('10/05/2023')).toBeInTheDocument();
    expect(profile.getByText('Thâm niên')).toBeInTheDocument();
    expect(profile.getByText('3 năm 2 tháng 5 ngày')).toBeInTheDocument();
  });

  it('no longer offers a payroll tab to admin', async () => {
    renderDashboard();

    expect(await screen.findByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payroll' })).not.toBeInTheDocument();
  });
});
