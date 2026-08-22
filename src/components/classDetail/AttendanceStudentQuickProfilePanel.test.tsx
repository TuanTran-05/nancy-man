// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AttendanceStudentQuickProfileResponse } from '../../../shared/attendanceStudentQuickProfile';

vi.mock('../../lib/student/faceImage', () => ({
  resolveStudentFaceUrl: vi.fn().mockResolvedValue(''),
}));

import { AttendanceStudentQuickProfilePanel } from './AttendanceStudentQuickProfilePanel';

const student = { id: 'student-1', name: 'Nguyễn Minh Anh', studentId: 'HS-0248' } as any;
const profileData: AttendanceStudentQuickProfileResponse = {
  student: {
    ...student,
    classId: 'class-1',
    dob: '2014-04-15',
    contact: '0901234567',
    enrollmentStatus: 'active',
  },
  class: { id: 'class-1', name: 'Movers 2' },
  attendance: { attendedSessions: 18, totalSessions: 24 },
  finance: { hasLedgerData: true, totalPaid: 12_000_000, totalOutstanding: 3_000_000 },
  generatedAt: '2026-08-13T00:00:00.000Z',
};

const labels = {
  title: 'Hồ sơ học sinh',
  close: 'Đóng hồ sơ',
  retry: 'Thử lại',
  loading: 'Đang tải hồ sơ',
  unavailable: 'Không thể tải hồ sơ',
  currentClass: 'Lớp hiện tại',
  status: 'Trạng thái',
  statusActive: 'Đang học',
  statusOnLeave: 'Tạm nghỉ',
  statusDropped: 'Đã nghỉ',
  statusPromoted: 'Đã lên lớp',
  dob: 'Ngày sinh',
  gender: 'Giới tính',
  genderMale: 'Nam',
  genderFemale: 'Nữ',
  genderOther: 'Khác',
  contact: 'Liên hệ',
  statusNote: 'Ghi chú trạng thái',
  notProvided: 'Chưa cập nhật',
  attendance: 'Điểm danh khóa hiện tại',
  finance: 'Học phí',
  attendedSessions: '{attended} / {total} buổi',
  insufficientAttendance: 'Chưa đủ dữ liệu',
  totalPaid: 'Đã đóng',
  totalOutstanding: 'Còn nợ',
  noTuitionData: 'Chưa có dữ liệu học phí',
  edit: 'Sửa thông tin',
  changeStatus: 'Đổi trạng thái',
  editLoadError: 'Không thể tải dữ liệu để sửa học sinh',
  openProfileFor: 'Mở hồ sơ của {name}',
};

describe('AttendanceStudentQuickProfilePanel', () => {
  it('hides finance without permission even if the response contains it', () => {
    render(
      <AttendanceStudentQuickProfilePanel
        open
        student={student}
        data={profileData}
        loading={false}
        error={null}
        readOnly={false}
        canViewFinance={false}
        preparingEdit={false}
        labels={labels}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
      />
    );

    expect(screen.getByText(student.name)).toBeInTheDocument();
    expect(screen.getByText('18 / 24 buổi')).toBeInTheDocument();
    expect(screen.queryByText(labels.finance)).not.toBeInTheDocument();
    expect(screen.queryByText('12.000.000 ₫')).not.toBeInTheDocument();
    expect(screen.queryByText('3.000.000 ₫')).not.toBeInTheDocument();
  });

  it('renders profile, attendance and authorized aggregate finance', () => {
    render(
      <AttendanceStudentQuickProfilePanel
        open
        student={student}
        data={profileData}
        loading={false}
        error={null}
        readOnly={false}
        canViewFinance
        preparingEdit={false}
        labels={labels}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog', { name: 'Hồ sơ học sinh' })).toBeInTheDocument();
    expect(screen.getByText('Đang học')).toBeInTheDocument();
    expect(screen.getByText('18 / 24 buổi')).toBeInTheDocument();
    expect(screen.getByText('12.000.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('3.000.000 ₫')).toBeInTheDocument();
  });

  it('renders a skeleton without missing-data copy during the initial load', () => {
    render(
      <AttendanceStudentQuickProfilePanel
        open
        student={student}
        data={null}
        loading
        error={null}
        readOnly={false}
        canViewFinance
        preparingEdit={false}
        labels={labels}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
      />
    );

    expect(screen.getByTestId('attendance-student-profile-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(labels.insufficientAttendance)).toBeNull();
    expect(screen.queryAllByText(labels.notProvided)).toHaveLength(0);
  });

  it('localizes the finance section heading', () => {
    render(
      <AttendanceStudentQuickProfilePanel
        open
        student={student}
        data={profileData}
        loading={false}
        error={null}
        readOnly={false}
        canViewFinance
        preparingEdit={false}
        labels={{ ...labels, finance: 'Tuition' }}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
      />
    );

    expect(screen.getByText('Tuition')).toBeInTheDocument();
    expect(screen.queryByText('Học phí')).toBeNull();
  });

  it('does not render finance when the response omits it', () => {
    render(
      <AttendanceStudentQuickProfilePanel
        open
        student={student}
        data={{ ...profileData, finance: undefined }}
        loading={false}
        error={null}
        readOnly={false}
        canViewFinance
        preparingEdit={false}
        labels={labels}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
      />
    );
    expect(screen.queryByText('Đã đóng')).not.toBeInTheDocument();
    expect(screen.queryByText('Còn nợ')).not.toBeInTheDocument();
  });

  it('distinguishes unavailable data from confirmed zero values', () => {
    const { rerender } = render(
      <AttendanceStudentQuickProfilePanel
        open
        student={student}
        data={{
          ...profileData,
          attendance: null,
          finance: { hasLedgerData: false, totalPaid: 0, totalOutstanding: 0 },
        }}
        loading={false}
        error={null}
        readOnly={false}
        canViewFinance
        preparingEdit={false}
        labels={labels}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
      />
    );
    expect(screen.getByText('Chưa đủ dữ liệu')).toBeInTheDocument();
    expect(screen.getByText('Chưa có dữ liệu học phí')).toBeInTheDocument();

    rerender(
      <AttendanceStudentQuickProfilePanel
        open
        student={student}
        data={{
          ...profileData,
          attendance: { attendedSessions: 0, totalSessions: 0 },
          finance: { hasLedgerData: true, totalPaid: 0, totalOutstanding: 0 },
        }}
        loading={false}
        error={null}
        readOnly={false}
        canViewFinance
        preparingEdit={false}
        labels={labels}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
      />
    );
    expect(screen.getByText('0 / 0 buổi')).toBeInTheDocument();
    expect(screen.getAllByText('0 ₫')).toHaveLength(2);
  });

  it('renders retry without removing the dialog after a load error', () => {
    const onRetry = vi.fn();
    render(
      <AttendanceStudentQuickProfilePanel
        open
        student={student}
        data={null}
        loading={false}
        error="failed"
        readOnly={false}
        canViewFinance
        preparingEdit={false}
        labels={labels}
        onClose={vi.fn()}
        onRetry={onRetry}
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('closes from the mouse backdrop without putting the backdrop in the focus order', () => {
    const onClose = vi.fn();
    render(
      <AttendanceStudentQuickProfilePanel
        open
        student={student}
        data={profileData}
        loading={false}
        error={null}
        readOnly={false}
        canViewFinance
        preparingEdit={false}
        labels={labels}
        onClose={onClose}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
      />
    );
    const backdrop = screen.getByTestId('attendance-student-profile-backdrop');
    expect(backdrop.tagName).toBe('DIV');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides mutation actions in read-only history and closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <AttendanceStudentQuickProfilePanel
        open
        student={student}
        data={profileData}
        loading={false}
        error={null}
        readOnly
        canViewFinance
        preparingEdit={false}
        labels={labels}
        onClose={onClose}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Sửa thông tin' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('opens by keyboard and restores focus to the student name after closing', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Nguyễn Minh Anh
          </button>
          {open && (
            <AttendanceStudentQuickProfilePanel
              open
              student={student}
              data={profileData}
              loading={false}
              error={null}
              readOnly={false}
              canViewFinance
              preparingEdit={false}
              labels={labels}
              onClose={() => setOpen(false)}
              onRetry={vi.fn()}
              onEdit={vi.fn()}
              onChangeStatus={vi.fn()}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Nguyễn Minh Anh' });
    opener.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đóng hồ sơ' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
