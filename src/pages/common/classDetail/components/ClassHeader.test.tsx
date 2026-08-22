// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ClassHeader } from './ClassHeader';

const baseProps = {
  classData: {
    id: 'class-1',
    name: 'E101',
    daysOfWeek: [],
    startDate: '',
    endDate: '',
  } as any,
  studentCount: 1,
  isOnline: true,
  isAdmin: false,
  canAddStudent: false,
  canManageClass: false,
  canUseTeachingTools: false,
  isArchived: false,
  isPaused: false,
  todayStr: '2026-05-26',
  onOpenResetCourse: vi.fn(),
  onOpenFaceAttendance: vi.fn(),
  onOpenDailyReport: vi.fn(),
  onAddStudent: vi.fn(),
};

function renderHeader(overrides: Partial<typeof baseProps> = {}) {
  return render(
    <MemoryRouter>
      <ClassHeader {...baseProps} {...overrides} />
    </MemoryRouter>
  );
}

describe('ClassHeader office academic access', () => {
  it('keeps teacher attendance and report actions hidden while retaining roster management', () => {
    renderHeader({ canAddStudent: true });

    expect(screen.queryByRole('button', { name: /Face Attendance/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Daily Report/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Add Student/i })).toBeDefined();
  });
});

describe('ClassHeader canAddStudent capability', () => {
  it('shows Add Student to admin when class roster creation is allowed', () => {
    renderHeader({ isAdmin: true, canAddStudent: true });
    expect(screen.getByRole('button', { name: /Add Student/i })).toBeInTheDocument();
  });

  it('hides Add Student for archived classes', () => {
    renderHeader({ canAddStudent: true, isArchived: true });
    expect(screen.queryByRole('button', { name: /Add Student/i })).toBeNull();
  });

  it('hides Add Student when canAddStudent is false', () => {
    renderHeader({ canAddStudent: false });
    expect(screen.queryByRole('button', { name: /Add Student/i })).toBeNull();
  });
});
