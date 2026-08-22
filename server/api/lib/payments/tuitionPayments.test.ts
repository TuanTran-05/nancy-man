import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getZaloConfig, sendZaloZNSMessage } from '../zalo/zaloHelper.js';
import { sendServerPaymentConfirmation } from './tuitionPayments.js';

vi.mock('../zalo/zaloHelper.js', () => ({
  getZaloConfig: vi.fn(),
  sendZaloZNSMessage: vi.fn(),
}));

const payload = {
  phone: '0901234567',
  studentName: 'Nguyễn An',
  studentCode: 'HV001',
  coursePeriod: 'Movers 08/2026',
  amount: 1_250_000,
  receiptNo: 'PT-20260811-001',
  paymentDate: '11/08/2026',
  studentId: 'student-1',
  classId: 'class-1',
  className: 'Movers',
  receivedDate: '2026-08-11',
};

describe('sendServerPaymentConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getZaloConfig).mockReturnValue({
      appId: 'app-id',
      appSecret: 'app-secret',
      znsPaymentTemplateId: 'payment-template',
    } as any);
  });

  it('stores the exact normalized payment payload and provider error code', async () => {
    vi.mocked(sendZaloZNSMessage).mockResolvedValue({
      success: false,
      error: 'OA quota exceeded',
      errorCode: -144,
    });
    const add = vi.fn().mockResolvedValue(undefined);
    const db = { collection: vi.fn(() => ({ add })) };

    await sendServerPaymentConfirmation(db as any, payload);

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'payment',
        phone: '84901234567',
        templateId: 'payment-template',
        providerErrorCode: -144,
        payloadCaptured: true,
        payloadSnapshot: expect.objectContaining({
          schemaVersion: 1,
          templateId: 'payment-template',
          phone: '84901234567',
          templateData: {
            ten_hoc_vien: 'Nguyễn An',
            ma_hoc_vien: 'HV001',
            ten_khoa_hoc: 'Movers 08/2026',
            so_tien: 1_250_000,
            ma_giao_dich: 'PT-20260811-001',
            ngay_thanh_toan: '11/08/2026',
          },
        }),
      })
    );
  });

  it('marks the log as uncaptured when no provider request was made', async () => {
    vi.mocked(getZaloConfig).mockReturnValue({
      appId: 'app-id',
      appSecret: 'app-secret',
      znsPaymentTemplateId: '',
    } as any);
    const add = vi.fn().mockResolvedValue(undefined);
    const db = { collection: vi.fn(() => ({ add })) };

    await sendServerPaymentConfirmation(db as any, payload);

    expect(sendZaloZNSMessage).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ payloadCaptured: false }));
    expect(add.mock.calls[0][0]).not.toHaveProperty('payloadSnapshot');
  });
});
