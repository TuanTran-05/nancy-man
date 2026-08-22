import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendZaloZNSMessage, getZaloConfig } from '../../lib/zalo/zaloHelper.js';
import { writeAuditLog } from '../../lib/logging/auditLog.js';
import { enforceZaloSendGuard, markZaloSendRecord } from '../helpers/zaloBaseHelpers.js';
import {
  getAdminZaloTemplateDetail,
  isConfiguredAdminManualTemplate,
  listAdminZaloTemplates,
} from '../helpers/zaloTemplateCatalog.js';
import {
  handleAdminZaloManualSend,
  handleAdminZaloTemplateDetail,
  handleAdminZaloTemplates,
} from './adminManualSendHandlers.js';

vi.mock('../../lib/zalo/zaloHelper.js', () => ({
  sendZaloZNSMessage: vi.fn(),
  getZaloConfig: vi.fn(),
}));
vi.mock('../../lib/logging/auditLog.js', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
  writeAuditLog: vi.fn(),
}));
vi.mock('../helpers/zaloBaseHelpers.js', () => ({
  enforceZaloSendGuard: vi.fn(),
  markZaloSendRecord: vi.fn(),
  rateLimitKeyPart: (value: string) => value.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 160),
}));
vi.mock('../helpers/zaloTemplateCatalog.js', () => ({
  listAdminZaloTemplates: vi.fn(),
  getAdminZaloTemplateDetail: vi.fn(),
  isConfiguredAdminManualTemplate: vi.fn(),
}));

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

function makeDb() {
  const logSet = vi.fn().mockResolvedValue(undefined);
  const logUpdate = vi.fn().mockResolvedValue(undefined);
  const logRef = { id: 'manual-log-1', set: logSet, update: logUpdate };
  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'zalo_notifications') return { doc: vi.fn(() => logRef) };
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
  return { db, logSet, logUpdate };
}

const actor = { uid: 'admin-1', role: 'admin', name: 'Admin Nancy' };
const detail = {
  templateId: 'eval-id',
  templateName: 'Nhận xét',
  status: 'ENABLE',
  templateQuality: 'HIGH',
  source: 'zalo' as const,
  templateTag: 'CUSTOMER_CARE',
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
  ],
};

describe('admin Zalo manual send handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getZaloConfig).mockReturnValue({
      appId: 'app',
      appSecret: 'secret',
      oaId: 'oa',
      znsTemplateId: 'absence-id',
      znsOtpTemplateId: 'otp-id',
      znsEvalTemplateId: 'eval-id',
      znsStaffTemplateId: 'staff-id',
      znsPaymentTemplateId: 'payment-id',
      znsTuitionNoticeTemplateId: 'tuition-id',
      znsNextCourseTuitionTemplateId: 'next-id',
      znsRankTemplateId: 'rank-id',
      initialAccessToken: '',
      refreshToken: '',
    });
    vi.mocked(getAdminZaloTemplateDetail).mockResolvedValue(detail);
    vi.mocked(isConfiguredAdminManualTemplate).mockReturnValue(true);
    vi.mocked(enforceZaloSendGuard).mockResolvedValue('send');
    vi.mocked(sendZaloZNSMessage).mockResolvedValue({ success: true, messageId: 'msg-1' });
    vi.mocked(writeAuditLog).mockResolvedValue(true);
  });

  it('returns the admin template list', async () => {
    vi.mocked(listAdminZaloTemplates).mockResolvedValue({
      templates: [detail],
      source: 'configured',
    });
    const res = mockRes();
    await handleAdminZaloTemplates({ method: 'GET' } as any, res, actor);
    expect(res.body.success).toBe(true);
    expect(res.body.templates[0].templateId).toBe('eval-id');
  });

  it('returns selected template detail', async () => {
    const res = mockRes();
    await handleAdminZaloTemplateDetail(
      { method: 'GET', query: { templateId: 'eval-id' } } as any,
      res,
      actor
    );
    expect(res.body.template).toEqual(detail);
  });

  it('rejects template detail outside the configured manual list', async () => {
    vi.mocked(isConfiguredAdminManualTemplate).mockReturnValue(false);
    const res = mockRes();
    await handleAdminZaloTemplateDetail(
      { method: 'GET', query: { templateId: 'old-template-id' } } as any,
      res,
      actor
    );
    expect(res.statusCode).toBe(403);
    expect(getAdminZaloTemplateDetail).not.toHaveBeenCalled();
  });

  it('creates a sending log before calling Zalo and then records success', async () => {
    const { db, logSet, logUpdate } = makeDb();
    const res = mockRes();
    await handleAdminZaloManualSend(
      {
        method: 'POST',
        body: {
          templateId: 'eval-id',
          phone: '0901234567',
          templateData: { student_name: 'Nguyễn An' },
          clientRequestId: 'request-1',
        },
        headers: { 'user-agent': 'vitest' },
      } as any,
      res,
      db as any,
      actor
    );

    expect(logSet.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sendZaloZNSMessage).mock.invocationCallOrder[0]
    );
    expect(sendZaloZNSMessage).toHaveBeenCalledWith(
      'eval-id',
      { student_name: 'Nguyễn An' },
      '84901234567',
      expect.stringMatching(/^manual_\d{13}_request-1$/)
    );
    expect(logUpdate).toHaveBeenCalledWith({
      status: 'sent',
      zaloMessageId: 'msg-1',
      errorMessage: '',
      completedAt: expect.any(String),
    });
    expect(res.body).toMatchObject({ success: true, messageId: 'msg-1', logId: 'manual-log-1' });
  });

  it('rejects a sensitive configured template before creating a log', async () => {
    vi.mocked(getAdminZaloTemplateDetail).mockResolvedValue({ ...detail, templateId: 'otp-id' });
    const { db, logSet } = makeDb();
    const res = mockRes();
    await handleAdminZaloManualSend(
      {
        method: 'POST',
        body: {
          templateId: 'otp-id',
          phone: '0901234567',
          templateData: {},
          clientRequestId: 'r2',
        },
      } as any,
      res,
      db as any,
      actor
    );
    expect(res.statusCode).toBe(403);
    expect(logSet).not.toHaveBeenCalled();
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('rejects manual sends outside the configured template list', async () => {
    vi.mocked(isConfiguredAdminManualTemplate).mockReturnValue(false);
    const { db, logSet } = makeDb();
    const res = mockRes();
    await handleAdminZaloManualSend(
      {
        method: 'POST',
        body: {
          templateId: 'old-template-id',
          phone: '0901234567',
          templateData: {},
          clientRequestId: 'r-unconfigured',
        },
      } as any,
      res,
      db as any,
      actor
    );
    expect(res.statusCode).toBe(403);
    expect(getAdminZaloTemplateDetail).not.toHaveBeenCalled();
    expect(logSet).not.toHaveBeenCalled();
    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
  });

  it('records provider failure in the same log document', async () => {
    vi.mocked(sendZaloZNSMessage).mockResolvedValue({
      success: false,
      error: 'Hết quota',
      errorCode: -144,
    });
    const { db, logUpdate } = makeDb();
    const res = mockRes();
    await handleAdminZaloManualSend(
      {
        method: 'POST',
        body: {
          templateId: 'eval-id',
          phone: '0901234567',
          templateData: { student_name: 'Nguyễn An' },
          clientRequestId: 'request-3',
        },
        headers: {},
      } as any,
      res,
      db as any,
      actor
    );
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Hết quota',
        providerErrorCode: -144,
      })
    );
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ errorCode: -144, logId: 'manual-log-1' });
  });
});
