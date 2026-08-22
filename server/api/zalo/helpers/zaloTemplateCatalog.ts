import type { ZaloTemplateDetail, ZaloTemplateParam } from '../../../../shared/zaloAdmin.js';
import {
  forceRefreshAccessToken,
  getValidAccessToken,
  getZaloConfig,
} from '../../lib/zalo/zaloHelper.js';

const DETAIL_URL = 'https://business.openapi.zalo.me/template/info/v2';
const CACHE_MS = 5 * 60 * 1000;

const detailCache = new Map<string, { expiresAt: number; value: ZaloTemplateDetail }>();

function param(name: string, type = 'STRING', maxLength = 100, minLength = 1): ZaloTemplateParam {
  return { name, require: true, type, minLength, maxLength, acceptNull: false };
}

function configuredFallbacks(): ZaloTemplateDetail[] {
  const cfg = getZaloConfig();
  const definitions: Array<{
    id: string;
    name: string;
    params: ZaloTemplateParam[];
  }> = [
    {
      id: cfg.znsTemplateId,
      name: 'Thông báo vắng học',
      params: [
        param('student_name', 'STRING', 40),
        param('student_id', 'STRING', 30),
        param('address'),
        param('date', 'STRING', 20),
      ],
    },
    {
      id: cfg.znsEvalTemplateId,
      name: 'Nhận xét kết khóa',
      params: [
        param('student_name', 'STRING', 40),
        param('student_code', 'STRING', 30),
        param('course_end_date', 'STRING', 30),
        param('final_grade', 'STRING', 20),
        param('good', 'STRING', 500),
        param('bad', 'STRING', 500),
      ],
    },
    {
      id: cfg.znsRankTemplateId,
      name: 'Thông báo thành tích',
      params: [
        param('student_name', 'STRING', 40),
        param('student_code', 'STRING', 30),
        param('rank', 'STRING', 30),
        param('discount', 'STRING', 30),
      ],
    },
    {
      id: cfg.znsPaymentTemplateId,
      name: 'Xác nhận thanh toán',
      params: [
        param('ten_hoc_vien', 'STRING', 40),
        param('ma_hoc_vien', 'STRING', 30),
        param('ten_khoa_hoc'),
        param('so_tien', 'NUMBER', 15),
        param('ma_giao_dich', 'STRING', 40),
        param('ngay_thanh_toan', 'STRING', 20),
      ],
    },
    {
      id: cfg.znsTuitionNoticeTemplateId,
      name: 'Nhắc học phí',
      params: [
        param('student_name', 'STRING', 40),
        param('student_code', 'STRING', 30),
        param('amount', 'NUMBER', 15),
        param('semester', 'STRING', 50),
        param('due_date', 'STRING', 20),
      ],
    },
    {
      id: cfg.znsNextCourseTuitionTemplateId,
      name: 'Học phí khóa tiếp theo',
      params: [
        param('student_name', 'STRING', 40),
        param('student_code', 'STRING', 30),
        param('previous_end_date', 'STRING', 20),
        param('start_date', 'STRING', 20),
        param('end_date', 'STRING', 20),
        param('amount', 'NUMBER', 15),
        param('due_date', 'STRING', 20),
      ],
    },
  ];

  return Array.from(
    new Map(definitions.filter((item) => item.id).map((item) => [item.id, item])).values()
  ).map((item) => ({
    templateId: item.id,
    templateName: item.name,
    status: 'ENABLE',
    templateQuality: 'UNDEFINED',
    source: 'configured' as const,
    listParams: item.params,
  }));
}

async function requestJson(url: string, fetchImpl: typeof fetch) {
  const request = async (token: string) =>
    (
      await fetchImpl(url, { headers: { 'Content-Type': 'application/json', access_token: token } })
    ).json();
  const token = await getValidAccessToken();
  if (!token) throw new Error('Không có access token Zalo hợp lệ.');
  let body = await request(token);
  if (body.error === -124 || body.error === -401) {
    const freshToken = await forceRefreshAccessToken();
    if (freshToken) body = await request(freshToken);
  }
  return body as { error: number; message?: string; data?: unknown };
}

export function clearZaloTemplateCatalogCache() {
  detailCache.clear();
}

export function isConfiguredAdminManualTemplate(templateId: string) {
  return configuredFallbacks().some((template) => template.templateId === templateId);
}

export async function listAdminZaloTemplates() {
  return {
    templates: configuredFallbacks().map(({ listParams: _listParams, ...summary }) => summary),
    source: 'configured' as const,
  };
}

export async function getAdminZaloTemplateDetail(
  templateId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ZaloTemplateDetail> {
  const cached = detailCache.get(templateId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const body = await requestJson(
      `${DETAIL_URL}?template_id=${encodeURIComponent(templateId)}`,
      fetchImpl
    );
    if (body.error !== 0 || !body.data || typeof body.data !== 'object') {
      throw new Error(body.message || `Zalo template API error ${body.error}`);
    }
    const raw = body.data as any;
    const value: ZaloTemplateDetail = {
      templateId: String(raw.templateId || templateId),
      templateName: String(raw.templateName || templateId),
      status: String(raw.status || ''),
      templateQuality: String(raw.templateQuality || 'UNDEFINED'),
      source: 'zalo',
      listParams: Array.isArray(raw.listParams) ? raw.listParams : [],
      previewUrl: typeof raw.previewUrl === 'string' ? raw.previewUrl : undefined,
      templateTag: typeof raw.templateTag === 'string' ? raw.templateTag : undefined,
      priceSdt: raw.price_sdt == null ? undefined : String(raw.price_sdt),
    };
    detailCache.set(templateId, { expiresAt: Date.now() + CACHE_MS, value });
    return value;
  } catch (error) {
    const fallback = configuredFallbacks().find((item) => item.templateId === templateId);
    if (fallback) return fallback;
    throw error;
  }
}
