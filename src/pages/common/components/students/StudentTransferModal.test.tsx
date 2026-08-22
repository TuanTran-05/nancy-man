// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transferStudentMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, rolloverBalance: 0 }))
);

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
}));
vi.mock('../../../../components/common/ModalPortal', () => ({
  ModalPortal: ({ children }: any) => <>{children}</>,
}));
vi.mock('../../../../lib/api/studentAdminApi', () => ({
  transferStudent: transferStudentMock,
}));

import { StudentTransferModal } from './StudentTransferModal';

const endedClass = {
  id: 'class-ended',
  name: 'Toán 8B',
  schedule: '',
  daysOfWeek: [],
  description: '',
  startDate: '2026-01-05',
  endDate: '2026-03-31',
  startTime: '',
  teacherId: 'teacher-1',
  status: 'active' as const,
  createdAt: '2026-01-05T00:00:00.000Z',
};
const runningClass = {
  ...endedClass,
  id: 'class-open',
  name: 'Toán 9A',
  endDate: '2026-09-30',
};
const student = { id: 'stu-1', name: 'Học Sinh', classId: 'class-old' } as any;

function renderTransfer(targetClass: typeof endedClass) {
  render(
    <StudentTransferModal
      isOpen
      onClose={vi.fn()}
      studentToTransfer={student}
      targetClassId={targetClass.id}
      setTargetClassId={vi.fn()}
      isTransferring={false}
      setIsTransferring={vi.fn()}
      classes={[targetClass]}
      filterableClasses={[targetClass]}
      teachers={[]}
      setStudents={vi.fn()}
      tc={{ cancel: 'Hủy' }}
    />
  );
}

describe('StudentTransferModal closed course guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-05-26T03:00:00.000Z'));
    localStorage.setItem('language', 'vi');
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('asks for a valid join date before transferring into an ended class', async () => {
    renderTransfer(endedClass);
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận Chuyển lớp/ }));

    expect(transferStudentMock).not.toHaveBeenCalled();
    expect(screen.getByText('Lớp đã kết khóa')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Khóa hiện tại/ }));
    fireEvent.change(screen.getByLabelText('Ngày vào học'), {
      target: { value: '2026-02-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() =>
      expect(transferStudentMock).toHaveBeenCalledWith('stu-1', 'class-ended', '2026-02-10')
    );
  });

  it('transfers directly for a running class', async () => {
    renderTransfer(runningClass);
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận Chuyển lớp/ }));
    await waitFor(() =>
      expect(transferStudentMock).toHaveBeenCalledWith('stu-1', 'class-open', undefined)
    );
    expect(screen.queryByText('Lớp đã kết khóa')).toBeNull();
  });
});
