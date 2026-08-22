import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getZaloManualTemplateDetail,
  getZaloManualTemplates,
  isValidVNPhone,
  sendZaloManualMessage,
  sendZaloTuitionReminderNotification,
} from './zaloService';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('isValidVNPhone', () => {
  it('should accept valid phone starting with 0', () => {
    expect(isValidVNPhone('0912345678')).toBe(true);
  });

  it('should accept valid phone starting with +84', () => {
    expect(isValidVNPhone('+84912345678')).toBe(true);
  });

  it('should accept valid phone starting with 84', () => {
    expect(isValidVNPhone('84912345678')).toBe(true);
  });

  it('should accept phone with spaces', () => {
    expect(isValidVNPhone('0912 345 678')).toBe(true);
  });

  it('should accept phone with dashes', () => {
    expect(isValidVNPhone('0912-345-678')).toBe(true);
  });

  it('should accept phone with dots', () => {
    expect(isValidVNPhone('0912.345.678')).toBe(true);
  });

  it('should accept phone with parentheses', () => {
    expect(isValidVNPhone('(0912) 345 678')).toBe(true);
  });

  it('should reject empty string', () => {
    expect(isValidVNPhone('')).toBe(false);
  });

  it('should reject too short number', () => {
    expect(isValidVNPhone('091234567')).toBe(false);
  });

  it('should reject too long number', () => {
    expect(isValidVNPhone('09123456789')).toBe(false);
  });

  it('should accept 0-prefix with any digit sequence (10 digits total)', () => {
    expect(isValidVNPhone('0123456789')).toBe(true);
  });

  it('should reject non-numeric characters', () => {
    expect(isValidVNPhone('0abcdefghi')).toBe(false);
  });

  it('should reject +84 with wrong length', () => {
    expect(isValidVNPhone('+8491234567')).toBe(false);
  });
});

describe('sendZaloTuitionReminderNotification', () => {
  it('preserves the server error code when the reminder request is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            success: false,
            error: 'Student has no outstanding tuition debt',
            errorCode: 'TUITION_DEBT_EMPTY',
          }),
      })
    );

    await expect(sendZaloTuitionReminderNotification({ studentId: 'student-1' })).resolves.toEqual({
      success: false,
      error: 'Student has no outstanding tuition debt',
      errorCode: 'TUITION_DEBT_EMPTY',
    });
  });
});

describe('Zalo admin manual APIs', () => {
  it('loads templates and selected detail with auth headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, templates: [], source: 'zalo' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            template: { templateId: 'eval-id', templateName: 'Nhận xét', listParams: [] },
          }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await getZaloManualTemplates();
    await getZaloManualTemplateDetail('eval-id');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/zalo/admin-templates',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest' }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/zalo/admin-template-detail?templateId=eval-id',
      expect.any(Object)
    );
  });

  it('posts the manual payload unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, messageId: 'msg-1', logId: 'log-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const input = {
      templateId: 'eval-id',
      phone: '0901234567',
      templateData: { student_name: 'Nguyễn An' },
      clientRequestId: 'request-1',
    };

    await expect(sendZaloManualMessage(input)).resolves.toMatchObject({
      success: true,
      logId: 'log-1',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });
});
