// @vitest-environment jsdom
import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedRoutes } from './AnimatedRoutes';

const adminProfile = { uid: 'admin-uid', role: 'admin', displayName: 'Admin' } as any;
const officeProfile = { uid: 'office-uid', role: 'office', displayName: 'Office' } as any;
const accountingProfile = {
  uid: 'accounting-uid',
  role: 'accounting',
  displayName: 'Accounting',
} as any;
let mockedUser: any = { uid: officeProfile.uid };
let mockedProfile: any = officeProfile;

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockedUser,
    profile: mockedProfile,
    loading: false,
  }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

vi.mock('../components/common/PageTransition', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../pages/login/Login', () => ({
  default: () => <div>Login Page</div>,
}));

vi.mock('../pages/common/Classes', () => ({
  default: () => <div>Classes Page</div>,
}));

vi.mock('../pages/common/Students', () => ({
  default: () => <div>Students Page</div>,
}));

vi.mock('../pages/common/Dashboard', () => ({
  default: () => <div>Dashboard Page</div>,
}));

vi.mock('../pages/admin/AdminDashboard', () => ({
  default: () => <div>Admin Dashboard Page</div>,
}));

vi.mock('../pages/office/Admissions', () => ({
  default: () => <div>Admissions Page</div>,
}));

vi.mock('../pages/office/Academic', () => ({
  default: () => <div>Academic Page</div>,
}));

vi.mock('../pages/office/OfficeDashboard', () => ({
  default: () => <div>Office Dashboard Page</div>,
}));

vi.mock('../pages/accounting/Payroll', () => ({
  default: () => <div>Payroll Page</div>,
}));

vi.mock('../pages/accounting/Finance', () => ({
  default: () => <div>Finance Page</div>,
}));

vi.mock('../pages/common/TeacherAvailability', () => ({
  default: () => <div>Teacher Availability Page</div>,
}));

vi.mock('../pages/common/BlockDevToolPage', () => ({
  default: () => <h1>Oops! Ban vua cham vao DevTools</h1>,
}));

vi.mock('../pages/common/StudentProfilePage', () => ({
  default: () => <div>Student Profile Page</div>,
}));

vi.mock('../pages/common/PrintSupport', () => ({
  default: () => <div>Print Support Page</div>,
}));

vi.mock('../pages/office/Teachers', () => ({
  default: () => <div>Teachers Page</div>,
}));

vi.mock('../pages/common/SubstituteRequests', () => ({
  default: () => <div>Substitute Requests Page</div>,
}));

vi.mock('../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

vi.mock('../pages/common/AssignmentAuthoringWorkbench', () => ({
  default: ({ profile }: { profile: { role?: string } | null }) => (
    <div>Advanced Assignment Workbench for {profile?.role || 'unknown'}</div>
  ),
}));

vi.mock('../features/course-closing-records/pages/CourseClosingRecordsPage', () => ({
  CourseClosingRecordsPage: ({ userRole }: { userRole: string }) => (
    <div>Course closing archive for {userRole}</div>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <div data-testid="location-probe">
      {location.pathname}|{navigationType}
    </div>
  );
}

describe('AnimatedRoutes block dev tool route', () => {
  beforeEach(() => {
    mockedUser = { uid: officeProfile.uid };
    mockedProfile = officeProfile;
  });

  it('renders the blockdevtool page for authenticated users', async () => {
    const teacherProfile = { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher' } as any;
    mockedUser = { uid: 'teacher-1' };
    mockedProfile = teacherProfile;

    render(
      <MemoryRouter initialEntries={['/blockdevtool']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'teacher-1' }} profile={teacherProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: /DevTools/i })).toBeInTheDocument();
  });

  it('renders the blockdevtool page before login', async () => {
    mockedUser = null;
    mockedProfile = null;

    render(
      <MemoryRouter initialEntries={['/blockdevtool']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={null} profile={null} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: /DevTools/i })).toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });
});

describe('AnimatedRoutes office access', () => {
  beforeEach(() => {
    mockedUser = { uid: officeProfile.uid };
    mockedProfile = officeProfile;
  });

  it('allows office staff to reach academic classes', async () => {
    render(
      <MemoryRouter initialEntries={['/classes']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'office-uid' }} profile={officeProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Classes Page')).toBeDefined();
  });

  it('allows office staff to reach the academic page', async () => {
    render(
      <MemoryRouter initialEntries={['/academic']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'office-uid' }} profile={officeProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Academic Page')).toBeDefined();
  });

  it('redirects office staff to the office dashboard from the root route', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'office-uid' }} profile={officeProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Office Dashboard Page')).toBeDefined();
  });

  it('allows office staff to reach the office dashboard route', async () => {
    render(
      <MemoryRouter initialEntries={['/office-dashboard']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'office-uid' }} profile={officeProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Office Dashboard Page')).toBeDefined();
  });
});

describe('AnimatedRoutes course-closing archive access', () => {
  it.each([
    ['admin', adminProfile],
    ['office', officeProfile],
    ['accounting', accountingProfile],
  ])('allows %s to access the archive', async (role, profile) => {
    mockedUser = { uid: profile.uid };
    mockedProfile = profile;

    render(
      <MemoryRouter initialEntries={['/course-closing-records']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={mockedUser} profile={profile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText(`Course closing archive for ${role}`)).toBeInTheDocument();
  });

  it('blocks teachers from the archive', async () => {
    const teacherProfile = {
      uid: 'teacher-1',
      role: 'teacher',
      displayName: 'Teacher',
    } as any;
    mockedUser = { uid: teacherProfile.uid };
    mockedProfile = teacherProfile;

    render(
      <MemoryRouter initialEntries={['/course-closing-records']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={mockedUser} profile={teacherProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Dashboard Page')).toBeInTheDocument();
    expect(screen.queryByText(/Course closing archive for/)).not.toBeInTheDocument();
  });
});

describe('AnimatedRoutes advanced assignment access', () => {
  it('allows teachers to create advanced assignment drafts', async () => {
    const teacherProfile = { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher' } as any;
    mockedProfile = teacherProfile;

    render(
      <MemoryRouter initialEntries={['/assignments/advanced/new']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'teacher-1' }} profile={teacherProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Advanced Assignment Workbench for teacher')).toBeDefined();
  });

  it('allows teachers to resume existing advanced assignment drafts', async () => {
    const teacherProfile = { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher' } as any;
    mockedProfile = teacherProfile;

    render(
      <MemoryRouter initialEntries={['/assignments/advanced/draft-123']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'teacher-1' }} profile={teacherProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Advanced Assignment Workbench for teacher')).toBeDefined();
  });

  it.each([
    ['student', 'Dashboard Page'],
    ['admin', 'Admin Dashboard Page'],
  ])('blocks %s users from the advanced assignment workbench', async (role, fallbackText) => {
    const profile = { uid: `${role}-1`, role, displayName: role } as any;
    mockedProfile = profile;

    render(
      <MemoryRouter initialEntries={['/assignments/advanced/new']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: `${role}-1` }} profile={profile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText(fallbackText)).toBeDefined();
    expect(screen.queryByText(/Advanced Assignment/)).not.toBeInTheDocument();
  });
});

describe('AnimatedRoutes accounting access', () => {
  it('allows accounting staff to reach full teacher payroll', async () => {
    mockedProfile = accountingProfile;

    render(
      <MemoryRouter initialEntries={['/payroll']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'accounting-uid' }} profile={accountingProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Payroll Page')).toBeDefined();
  });

  it('redirects legacy accounting students to the accounting finance workspace', async () => {
    mockedUser = { uid: 'accounting-uid' };
    mockedProfile = accountingProfile;

    render(
      <MemoryRouter initialEntries={['/accounting/students']}>
        <LocationProbe />
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'accounting-uid' }} profile={accountingProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Finance Page')).toBeDefined();
    expect(screen.getByTestId('location-probe').textContent).toBe('/tuition|REPLACE');
  });

  it('redirects accounting staff from the shared students route to finance', async () => {
    mockedUser = { uid: 'accounting-uid' };
    mockedProfile = accountingProfile;

    render(
      <MemoryRouter initialEntries={['/students']}>
        <LocationProbe />
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'accounting-uid' }} profile={accountingProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Finance Page')).toBeDefined();
    expect(screen.getByTestId('location-probe').textContent).toBe('/tuition|REPLACE');
  });
});

describe('AnimatedRoutes student profile routes', () => {
  beforeEach(() => {
    mockedUser = { uid: adminProfile.uid };
    mockedProfile = adminProfile;
  });

  it('redirects the legacy student report route to the Student 360 page with replace', async () => {
    render(
      <MemoryRouter initialEntries={['/students/stu-1/report']}>
        <LocationProbe />
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'admin-uid' }} profile={adminProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Student Profile Page')).toBeDefined();
    expect(screen.getByTestId('location-probe').textContent).toBe('/students/stu-1|REPLACE');
  });
});

describe('AnimatedRoutes teacher availability access', () => {
  it('allows office staff to reach teacher availability', async () => {
    mockedProfile = officeProfile;
    render(
      <MemoryRouter initialEntries={['/teacher-availability']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'office-uid' }} profile={officeProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Teacher Availability Page')).toBeDefined();
  });

  it('allows teachers to reach teacher availability', async () => {
    const teacherProfile = { uid: 'teacher-uid', role: 'teacher', displayName: 'Teacher' } as any;
    mockedProfile = teacherProfile;
    render(
      <MemoryRouter initialEntries={['/teacher-availability']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'teacher-uid' }} profile={teacherProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Teacher Availability Page')).toBeDefined();
  });
});

describe('AnimatedRoutes print support access', () => {
  it('allows teachers to reach print support', async () => {
    const teacherProfile = { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher' } as any;
    mockedProfile = teacherProfile;
    render(
      <MemoryRouter initialEntries={['/print-support']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'teacher-1' }} profile={teacherProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Print Support Page')).toBeDefined();
  });

  it('allows office to reach print support', async () => {
    const officeProfile = { uid: 'office-1', role: 'office', displayName: 'Office' } as any;
    mockedProfile = officeProfile;
    render(
      <MemoryRouter initialEntries={['/print-support']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'office-1' }} profile={officeProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Print Support Page')).toBeDefined();
  });

  it('does not allow admin to reach print support', async () => {
    const adminProfile = { uid: 'admin-1', role: 'admin', displayName: 'Admin' } as any;
    mockedProfile = adminProfile;
    render(
      <MemoryRouter initialEntries={['/print-support']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'admin-1' }} profile={adminProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Admin Dashboard Page')).toBeDefined();
    expect(screen.queryByText('Print Support Page')).not.toBeInTheDocument();
  });
});

describe('AnimatedRoutes management tabs', () => {
  it('shows teacher management tabs for admin on /teachers', async () => {
    const adminProfile = { uid: 'admin-1', role: 'admin', displayName: 'Admin' } as any;
    mockedUser = { uid: 'admin-1' };
    mockedProfile = adminProfile;

    render(
      <MemoryRouter initialEntries={['/teachers']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'admin-1' }} profile={adminProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Teachers Page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Teacher Attendance' })).toHaveAttribute(
      'href',
      '/teacher-attendance'
    );
    expect(screen.getByRole('link', { name: 'Availability' })).toHaveAttribute(
      'href',
      '/teacher-availability'
    );
  });

  it('shows class management tabs for admin on /substitute-requests', async () => {
    const adminProfile = { uid: 'admin-1', role: 'admin', displayName: 'Admin' } as any;
    mockedUser = { uid: 'admin-1' };
    mockedProfile = adminProfile;

    render(
      <MemoryRouter initialEntries={['/substitute-requests']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'admin-1' }} profile={adminProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Substitute Requests Page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Knowledge Bank' })).toHaveAttribute(
      'href',
      '/knowledge-bank'
    );
  });

  it('does not show tabs for teacher role on /substitute-requests', async () => {
    const teacherProfile = { uid: 'teacher-1', role: 'teacher', displayName: 'Teacher' } as any;
    mockedUser = { uid: 'teacher-1' };
    mockedProfile = teacherProfile;

    render(
      <MemoryRouter initialEntries={['/substitute-requests']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'teacher-1' }} profile={teacherProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Substitute Requests Page')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Knowledge Bank' })).not.toBeInTheDocument();
  });

  it('does not show class tabs for office on /classes', async () => {
    mockedUser = { uid: officeProfile.uid };
    mockedProfile = officeProfile;

    render(
      <MemoryRouter initialEntries={['/classes']}>
        <Suspense fallback={<div>Loading</div>}>
          <AnimatedRoutes user={{ uid: 'office-uid' }} profile={officeProfile} />
        </Suspense>
      </MemoryRouter>
    );

    expect(await screen.findByText('Classes Page')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Knowledge Bank' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Substitute' })).not.toBeInTheDocument();
  });
});
