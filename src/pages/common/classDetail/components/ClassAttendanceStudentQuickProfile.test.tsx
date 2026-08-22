// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ClassAttendanceStudentQuickProfile } from './ClassAttendanceStudentQuickProfile';

let capturedActionArgs: any = null;
const openEdit = vi.fn().mockResolvedValue(undefined);
const openStatus = vi.fn();

vi.mock('../../components/students/StudentActionModals', () => ({
  useStudentActionModals: (args: any) => {
    capturedActionArgs = args;
    return {
      controller: { openEdit, openStatus },
      modals: <div data-testid="student-modals">Modals</div>,
    };
  },
}));

const reload = vi.fn().mockResolvedValue(undefined);
const summary = {
  student: {
    id: 'student-1',
    name: 'Nguyễn Minh Anh',
    studentId: 'HS-0248',
    classId: 'class-1',
    dob: '2014-04-15',
    contact: '0901234567',
    enrollmentStatus: 'active',
  },
  class: { id: 'class-1', name: 'Movers 2' },
  attendance: { attendedSessions: 10, totalSessions: 12 },
  finance: {
    hasLedgerData: true,
    totalPaid: 12_000_000,
    totalOutstanding: 3_000_000,
  },
  generatedAt: '2026-08-13T00:00:00.000Z',
};

vi.mock('../../../../hooks/useAttendanceStudentQuickProfile', () => ({
  useAttendanceStudentQuickProfile: () => ({
    data: summary,
    loading: false,
    error: null,
    reload,
  }),
}));

vi.mock('../../../../lib/student/studentActionReferenceData', () => ({
  loadStudentEditReferenceData: vi.fn().mockResolvedValue({
    classes: [{ id: 'class-1' }],
    sortedClasses: [{ id: 'class-1' }],
    filterableClasses: [{ id: 'class-1' }],
    teachers: [],
  }),
}));

vi.mock('../../../../lib/student/faceImage', () => ({
  resolveStudentFaceUrl: vi.fn().mockResolvedValue(''),
}));

const student = { id: 'student-1', name: 'Nguyễn Minh Anh', studentId: 'HS-0248' } as any;
const classData = { id: 'class-1', name: 'Movers 2' } as any;

describe('ClassAttendanceStudentQuickProfile', () => {
  it('keeps profile and attendance visible but hides finance from office', () => {
    render(
      <ClassAttendanceStudentQuickProfile
        profile={{ uid: 'office-1', role: 'office' } as any}
        classData={classData}
        student={student}
        isArchived={false}
        isPaused={false}
        refreshStudents={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(student.name)).toBeInTheDocument();
    expect(screen.getByText('10 / 12 buổi')).toBeInTheDocument();
    expect(screen.queryByText('Học phí')).not.toBeInTheDocument();
    expect(screen.queryByText('12.000.000 ₫')).not.toBeInTheDocument();
    expect(screen.queryByText('3.000.000 ₫')).not.toBeInTheDocument();
  });

  it('opens edit modal with server student and triggers refresh on change', async () => {
    const refreshStudents = vi.fn().mockResolvedValue(undefined);
    render(
      <ClassAttendanceStudentQuickProfile
        profile={{ uid: 'admin-1', role: 'admin' } as any}
        classData={classData}
        student={student}
        isArchived={false}
        isPaused={false}
        refreshStudents={refreshStudents}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('12.000.000 ₫')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sửa thông tin' }));
    await waitFor(() =>
      expect(openEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          id: summary.student.id,
          name: summary.student.name,
          studentId: summary.student.studentId,
          classId: summary.student.classId,
          dob: summary.student.dob,
          contact: summary.student.contact,
        })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Đổi trạng thái' }));
    expect(openStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: summary.student.id, studentId: summary.student.studentId })
    );

    await act(async () => capturedActionArgs.onChanged());
    expect(refreshStudents).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
