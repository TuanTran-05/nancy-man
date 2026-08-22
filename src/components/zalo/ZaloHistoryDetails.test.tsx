// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ZaloHistoryEntry } from '../../lib/zalo/zaloService';
import { ZaloHistoryDetails } from './ZaloHistoryDetails';

const base: ZaloHistoryEntry = {
  id: 'log-1',
  type: 'manual',
  status: 'sent',
  createdAt: '2026-08-11T10:00:00.000Z',
  phone: '84901234567',
  templateId: 'eval-id',
  templateName: 'Nhận xét kết khóa',
  trackingId: 'manual_1_request',
  zaloMessageId: 'msg-1',
  providerErrorCode: -144,
  payloadCaptured: true,
  payloadSnapshot: {
    schemaVersion: 1,
    templateId: 'eval-id',
    templateName: 'Nhận xét kết khóa',
    phone: '84901234567',
    templateData: {
      student_name: 'Nguyễn An',
      final_grade: 9,
      pass_word: '[REDACTED]',
    },
    capturedAt: '2026-08-11T10:00:00.000Z',
    redactedFields: ['pass_word'],
  },
  sentByName: 'Admin Nancy',
  canResend: true,
};

describe('ZaloHistoryDetails', () => {
  it('shows exact stored variables and delivery metadata', () => {
    render(<ZaloHistoryDetails log={base} language="vi" />);
    expect(screen.getByText('Nhận xét kết khóa')).toBeDefined();
    expect(screen.getByText('student_name')).toBeDefined();
    expect(screen.getByText('Nguyễn An')).toBeDefined();
    expect(screen.getByText('9')).toBeDefined();
    expect(screen.getByText('[REDACTED]')).toBeDefined();
    expect(screen.getByText('Admin Nancy')).toBeDefined();
    expect(screen.getByText('manual_1_request')).toBeDefined();
    expect(screen.getByText('-144')).toBeDefined();
  });

  it('labels a legacy row instead of reconstructing content', () => {
    render(
      <ZaloHistoryDetails
        log={{ ...base, payloadCaptured: false, payloadSnapshot: undefined }}
        language="vi"
      />
    );
    expect(screen.getByText('Bản ghi cũ chưa lưu snapshot nội dung đã gửi.')).toBeDefined();
    expect(screen.queryByText('student_name')).toBeNull();
  });
});
