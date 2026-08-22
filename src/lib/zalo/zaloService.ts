/**
 * Zalo OA Service — Client-side utility
 * Gọi API backend để gửi thông báo qua Zalo OA
 *
 * Template 1: Thông báo vắng học — placeholders: student_name, student_id, address, date
 * Template 2: Thư nhận xét kết khóa — placeholders: student_name, student_code, course_end_date, final_grade, good, bad
 */

import { isValidVNPhone, normalizePhoneVN } from '../../../shared/phone';
import type {
  ZaloManualSendRequest,
  ZaloManualSendResponse,
  ZaloPayloadSnapshot,
  ZaloTemplateDetail,
  ZaloTemplateDetailResponse,
  ZaloTemplateListResponse,
} from '../../../shared/zaloAdmin';

export { isValidVNPhone, normalizePhoneVN } from '../../../shared/phone';
export type {
  ZaloManualSendRequest,
  ZaloManualSendResponse,
  ZaloPayloadSnapshot,
  ZaloTemplateDetail,
  ZaloTemplateParam,
  ZaloTemplateSummary,
} from '../../../shared/zaloAdmin';

const API_BASE = '/api/v1/zalo';

async function getAuthHeaders(): Promise<Record<string, string>> {
  return { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
}

// ─── Payload Types ───────────────────────────────────────────────────────────

/** Template 1: Thông báo vắng học */
interface ZaloAbsencePayload {
  studentId: string;
  studentName: string;
  studentCode: string; // Mã học viên → <student_id>
  className: string;
  classId: string;
  address: string; // Địa điểm học → <address>
  teacherId: string;
  phone: string;
  date: string; // Ngày học → <date>
}

interface ZaloRankAchievementPayload {
  studentId: string;
  classId: string;
}

interface ZaloEvaluationPayload {
  studentId: string;
  classId: string;
}

/** Template 4: Xác nhận thanh toán */
interface ZaloPaymentConfirmPayload {
  phone: string;
  studentName: string; // ten_hoc_vien
  studentCode: string; // ma_hoc_vien
  coursePeriod: string; // ten_khoa_hoc — e.g. "8/5/2026 - 10/5/2026"
  amount: number; // so_tien — raw number
  receiptNo: string; // ma_giao_dich
  paymentDate: string; // ngay_thanh_toan — "dd/mm/yyyy"
  // Optional fields for server-side notification logging
  studentId?: string;
  classId?: string;
  className?: string;
  receivedDate?: string;
}

type ZaloTuitionReminderPayload =
  | { studentId: string; ledgerId?: never; paymentDueDate?: string }
  | { ledgerId: string; studentId?: never; courseEndDate?: string; paymentDueDate?: string };

interface ZaloTuitionNoticePayload {
  ledgerId?: string;
  studentId?: string;
  classId?: string;
}

/** Template 3: Staff credentials */
interface ZaloStaffCredentialsPayload {
  phone: string;
  staffName: string;
  email: string;
  password: string;
}

interface ZaloNotifyResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  alreadySent?: boolean;
  tuitionSent?: boolean;
  tuitionAlreadySent?: boolean;
  tuitionMessageId?: string;
  tuitionError?: string;
  tuitionAmount?: number;
  tuitionDueDate?: string;
  tuitionReminderCount?: number;
  tuitionNoticeCount?: number;
  semester?: string;
  ledgerIds?: string[];
  errorCode?: string;
}

export interface ZaloSendCountResponse {
  success: boolean;
  allowed: boolean;
  currentCount: number;
  max: number;
  error?: string;
}

export interface ZaloLogSummaryResponse {
  success: boolean;
  logs: Array<{
    id: string;
    type?: string;
    status?: string;
    createdAt?: string;
    date?: string;
    classId?: string;
    studentId?: string;
    studentName?: string;
    phone?: string;
    phoneMasked?: string;
    errorMessage?: string;
  }>;
  error?: string;
}

export interface ZaloHistoryEntry {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  date?: string;
  studentId?: string;
  studentCode?: string;
  studentName?: string;
  classId?: string;
  className?: string;
  phone?: string;
  email?: string;
  templateId?: string;
  zaloMessageId?: string;
  errorMessage?: string;
  courseId?: string;
  evaluationId?: string;
  receiptNo?: string;
  ledgerId?: string;
  ledgerIds?: string[];
  amount?: number;
  semester?: string;
  source?: string;
  isResend?: boolean;
  resendOf?: string;
  resendReason?: string;
  resentBy?: string;
  resentByName?: string;
  templateName?: string;
  templateTag?: string;
  templatePreviewUrl?: string;
  trackingId?: string;
  providerErrorCode?: string | number;
  payloadCaptured?: boolean;
  payloadSnapshot?: ZaloPayloadSnapshot;
  sentBy?: string;
  sentByName?: string;
  canResend: boolean;
  reason?: string;
}

export interface ZaloHistoryResponse {
  success: boolean;
  logs: ZaloHistoryEntry[];
  page: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
    scanned: number;
    scanLimitReached?: boolean;
  };
  error?: string;
}

export type ZaloHistoryFilters = {
  limit?: number;
  cursor?: string;
  type?: string;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
};

export interface ZaloStatusResponse {
  connected: boolean;
  configured: boolean;
  expiresIn?: number;
  oaId?: string | null;
  oaName?: string;
  znsTemplateId?: string | null;
  znsOtpTemplateId?: string | null;
  znsEvalTemplateId?: string | null;
  znsStaffTemplateId?: string | null;
  znsPaymentTemplateId?: string | null;
  znsTuitionNoticeTemplateId?: string | null;
  znsNextCourseTuitionTemplateId?: string | null;
  znsRankTemplateId?: string | null;
  missingEnvVars?: string[];
  error?: string;
  crashDetected?: boolean;
}

// ─── Safe JSON parsing ───────────────────────────────────────────────────────

async function safeJsonParse(
  response: Response
): Promise<{ data: any | null; error: string | null }> {
  try {
    const text = await response.text();
    try {
      return { data: JSON.parse(text), error: null };
    } catch {
      // Server returned non-JSON (e.g. VPS HTML error page)
      if (import.meta.env.DEV) console.error('Non-JSON response:', text.substring(0, 200));
      return {
        data: null,
        error: `Server error (HTTP ${response.status}): ${text.substring(0, 100)}`,
      };
    }
  } catch {
    return { data: null, error: 'Cannot read server response' };
  }
}

// ─── API Calls ───────────────────────────────────────────────────────────────

/**
 * Template 1: Gửi thông báo vắng mặt qua Zalo OA
 */
export async function sendZaloAbsenceNotification(
  payload: ZaloAbsencePayload
): Promise<ZaloNotifyResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/notify-absence`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentId: payload.studentId,
        classId: payload.classId,
        address: payload.address,
        date: payload.date,
      }),
    });

    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, error: parseError };

    if (!response.ok) {
      return { success: false, error: data?.error || `HTTP ${response.status}` };
    }

    return data as ZaloNotifyResponse;
  } catch (err) {
    if (import.meta.env.DEV) console.error('Zalo API error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Template 2: Gửi thư nhận xét kết khóa qua Zalo OA
 */
export async function sendZaloEvaluationNotification(
  payload: ZaloEvaluationPayload
): Promise<ZaloNotifyResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/notify-evaluation`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentId: payload.studentId,
        classId: payload.classId,
      }),
    });

    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, error: parseError };

    if (!response.ok) {
      return { success: false, error: data?.error || `HTTP ${response.status}` };
    }

    return data as ZaloNotifyResponse;
  } catch (err) {
    if (import.meta.env.DEV) console.error('Zalo API error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Gửi thông báo đạt hạng qua Zalo OA
 */
export async function sendZaloRankNotification(
  payload: ZaloRankAchievementPayload
): Promise<ZaloNotifyResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/notify-rank-achievement`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        studentId: payload.studentId,
        classId: payload.classId,
      }),
    });

    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, error: parseError };

    if (!response.ok) {
      return { success: false, error: data?.error || `HTTP ${response.status}` };
    }

    return data as ZaloNotifyResponse;
  } catch (err) {
    if (import.meta.env.DEV) console.error('Zalo rank API error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Template 3: Send staff credentials via Zalo OA
 */
export async function sendStaffCredentialsNotification(
  payload: ZaloStaffCredentialsPayload
): Promise<ZaloNotifyResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/notify-staff-credentials`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...payload,
        phone: normalizePhoneVN(payload.phone),
      }),
    });

    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, error: parseError };

    if (!response.ok) {
      return { success: false, error: data?.error || `HTTP ${response.status}` };
    }

    return data as ZaloNotifyResponse;
  } catch (err) {
    if (import.meta.env.DEV) console.error('Zalo API error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Template 4: Gửi xác nhận thanh toán qua Zalo OA
 */
export async function sendZaloPaymentConfirmNotification(
  payload: ZaloPaymentConfirmPayload
): Promise<ZaloNotifyResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/notify-payment-confirm`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...payload,
        phone: normalizePhoneVN(payload.phone),
      }),
    });

    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, error: parseError };

    if (!response.ok) {
      return { success: false, error: data?.error || `HTTP ${response.status}` };
    }

    return data as ZaloNotifyResponse;
  } catch (err) {
    if (import.meta.env.DEV) console.error('Zalo API error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Template học phí: gửi nhắc học phí từ công nợ cho kế toán
 */
export async function sendZaloTuitionReminderNotification(
  payload: ZaloTuitionReminderPayload
): Promise<ZaloNotifyResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/notify-tuition-reminder`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, error: parseError };

    if (!response.ok) {
      return {
        success: false,
        error: data?.error || `HTTP ${response.status}`,
        errorCode: typeof data?.errorCode === 'string' ? data.errorCode : undefined,
      };
    }

    return data as ZaloNotifyResponse;
  } catch (err) {
    if (import.meta.env.DEV) console.error('Zalo API error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Template học phí khóa tiếp theo: gửi riêng thông báo học phí từ công nợ cho kế toán
 */
export async function sendZaloTuitionNoticeNotification(
  payload: ZaloTuitionNoticePayload
): Promise<ZaloNotifyResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/notify-tuition-notice`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, error: parseError };

    if (!response.ok) {
      return {
        success: false,
        error: data?.error || `HTTP ${response.status}`,
        alreadySent: Boolean(data?.alreadySent),
        tuitionNoticeCount: data?.tuitionNoticeCount,
      };
    }

    return data as ZaloNotifyResponse;
  } catch (err) {
    if (import.meta.env.DEV) console.error('Zalo API error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Kiểm tra trạng thái kết nối Zalo OA
 */
export async function getZaloStatus(): Promise<ZaloStatusResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/status`, { headers });
    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) {
      const isVPSCrash =
        parseError.includes('FUNCTION_INVOCATION_FAILED') ||
        parseError.includes('FUNCTION_INVOCATION');
      return {
        connected: false,
        configured: false,
        error: parseError,
        crashDetected: isVPSCrash,
      };
    }
    return data as ZaloStatusResponse;
  } catch (err) {
    return {
      connected: false,
      configured: false,
      error: err instanceof Error ? err.message : 'Cannot reach server',
    };
  }
}

/**
 * Gửi tin nhắn test qua Zalo OA
 */
export async function getZaloSendCount(params: {
  studentId: string;
  classId: string;
  type: 'absence' | 'evaluation';
  context: string;
  max?: number;
}): Promise<ZaloSendCountResponse> {
  const fallbackMax = params.max || 2;
  try {
    const headers = await getAuthHeaders();
    const search = new URLSearchParams({
      studentId: params.studentId,
      classId: params.classId,
      type: params.type,
      context: params.context,
      max: String(fallbackMax),
    });
    const response = await fetch(`${API_BASE}/zalo-send-count?${search}`, { headers });
    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) {
      return {
        success: false,
        allowed: true,
        currentCount: 0,
        max: fallbackMax,
        error: parseError,
      };
    }
    if (!response.ok) {
      return {
        success: false,
        allowed: true,
        currentCount: 0,
        max: fallbackMax,
        error: data?.error || `HTTP ${response.status}`,
      };
    }
    return data as ZaloSendCountResponse;
  } catch (err) {
    return {
      success: false,
      allowed: true,
      currentCount: 0,
      max: fallbackMax,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export async function getZaloLogSummary(): Promise<ZaloLogSummaryResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/zalo-log-summary`, { headers });
    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, logs: [], error: parseError };
    if (!response.ok) {
      return { success: false, logs: [], error: data?.error || `HTTP ${response.status}` };
    }
    return data as ZaloLogSummaryResponse;
  } catch (err) {
    return {
      success: false,
      logs: [],
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export async function getZaloManualTemplates(): Promise<ZaloTemplateListResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/admin-templates`, { headers });
    const { data, error } = await safeJsonParse(response);
    if (error) return { success: false, templates: [], source: 'configured', error };
    if (!response.ok) {
      return {
        success: false,
        templates: [],
        source: 'configured',
        error: data?.error || `HTTP ${response.status}`,
      };
    }
    return data as ZaloTemplateListResponse;
  } catch (err) {
    return {
      success: false,
      templates: [],
      source: 'configured',
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export async function getZaloManualTemplateDetail(
  templateId: string
): Promise<ZaloTemplateDetailResponse> {
  try {
    const headers = await getAuthHeaders();
    const search = new URLSearchParams({ templateId });
    const response = await fetch(`${API_BASE}/admin-template-detail?${search.toString()}`, {
      headers,
    });
    const { data, error } = await safeJsonParse(response);
    if (error) return { success: false, error };
    if (!response.ok) return { success: false, error: data?.error || `HTTP ${response.status}` };
    return data as ZaloTemplateDetailResponse;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function sendZaloManualMessage(
  input: ZaloManualSendRequest
): Promise<ZaloManualSendResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/admin-manual-send`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    const { data, error } = await safeJsonParse(response);
    if (error) return { success: false, error };
    if (!response.ok) {
      return {
        success: false,
        error: data?.error || `HTTP ${response.status}`,
        errorCode: data?.errorCode,
        logId: data?.logId,
        trackingId: data?.trackingId,
      };
    }
    return data as ZaloManualSendResponse;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function getZaloHistory(
  filters: ZaloHistoryFilters = {}
): Promise<ZaloHistoryResponse> {
  const emptyPage = { limit: filters.limit || 50, nextCursor: null, hasMore: false, scanned: 0 };
  try {
    const headers = await getAuthHeaders();
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const response = await fetch(`${API_BASE}/zalo-history?${search.toString()}`, { headers });
    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, logs: [], page: emptyPage, error: parseError };
    if (!response.ok) {
      return {
        success: false,
        logs: [],
        page: emptyPage,
        error: data?.error || `HTTP ${response.status}`,
      };
    }
    return data as ZaloHistoryResponse;
  } catch (err) {
    return {
      success: false,
      logs: [],
      page: emptyPage,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export async function resendZaloHistoryEntry(
  logId: string,
  reason: string
): Promise<ZaloNotifyResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/admin-resend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ logId, reason }),
    });
    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, error: parseError };
    if (!response.ok) return { success: false, error: data?.error || `HTTP ${response.status}` };
    return data as ZaloNotifyResponse;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function sendZaloTestMessage(phone: string): Promise<ZaloNotifyResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/test`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone: normalizePhoneVN(phone) }),
    });

    const { data, error: parseError } = await safeJsonParse(response);
    if (parseError) return { success: false, error: parseError };
    return data as ZaloNotifyResponse;
  } catch (err) {
    if (import.meta.env.DEV) console.error('Zalo API error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
