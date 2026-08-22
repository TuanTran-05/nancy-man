import { describe, expect, it } from 'vitest';
import {
  buildAdminResendBody,
  getZaloResendCapability,
  handleZaloHistory,
} from './adminHistoryHandlers.js';
import { createInMemoryDocumentStore } from '../../../../test-utils/inMemoryDocumentStore.js';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('Zalo admin resend policy', () => {
  it('allows an administrator to rebuild an evaluation resend from a history row', () => {
    const log = {
      type: 'evaluation_notice',
      studentId: 'student-1',
      classId: 'class-1',
      status: 'sent',
    };

    expect(getZaloResendCapability(log)).toEqual({ canResend: true });
    expect(buildAdminResendBody(log)).toEqual({ studentId: 'student-1', classId: 'class-1' });
  });

  it('supports retrying both successful and failed payment deliveries when receipt evidence exists', () => {
    for (const status of ['sent', 'failed']) {
      const log = { type: 'payment', status, receiptNo: 'PT-2026-001', studentId: 'student-1' };
      expect(getZaloResendCapability(log).canResend).toBe(true);
      expect(buildAdminResendBody(log)).toEqual({ receiptNo: 'PT-2026-001' });
    }
  });

  it('blocks replaying one-time secrets from OTP and staff credential history', () => {
    expect(getZaloResendCapability({ type: 'otp_password_reset' })).toMatchObject({
      canResend: false,
    });
    expect(getZaloResendCapability({ type: 'staff-credentials' })).toMatchObject({
      canResend: false,
    });
  });

  it('explains when legacy history lacks identifiers required for a safe resend', () => {
    expect(getZaloResendCapability({ type: 'evaluation_notice', studentId: 'student-1' })).toEqual({
      canResend: false,
      reason: 'Bản ghi cũ không có mã lớp để dựng lại nội dung.',
    });
  });

  it('allows manual resend only when the immutable phone and payload snapshot exist', () => {
    const source = {
      type: 'manual',
      phone: '84901234567',
      templateId: 'eval-id',
      payloadCaptured: true,
      payloadSnapshot: {
        schemaVersion: 1,
        templateId: 'eval-id',
        phone: '84901234567',
        templateData: { student_name: 'Nguyễn An' },
        capturedAt: '2026-08-11T10:00:00.000Z',
        redactedFields: [],
      },
    };
    expect(getZaloResendCapability(source)).toEqual({ canResend: true });
    expect(buildAdminResendBody(source)).toEqual({
      templateId: 'eval-id',
      phone: '84901234567',
      templateData: { student_name: 'Nguyễn An' },
    });
    expect(getZaloResendCapability({ type: 'manual', phone: '84901234567' }).canResend).toBe(false);
  });

  it('returns filtered history with exact provider errors and resend capability', async () => {
    const { db } = createInMemoryDocumentStore({
      'zalo_notifications/sent-1': {
        type: 'absence',
        status: 'sent',
        createdAt: '2026-08-11T08:00:00.000Z',
        studentId: 'student-1',
        classId: 'class-1',
        date: '2026-08-11',
      },
      'zalo_notifications/failed-1': {
        type: 'evaluation_notice',
        status: 'failed',
        createdAt: '2026-08-11T09:00:00.000Z',
        studentId: 'student-2',
        studentName: 'NGUYỄN AN',
        classId: 'class-2',
        errorMessage: 'Zalo -124: invalid template parameters',
        providerErrorCode: -124,
        templateName: 'Nhận xét kết khóa',
        templateTag: 'CUSTOMER_CARE',
        templatePreviewUrl: 'https://account.zalo.solutions/preview/eval-id',
        trackingId: 'manual_1_request',
        payloadCaptured: true,
        payloadSnapshot: {
          schemaVersion: 1,
          templateId: 'eval-id',
          templateName: 'Nhận xét kết khóa',
          phone: '84901234567',
          templateData: { student_name: 'NGUYỄN AN', final_grade: 9 },
          capturedAt: '2026-08-11T09:00:00.000Z',
          redactedFields: [],
        },
        sentBy: 'admin-1',
        sentByName: 'Admin Nancy',
      },
    });
    const res = mockRes();

    await handleZaloHistory(
      { method: 'GET', query: { status: 'failed', limit: '50' } } as any,
      res,
      db as any,
      { uid: 'admin-1', role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.logs).toEqual([
      expect.objectContaining({
        id: 'failed-1',
        status: 'failed',
        errorMessage: 'Zalo -124: invalid template parameters',
        providerErrorCode: -124,
        canResend: true,
        payloadCaptured: true,
        trackingId: 'manual_1_request',
        payloadSnapshot: expect.objectContaining({
          templateData: { student_name: 'NGUYỄN AN', final_grade: 9 },
        }),
        sentByName: 'Admin Nancy',
      }),
    ]);
  });

  it('joins migrated history to student and class references before searching and projecting', async () => {
    const { db } = createInMemoryDocumentStore({
      'zalo_notifications/sent-1': {
        type: 'absence',
        status: 'sent',
        createdAt: '2026-08-19T08:00:00.000Z',
        studentId: 'student-1',
        classId: 'class-1',
        phone: '84900000000',
        date: '2026-08-19',
      },
      'students/student-1': {
        name: 'NGUYỄN VĂN AN',
        code: 'HS260001',
      },
      'classes/class-1': {
        name: 'Flyers 1',
      },
    });
    const res = mockRes();

    await handleZaloHistory(
      { method: 'GET', query: { search: 'nguyễn văn an', limit: '50' } } as any,
      res,
      db as any,
      { uid: 'admin-1', role: 'admin', name: 'Admin' }
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.logs).toEqual([
      expect.objectContaining({
        id: 'sent-1',
        studentName: 'NGUYỄN VĂN AN',
        studentCode: 'HS260001',
        className: 'Flyers 1',
      }),
    ]);
  });

  it('uses a unique student phone for legacy manual history without a student id', async () => {
    const { db } = createInMemoryDocumentStore({
      'zalo_notifications/manual-1': {
        type: 'manual',
        status: 'sent',
        createdAt: '2026-08-19T09:00:00.000Z',
        phone: '84901234567',
      },
      'students/student-1': {
        name: 'TRẦN THỊ BÌNH',
        code: 'HS260002',
        contact: '0901 234 567',
      },
    });
    const res = mockRes();

    await handleZaloHistory(
      { method: 'GET', query: { search: 'trần thị bình', limit: '50' } } as any,
      res,
      db as any,
      { uid: 'admin-1', role: 'admin', name: 'Admin' }
    );

    expect(res.body.logs).toEqual([
      expect.objectContaining({
        id: 'manual-1',
        studentName: 'TRẦN THỊ BÌNH',
        studentCode: 'HS260002',
      }),
    ]);
  });

  it('does not guess a student when a phone number is shared', async () => {
    const { db } = createInMemoryDocumentStore({
      'zalo_notifications/manual-1': {
        type: 'manual',
        status: 'sent',
        createdAt: '2026-08-19T09:00:00.000Z',
        phone: '84901234567',
      },
      'students/student-1': { name: 'Student One', contact: '0901234567' },
      'students/student-2': { name: 'Student Two', contact: '0901234567' },
    });
    const res = mockRes();

    await handleZaloHistory(
      { method: 'GET', query: { limit: '50' } } as any,
      res,
      db as any,
      { uid: 'admin-1', role: 'admin', name: 'Admin' }
    );

    expect(res.body.logs[0]).toMatchObject({
      id: 'manual-1',
      studentName: '',
      studentCode: '',
    });
  });
});
