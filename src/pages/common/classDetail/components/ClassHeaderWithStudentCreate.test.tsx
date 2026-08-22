// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { uid: 'admin-1' } },
}));

vi.mock('../../../../lib/api/apiClient', () => ({
  apiRequest: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: { div: (p: any) => <div {...p} /> },
}));

vi.mock('../../../../components/common/ModalPortal', () => ({
  ModalPortal: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../../../hooks/useCameraCapture', () => ({
  useCameraCapture: () => ({
    videoRef: { current: null },
    isCameraActive: false,
    stream: null,
    startCamera: vi.fn(),
    stopCamera: vi.fn(),
    capturePhoto: vi.fn(),
  }),
}));

vi.mock('../../../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}));

import { ClassHeaderWithStudentCreate } from './ClassHeaderWithStudentCreate';

const activeClass = {
  id: 'class-active',
  name: 'Toán 8A',
  startDate: '2026-01-05',
  endDate: '2026-12-31',
  daysOfWeek: [],
  description: '',
  startTime: '',
  teacherId: 'teacher-1',
  status: 'active' as const,
  createdAt: '2026-01-05T00:00:00.000Z',
};

const headerProps = {
  classData: activeClass as any,
  studentCount: 5,
  isOnline: true,
  isAdmin: false,
  canAddStudent: true,
  canManageClass: false,
  canUseTeachingTools: false,
  isArchived: false,
  isPaused: false,
  todayStr: '2026-08-13',
  onOpenResetCourse: vi.fn(),
  onOpenFaceAttendance: vi.fn(),
  onOpenDailyReport: vi.fn(),
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

describe('ClassHeaderWithStudentCreate', () => {
  it('opens fixed-class student creation without changing the class URL', () => {
    render(
      <MemoryRouter initialEntries={['/classes/class-active']}>
        <ClassHeaderWithStudentCreate
          {...headerProps}
          classData={activeClass as any}
          isAdmin={true}
          canAddStudent={true}
          onStudentsChanged={vi.fn()}
        />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Add Student/i }));

    expect(screen.getByRole('heading', { name: /Thêm học sinh/i })).toBeInTheDocument();
    expect(screen.getAllByText(activeClass.name)).toHaveLength(2);
    expect(screen.getByTestId('pathname')).toHaveTextContent('/classes/class-active');
  });
});
