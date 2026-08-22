// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getZaloManualTemplateDetail,
  getZaloManualTemplates,
  sendZaloManualMessage,
} from '../../lib/zalo/zaloService';
import { ZaloManualSendPanel } from './ZaloManualSendPanel';

vi.mock('../../lib/zalo/zaloService', () => ({
  getZaloManualTemplates: vi.fn(),
  getZaloManualTemplateDetail: vi.fn(),
  sendZaloManualMessage: vi.fn(),
  isValidVNPhone: (phone: string) => /^(0|84)\d{9}$/.test(phone),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

describe('ZaloManualSendPanel', () => {
  const longFeedback =
    'Learner completed the assigned work independently and applied the lesson knowledge consistently in class activities.';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getZaloManualTemplates).mockResolvedValue({
      success: true,
      source: 'zalo',
      templates: [
        {
          templateId: 'eval-id',
          templateName: 'Nhận xét kết khóa',
          status: 'ENABLE',
          templateQuality: 'HIGH',
          source: 'zalo',
        },
      ],
    });
    vi.mocked(getZaloManualTemplateDetail).mockResolvedValue({
      success: true,
      template: {
        templateId: 'eval-id',
        templateName: 'Nhận xét kết khóa',
        status: 'ENABLE',
        templateQuality: 'HIGH',
        source: 'zalo',
        templateTag: 'CUSTOMER_CARE',
        priceSdt: '300',
        previewUrl: 'https://account.zalo.solutions/preview/eval-id',
        listParams: [
          {
            name: 'student_name',
            require: true,
            type: 'STRING',
            minLength: 1,
            maxLength: 40,
            acceptNull: false,
          },
          {
            name: 'final_grade',
            require: true,
            type: 'NUMBER',
            minLength: 1,
            maxLength: 5,
            acceptNull: false,
          },
          {
            name: 'good',
            require: true,
            type: 'STRING',
            minLength: 1,
            maxLength: 500,
            acceptNull: false,
          },
        ],
      },
    });
    vi.mocked(sendZaloManualMessage).mockResolvedValue({
      success: true,
      messageId: 'msg-1',
      logId: 'log-1',
    });
  });

  it('builds fields from template params, previews values, and sends after confirmation', async () => {
    const onSent = vi.fn();
    render(<ZaloManualSendPanel language="vi" onSent={onSent} />);
    fireEvent.change(await screen.findByLabelText('Template'), { target: { value: 'eval-id' } });
    await screen.findByLabelText('student_name');
    fireEvent.change(screen.getByLabelText('good'), { target: { value: longFeedback } });
    fireEvent.change(screen.getByLabelText('final_grade'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('student_name'), { target: { value: 'Nguyen An' } });
    fireEvent.change(screen.getByLabelText('Số điện thoại người nhận'), {
      target: { value: '0901234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra nội dung' }));

    const dialog = screen.getByRole('dialog', {
      name: /Confirm manual send|Xác nhận gửi thủ công/,
    });
    expect(within(dialog).getByText('Nguyen An')).toBeDefined();
    expect(screen.getByText('0901234567')).toBeDefined();
    expect(within(dialog).getByText(longFeedback)).toBeDefined();
    const studentLabel = within(dialog).getByText('student_name');
    const gradeLabel = within(dialog).getByText('final_grade');
    const feedbackLabel = within(dialog).getByText('good');
    expect(
      studentLabel.compareDocumentPosition(gradeLabel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      gradeLabel.compareDocumentPosition(feedbackLabel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirm send|Xác nhận gửi/ }));

    await waitFor(() => {
      expect(sendZaloManualMessage).toHaveBeenCalledWith({
        templateId: 'eval-id',
        phone: '0901234567',
        templateData: { student_name: 'Nguyen An', final_grade: '9', good: longFeedback },
        clientRequestId: expect.any(String),
      });
    });
    expect(onSent).toHaveBeenCalledWith('log-1');
  });

  it('keeps the populated review open when sending fails', async () => {
    vi.mocked(sendZaloManualMessage).mockResolvedValueOnce({
      success: false,
      error: 'Zalo provider rejected the request',
    });
    render(<ZaloManualSendPanel language="vi" onSent={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('Template'), { target: { value: 'eval-id' } });
    await screen.findByLabelText('student_name');
    fireEvent.change(screen.getByLabelText('student_name'), { target: { value: 'Nguyen An' } });
    fireEvent.change(screen.getByLabelText('final_grade'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('good'), { target: { value: longFeedback } });
    fireEvent.change(screen.getByLabelText(/Recipient phone|Số điện thoại người nhận/), {
      target: { value: '0901234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Review message|Kiểm tra nội dung/ }));
    const dialog = screen.getByRole('dialog', {
      name: /Confirm manual send|Xác nhận gửi thủ công/,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirm send|Xác nhận gửi/ }));

    await waitFor(() => {
      expect(
        within(
          screen.getByRole('dialog', { name: /Confirm manual send|Xác nhận gửi thủ công/ })
        ).getByRole('button', { name: /Confirm send|Xác nhận gửi/ })
      ).not.toBeDisabled();
    });
    expect(
      within(
        screen.getByRole('dialog', { name: /Confirm manual send|Xác nhận gửi thủ công/ })
      ).getByText(longFeedback)
    ).toBeInTheDocument();
  });

  it('keeps review disabled until required fields and phone are valid', async () => {
    render(<ZaloManualSendPanel language="vi" onSent={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Template'), { target: { value: 'eval-id' } });
    await screen.findByLabelText('student_name');
    expect(screen.getByRole('button', { name: 'Kiểm tra nội dung' })).toHaveProperty(
      'disabled',
      true
    );
  });
});
