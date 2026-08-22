import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getZaloConfig, getValidAccessToken } from '../../lib/zalo/zaloHelper.js';
import {
  clearZaloTemplateCatalogCache,
  getAdminZaloTemplateDetail,
  isConfiguredAdminManualTemplate,
  listAdminZaloTemplates,
} from './zaloTemplateCatalog.js';

vi.mock('../../lib/zalo/zaloHelper.js', () => ({
  getValidAccessToken: vi.fn(),
  forceRefreshAccessToken: vi.fn(),
  getZaloConfig: vi.fn(),
}));

const jsonResponse = (body: unknown) =>
  Promise.resolve({ json: async () => body }) as Promise<Response>;

describe('Zalo template catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearZaloTemplateCatalogCache();
    vi.mocked(getValidAccessToken).mockResolvedValue('access-token');
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
      znsNextCourseTuitionTemplateId: 'next-course-id',
      znsRankTemplateId: 'rank-id',
      initialAccessToken: '',
      refreshToken: '',
    });
  });

  it('lists only safe templates configured on the VPS', async () => {
    const result = await listAdminZaloTemplates();

    expect(result.source).toBe('configured');
    expect(result.templates.map((item) => item.templateId)).toEqual([
      'absence-id',
      'eval-id',
      'rank-id',
      'payment-id',
      'tuition-id',
      'next-course-id',
    ]);
    expect(isConfiguredAdminManualTemplate('eval-id')).toBe(true);
    expect(isConfiguredAdminManualTemplate('otp-id')).toBe(false);
    expect(isConfiguredAdminManualTemplate('staff-id')).toBe(false);
    expect(isConfiguredAdminManualTemplate('old-template-id')).toBe(false);
    expect(getValidAccessToken).not.toHaveBeenCalled();
  });

  it('loads detail fields used to build the dynamic form', async () => {
    const fetchImpl = vi.fn(() =>
      jsonResponse({
        error: 0,
        data: {
          templateId: 'eval-id',
          templateName: 'Nhận xét',
          status: 'ENABLE',
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
          previewUrl: 'https://account.zalo.solutions/preview/eval-id',
          templateTag: 'CUSTOMER_CARE',
          price_sdt: '300',
        },
      })
    );

    const result = await getAdminZaloTemplateDetail('eval-id', fetchImpl as typeof fetch);

    expect(result.templateName).toBe('Nhận xét');
    expect(result.listParams[0].name).toBe('student_name');
    expect(result.priceSdt).toBe('300');
  });

  it('falls back to configured detail when template management is unavailable', async () => {
    const fetchImpl = vi.fn(() => jsonResponse({ error: -138, message: 'Permission denied' }));

    const result = await getAdminZaloTemplateDetail('eval-id', fetchImpl as typeof fetch);

    expect(result.source).toBe('configured');
    expect(result.templateId).toBe('eval-id');
    expect(result.listParams.map((item) => item.name)).toContain('student_name');
  });
});
