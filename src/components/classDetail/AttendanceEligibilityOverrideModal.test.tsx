// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AttendanceEligibilityOverrideModal } from './AttendanceEligibilityOverrideModal';

vi.mock('../../lib/i18n/useLanguage', async () => {
  const { translations } = await import('../../lib/i18n/translations');
  return {
    useLanguage: () => ({ language: 'vi', t: translations.vi }),
  };
});

describe('AttendanceEligibilityOverrideModal', () => {
  it('validates reason length 3-500 and submits payload on confirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <AttendanceEligibilityOverrideModal
        isOpen={true}
        studentName="Nguyen Minh Anh"
        date="2026-05-10"
        eligibility="not_enrolled"
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    // Try submit empty
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận điểm danh ngoại lệ/i }));
    expect(screen.getByText(/Vui lòng nhập lý do từ 3 đến 500 ký tự/i)).toBeDefined();
    expect(onConfirm).not.toHaveBeenCalled();

    // Type valid reason
    fireEvent.change(screen.getByLabelText(/Lý do ngoại lệ/i), {
      target: { value: ' Học sinh tham gia riêng buổi này ' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Xác nhận điểm danh ngoại lệ/i }));

    expect(onConfirm).toHaveBeenCalledWith({
      status: 'present',
      reason: 'Học sinh tham gia riêng buổi này',
    });
  });
});
