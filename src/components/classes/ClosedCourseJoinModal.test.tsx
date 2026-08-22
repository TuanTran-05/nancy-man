// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClosedCourseJoinModal } from './ClosedCourseJoinModal';

const endedWindow = {
  termStart: '2026-01-05',
  termEnd: '2026-03-31',
  isClosed: true,
  closedReason: 'term_ended' as const,
};

function renderModal(overrides: Partial<React.ComponentProps<typeof ClosedCourseJoinModal>> = {}) {
  const onConfirmCurrentTerm = vi.fn();
  const onClose = vi.fn();
  render(
    <ClosedCourseJoinModal
      isOpen
      className="Toán 9A"
      window={endedWindow}
      isBusy={false}
      onConfirmCurrentTerm={onConfirmCurrentTerm}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onConfirmCurrentTerm, onClose };
}

describe('ClosedCourseJoinModal', () => {
  it('offers both courses before anything is chosen', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /Khóa hiện tại/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Khóa sau/ })).toBeTruthy();
  });

  it('names the class and the date the course ended', () => {
    renderModal();
    expect(screen.getByText(/Toán 9A/)).toBeTruthy();
    expect(screen.getByText(/2026-03-31/)).toBeTruthy();
  });

  it('keeps confirm disabled until the date sits inside the term', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Khóa hiện tại/ }));
    expect((screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement).disabled).toBe(
      true
    );

    fireEvent.change(screen.getByLabelText(/Ngày vào học/), {
      target: { value: '2026-04-15' },
    });
    expect((screen.getByRole('button', { name: 'Xác nhận' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('passes a valid date back to the caller', () => {
    const { onConfirmCurrentTerm } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Khóa hiện tại/ }));
    fireEvent.change(screen.getByLabelText(/Ngày vào học/), {
      target: { value: '2026-02-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(onConfirmCurrentTerm).toHaveBeenCalledWith('2026-02-10');
  });

  it('shows reset-course instructions without confirming the next course', () => {
    const { onConfirmCurrentTerm } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Khóa sau/ }));
    expect(screen.getByText(/Đặt lại khóa học/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
    expect(onConfirmCurrentTerm).not.toHaveBeenCalled();
  });

  it('explains an approved closing when the dates have not passed', () => {
    renderModal({
      window: {
        termStart: '2026-07-01',
        termEnd: '2026-09-30',
        isClosed: true,
        closedReason: 'closing_completed',
      },
    });
    expect(screen.getByText(/đã được duyệt kết khóa/)).toBeTruthy();
  });

  it('names only a lower bound for an open term', () => {
    renderModal({
      window: {
        termStart: '2026-07-01',
        termEnd: null,
        isClosed: true,
        closedReason: 'closing_completed',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Khóa hiện tại/ }));
    expect(screen.getByText('Chọn ngày từ 2026-07-01 trở đi.')).toBeTruthy();
  });
});
