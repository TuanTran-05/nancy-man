// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { CENTER_LOGO_URL } from '../lib/brand';
import { Sidebar } from './Sidebar';

vi.mock('../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

vi.mock('./useProfileFaceUrl', () => ({
  useProfileFaceUrl: () => '',
}));

describe('Sidebar office navigation', () => {
  it('shows only office academic navigation items', () => {
    render(
      <MemoryRouter>
        <Sidebar
          isOpen={true}
          setIsOpen={vi.fn()}
          onSignOut={vi.fn()}
          profile={
            {
              uid: 'office-uid',
              role: 'office',
              displayName: 'Office',
              email: 'office@nancy.com',
            } as any
          }
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /Dashboard/i })).toHaveAttribute(
      'href',
      '/office-dashboard'
    );
    expect(screen.getByText('Class Management')).toBeDefined();
    expect(screen.getByText('Student Management')).toBeDefined();
    expect(screen.getByText('Teacher Management')).toBeDefined();
    expect(screen.queryByText('Teacher Attendance')).toBeNull();
    expect(screen.queryByText('Availability')).toBeNull();
    expect(screen.getByText('Academic')).toBeDefined();
    expect(screen.getByText('Admissions')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull();
    expect(screen.getByText('System')).toBeDefined();
    expect(screen.queryByText('Finance')).toBeNull();
    expect(screen.queryByText('Messages')).toBeNull();
    expect(screen.getByRole('link', { name: 'Course-closing archive' })).toHaveAttribute(
      'href',
      '/course-closing-records'
    );
  });

  it('keeps the footer profile card without rendering a profile nav link', () => {
    render(
      <MemoryRouter>
        <Sidebar
          isOpen={true}
          setIsOpen={vi.fn()}
          onSignOut={vi.fn()}
          profile={
            {
              uid: 'office-uid',
              role: 'office',
              displayName: 'Office Footer User',
              email: 'office@nancy.com',
            } as any
          }
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull();
    expect(screen.getByRole('link', { name: /Office Footer User/i })).toHaveAttribute(
      'href',
      '/profile'
    );
  });

  it('groups teacher pages under one Teacher Management item for admin and office', () => {
    const onSignOut = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <Sidebar
          isOpen={true}
          setIsOpen={vi.fn()}
          profile={{ role: 'admin', displayName: 'Admin' } as any}
          onSignOut={onSignOut}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /Teacher Management/i })).toHaveAttribute(
      'href',
      '/teachers'
    );
    expect(screen.queryByText('Teacher Attendance')).toBeNull();
    expect(screen.queryByText('Knowledge Bank')).toBeNull();
    expect(screen.queryByText('Substitute')).toBeNull();

    rerender(
      <MemoryRouter>
        <Sidebar
          isOpen={true}
          setIsOpen={vi.fn()}
          profile={{ role: 'office', displayName: 'Office' } as any}
          onSignOut={onSignOut}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /Teacher Management/i })).toHaveAttribute(
      'href',
      '/teachers'
    );
    expect(screen.queryByText('Teacher Attendance')).toBeNull();
  });

  it('keeps the Teacher Management item highlighted on grouped sub-pages', () => {
    render(
      <MemoryRouter initialEntries={['/teacher-attendance']}>
        <Sidebar
          isOpen={true}
          setIsOpen={vi.fn()}
          onSignOut={vi.fn()}
          profile={{ role: 'admin', displayName: 'Admin' } as any}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /Teacher Management/i }).className).toContain(
      'text-blue-600'
    );
  });
});

describe('Sidebar collapsed desktop behavior', () => {
  it('keeps a visible desktop toggle available after the sidebar is collapsed', async () => {
    const user = userEvent.setup();
    const setIsOpen = vi.fn();

    render(
      <MemoryRouter>
        <Sidebar
          isOpen={false}
          setIsOpen={setIsOpen}
          onSignOut={vi.fn()}
          profile={{ uid: 'office-uid', role: 'office', displayName: 'Office' } as any}
        />
      </MemoryRouter>
    );

    const toggle = screen.getByRole('button', { name: /expand sidebar/i });
    expect(toggle).not.toHaveClass('lg:hidden');

    await user.click(toggle);

    expect(setIsOpen).toHaveBeenCalledWith(true);
  });

  it('removes hidden label width from the collapsed desktop rail', () => {
    render(
      <MemoryRouter>
        <Sidebar
          isOpen={false}
          setIsOpen={vi.fn()}
          onSignOut={vi.fn()}
          profile={{ uid: 'office-uid', role: 'office', displayName: 'Office' } as any}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('EduTrack')).toHaveClass('lg:w-0');
    expect(screen.getByText('Sign Out')).toHaveClass('lg:w-0');
  });
});

describe('Sidebar accounting navigation', () => {
  it('hides the student directory while keeping accounting workflows', () => {
    render(
      <MemoryRouter>
        <Sidebar
          isOpen={true}
          setIsOpen={vi.fn()}
          onSignOut={vi.fn()}
          profile={
            {
              uid: 'accounting-uid',
              role: 'accounting',
              displayName: 'Accounting',
              email: 'accounting@nancy.com',
            } as any
          }
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Finance')).toBeDefined();
    expect(screen.getByText('Payroll')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Students' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tuition notice archive' })).toHaveAttribute(
      'href',
      '/course-closing-records'
    );
  });
});

describe('Sidebar availability navigation', () => {
  it('shows teacher availability navigation for teacher, admin, and office', () => {
    const onSignOut = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <Sidebar
          isOpen={true}
          setIsOpen={vi.fn()}
          profile={{ role: 'teacher', displayName: 'Teacher' } as any}
          onSignOut={onSignOut}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('Availability')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <Sidebar
          isOpen={true}
          setIsOpen={vi.fn()}
          profile={{ role: 'admin', displayName: 'Admin' } as any}
          onSignOut={onSignOut}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText('Availability')).toBeNull();

    rerender(
      <MemoryRouter>
        <Sidebar
          isOpen={true}
          setIsOpen={vi.fn()}
          profile={{ role: 'office', displayName: 'Office' } as any}
          onSignOut={onSignOut}
        />
      </MemoryRouter>
    );
    expect(screen.queryByText('Availability')).toBeNull();
  });

  it('shows print support for teacher and office but not admin', () => {
    const props = {
      isOpen: true,
      setIsOpen: vi.fn(),
      onSignOut: vi.fn(),
    };

    const { rerender } = render(
      <MemoryRouter>
        <Sidebar {...props} profile={{ uid: 'teacher-1', role: 'teacher' } as any} />
      </MemoryRouter>
    );
    expect(screen.getByText('Print Support')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <Sidebar
          {...props}
          profile={{ uid: 'office-1', role: 'office' } as any}
          pendingPrintRequests={4}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('Print Support')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <Sidebar {...props} profile={{ uid: 'admin-1', role: 'admin' } as any} />
      </MemoryRouter>
    );
    expect(screen.queryByText('Print Support')).not.toBeInTheDocument();
  });
});

describe('Sidebar branding', () => {
  it('shows the approved center logo', () => {
    render(
      <MemoryRouter>
        <Sidebar
          isOpen={true}
          setIsOpen={vi.fn()}
          onSignOut={vi.fn()}
          profile={{ role: 'admin', displayName: 'Admin' } as any}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('img', { name: 'Thiên Uy English Center' })).toHaveAttribute(
      'src',
      CENTER_LOGO_URL
    );
  });
});
