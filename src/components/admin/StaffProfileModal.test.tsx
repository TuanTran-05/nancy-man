// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffProfileModal } from './StaffProfileModal';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
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

const teacher = {
  uid: 'teacher-1',
  displayName: 'Mr. Quang Kiet',
  email: 'kiet.teacher@nancy.com',
  role: 'teacher' as const,
};

function renderModal(assignedClasses: Parameters<typeof StaffProfileModal>[0]['assignedClasses']) {
  return render(
    <MemoryRouter>
      <StaffProfileModal
        staff={teacher}
        assignedClasses={assignedClasses}
        language="en"
        onClose={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe('StaffProfileModal assigned classes', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
  });

  it('renders the complete identified class card as a class-detail link', () => {
    renderModal([
      {
        id: 'class-1',
        name: 'G8 - Mr. Kiet',
        daysOfWeek: [1],
        startTime: '17:15',
        schedule: '17:15 - 18:45',
        startDate: '2026-07-12',
        endDate: '2026-09-05',
      },
    ]);

    const link = screen.getByRole('link', { name: /G8 - Mr\. Kiet/i });
    expect(link).toHaveAttribute('href', '/classes/class-1');
    expect(within(link).getByText(/Mon 17:15 - 18:45/i)).toBeInTheDocument();
    expect(within(link).getByText('12/07/2026 - 05/09/2026')).toBeInTheDocument();
  });

  it('keeps a class without an id visible and non-interactive', () => {
    renderModal([{ name: 'Class without id' }]);

    expect(screen.getByText('Class without id')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Class without id/i })).not.toBeInTheDocument();
  });
});
