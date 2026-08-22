// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ZaloOA from './ZaloOA';
import { getZaloHistory, getZaloStatus, resendZaloHistoryEntry } from '../../lib/zalo/zaloService';

vi.mock('../../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: 'vi' }),
}));

vi.mock('../../lib/zalo/zaloService', () => ({
  getZaloHistory: vi.fn(),
  getZaloStatus: vi.fn(),
  resendZaloHistoryEntry: vi.fn(),
}));

vi.mock('../../components/zalo/ZaloManualSendPanel', () => ({
  ZaloManualSendPanel: ({ onSent }: { onSent: (logId?: string) => void }) => (
    <section data-testid="manual-send-panel">
      <button type="button" onClick={() => onSent('manual-log-1')}>
        Giả lập gửi thủ công
      </button>
    </section>
  ),
}));

vi.mock('../../components/zalo/ZaloBotManagementPanel', () => ({
  ZaloBotManagementPanel: () => (
    <section data-testid="zalo-bot-management-panel">Bot Management Panel Mock</section>
  ),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const failedLog = {
  id: 'log-1',
  type: 'evaluation_notice',
  status: 'failed',
  createdAt: '2026-08-11T08:00:00.000Z',
  studentId: 'student-1',
  studentName: 'NGUYỄN AN',
  classId: 'class-1',
  phone: '84901234567',
  errorMessage: 'Zalo error -124: Template parameters are invalid',
  canResend: true,
  templateId: 'eval-id',
  templateName: 'Nhận xét kết khóa',
  payloadCaptured: true,
  payloadSnapshot: {
    schemaVersion: 1 as const,
    templateId: 'eval-id',
    templateName: 'Nhận xét kết khóa',
    phone: '84901234567',
    templateData: { student_name: 'NGUYỄN AN', final_grade: 9 },
    capturedAt: '2026-08-11T08:00:00.000Z',
    redactedFields: [],
  },
};

describe('Admin Zalo OA history page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getZaloStatus).mockResolvedValue({ connected: true, configured: true });
    vi.mocked(getZaloHistory).mockResolvedValue({
      success: true,
      logs: [failedLog],
      page: { limit: 50, nextCursor: null, hasMore: false, scanned: 1 },
    });
    vi.mocked(resendZaloHistoryEntry).mockResolvedValue({ success: true, messageId: 'new-msg' });
  });

  it('shows the exact provider error for a failed delivery', async () => {
    render(<ZaloOA />);

    expect(await screen.findByText('NGUYỄN AN')).toBeDefined();
    expect(screen.getByText('Zalo error -124: Template parameters are invalid')).toBeDefined();
  });

  it('requires a reason and sends an administrator resend request', async () => {
    render(<ZaloOA />);
    await screen.findByText('NGUYỄN AN');

    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại' }));
    const dialog = screen.getByRole('dialog', { name: 'Xác nhận gửi lại qua Zalo OA' });
    expect(within(dialog).getByText('NGUYỄN AN')).toBeInTheDocument();
    expect(within(dialog).getByText('84901234567')).toBeInTheDocument();
    expect(within(dialog).getByText('Nhận xét kết khóa')).toBeInTheDocument();
    const confirmButton = within(dialog).getByRole('button', { name: 'Xác nhận gửi' });
    expect(confirmButton).toHaveProperty('disabled', true);

    fireEvent.change(within(dialog).getByLabelText('Lý do gửi lại'), {
      target: { value: 'Phụ huynh chưa nhận tin' },
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(resendZaloHistoryEntry).toHaveBeenCalledWith('log-1', 'Phụ huynh chưa nhận tin');
    });
    expect(vi.mocked(getZaloHistory).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the resend target and reason when the API rejects the resend', async () => {
    vi.mocked(resendZaloHistoryEntry).mockResolvedValueOnce({
      success: false,
      error: 'Provider rejected resend',
    });
    render(<ZaloOA />);
    await screen.findByText('NGUYỄN AN');

    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại' }));
    const dialog = screen.getByRole('dialog', { name: 'Xác nhận gửi lại qua Zalo OA' });
    const reason = within(dialog).getByLabelText('Lý do gửi lại');
    fireEvent.change(reason, { target: { value: 'Phụ huynh chưa nhận tin' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận gửi' }));

    await waitFor(() => {
      expect(
        within(screen.getByRole('dialog', { name: 'Xác nhận gửi lại qua Zalo OA' })).getByRole(
          'button',
          { name: 'Xác nhận gửi' }
        )
      ).not.toBeDisabled();
    });
    expect(
      screen.getByRole('dialog', { name: 'Xác nhận gửi lại qua Zalo OA' })
    ).toBeInTheDocument();
    expect(reason).toHaveValue('Phụ huynh chưa nhận tin');
  });

  it('places manual send above filters and refreshes history after a successful send', async () => {
    render(<ZaloOA />);
    await screen.findByText('NGUYỄN AN');
    const panel = screen.getByTestId('manual-send-panel');
    const search = screen.getByText('Tên, mã học sinh, SĐT, mã tin hoặc lỗi');
    expect(panel.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Giả lập gửi thủ công' }));
    await waitFor(() => expect(getZaloHistory).toHaveBeenCalledTimes(2));
  });

  it('shows exact captured variables when the arrow is expanded', async () => {
    render(<ZaloOA />);
    await screen.findByText('NGUYỄN AN');
    fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }));
    expect(screen.getByText('Nội dung đã gửi')).toBeDefined();
    expect(screen.getByText('student_name')).toBeDefined();
    expect(screen.getByText('9')).toBeDefined();
  });

  it('renders ZaloBotManagementPanel above ZaloManualSendPanel', async () => {
    render(<ZaloOA />);
    await screen.findByText('NGUYỄN AN');
    const botPanel = screen.getByTestId('zalo-bot-management-panel');
    const manualPanel = screen.getByTestId('manual-send-panel');
    expect(
      botPanel.compareDocumentPosition(manualPanel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
