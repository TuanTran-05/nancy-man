// Shared Zalo OA helper — all env reads happen inside functions, never at module level.
import { getDb } from '../auth/verifyAuth.js';

export interface ZaloConfig {
  appId: string;
  appSecret: string;
  oaId: string;
  znsTemplateId: string;
  znsOtpTemplateId: string;
  znsEvalTemplateId: string;
  znsStaffTemplateId: string;
  znsPaymentTemplateId: string;
  znsTuitionNoticeTemplateId: string;
  znsNextCourseTuitionTemplateId: string;
  znsRankTemplateId: string;
  initialAccessToken: string;
  refreshToken: string;
}

export function getZaloConfig(): ZaloConfig {
  return {
    appId: process.env.ZALO_APP_ID || '',
    appSecret: process.env.ZALO_APP_SECRET || '',
    oaId: process.env.ZALO_OA_ID || '',
    znsTemplateId: process.env.ZALO_ZNS_TEMPLATE_ID || '',
    znsOtpTemplateId: process.env.ZALO_ZNS_OTP_TEMPLATE_ID || '',
    znsEvalTemplateId: process.env.ZALO_ZNS_EVAL_TEMPLATE_ID || '',
    znsStaffTemplateId: process.env.ZALO_ZNS_STAFF_TEMPLATE_ID || '',
    znsPaymentTemplateId: process.env.ZALO_ZNS_PAYMENT_TEMPLATE_ID || '',
    znsTuitionNoticeTemplateId: process.env.ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID || '',
    znsNextCourseTuitionTemplateId: process.env.ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID || '',
    znsRankTemplateId: process.env.ZALO_ZNS_RANK_TEMPLATE_ID || '',
    initialAccessToken: process.env.ZALO_OA_ACCESS_TOKEN || '',
    refreshToken: process.env.ZALO_REFRESH_TOKEN || '',
  };
}

export function getMissingEnvVars(): string[] {
  const cfg = getZaloConfig();
  const missing: string[] = [];
  if (!cfg.appId) missing.push('ZALO_APP_ID');
  if (!cfg.appSecret) missing.push('ZALO_APP_SECRET');
  if (!cfg.refreshToken) missing.push('ZALO_REFRESH_TOKEN');
  if (!cfg.oaId) missing.push('ZALO_OA_ID');
  if (!cfg.znsTemplateId) missing.push('ZALO_ZNS_TEMPLATE_ID');
  if (!cfg.znsOtpTemplateId) missing.push('ZALO_ZNS_OTP_TEMPLATE_ID');
  if (!cfg.znsEvalTemplateId) missing.push('ZALO_ZNS_EVAL_TEMPLATE_ID');
  if (!cfg.znsStaffTemplateId) missing.push('ZALO_ZNS_STAFF_TEMPLATE_ID');
  if (!cfg.znsPaymentTemplateId) missing.push('ZALO_ZNS_PAYMENT_TEMPLATE_ID');
  if (!cfg.znsTuitionNoticeTemplateId) missing.push('ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID');
  if (!cfg.znsNextCourseTuitionTemplateId) missing.push('ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID');
  if (!cfg.znsRankTemplateId) missing.push('ZALO_ZNS_RANK_TEMPLATE_ID');
  return missing;
}

// ─── Token Cache (module-level, persists across warm invocations) ────────────

let cachedAccessToken = '';
let cachedRefreshToken = '';
let tokenExpiresAt = 0;
let refreshLock: Promise<string | null> | null = null;
let initialized = false;

async function ensureInitialized() {
  if (initialized) return;
  const cfg = getZaloConfig();
  cachedAccessToken = cfg.initialAccessToken;
  cachedRefreshToken = cfg.refreshToken;
  // IMPORTANT:
  // - Access token in ENV may already be expired when the VPS process starts.
  // - If we don't have a trusted expiresAt persisted, force refresh on first use.
  tokenExpiresAt = 0;

  try {
    const db = getDb();
    const doc = await db.collection('_zalo_config').doc('tokens').get();
    if (doc.exists) {
      const data = doc.data();
      if (data?.accessToken && data?.refreshToken) {
        cachedAccessToken = data.accessToken;
        cachedRefreshToken = data.refreshToken;
        tokenExpiresAt = data.expiresAt || 0;
      }
    }
  } catch (err) {
    console.error('[ZaloHelper] Failed to read from DocumentStore:', err);
  }

  initialized = true;
}

async function requestAccessTokenWithRefreshToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number } | null> {
  const cfg = getZaloConfig();
  if (!refreshToken || !cfg.appId || !cfg.appSecret) return null;

  try {
    const r = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        secret_key: cfg.appSecret,
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        app_id: cfg.appId,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const d = await r.json();
    if (!d?.access_token) return null;

    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token || refreshToken,
      expiresAt: Date.now() + (d.expires_in || 3600) * 1000,
    };
  } catch (err) {
    console.error('[ZaloHelper] Token refresh error:', err);
    return null;
  }
}

async function persistTokenState() {
  try {
    const db = getDb();
    await db.collection('_zalo_config').doc('tokens').set(
      {
        accessToken: cachedAccessToken,
        refreshToken: cachedRefreshToken,
        expiresAt: tokenExpiresAt,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (dbErr) {
    console.error('[ZaloHelper] Failed to save tokens to DocumentStore:', dbErr);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  await ensureInitialized();
  const cfg = getZaloConfig();
  if ((!cachedRefreshToken && !cfg.refreshToken) || !cfg.appId || !cfg.appSecret) return null;

  const primaryRefreshToken = cachedRefreshToken || cfg.refreshToken;
  let tokenResult = await requestAccessTokenWithRefreshToken(primaryRefreshToken);

  if (!tokenResult && cfg.refreshToken && cfg.refreshToken !== primaryRefreshToken) {
    tokenResult = await requestAccessTokenWithRefreshToken(cfg.refreshToken);
  }

  if (!tokenResult) return null;

  cachedAccessToken = tokenResult.accessToken;
  cachedRefreshToken = tokenResult.refreshToken;
  tokenExpiresAt = tokenResult.expiresAt;

  await persistTokenState();
  return cachedAccessToken;
}

export async function getValidAccessToken(): Promise<string | null> {
  await ensureInitialized();
  const cfg = getZaloConfig();
  const canRefresh = Boolean(
    (cachedRefreshToken || cfg.refreshToken) && cfg.appId && cfg.appSecret
  );
  if (!canRefresh) return cachedAccessToken || cfg.initialAccessToken || null;

  // If we don't have a trusted expiry time (0), refresh immediately.
  if (!tokenExpiresAt || Date.now() >= tokenExpiresAt - 5 * 60 * 1000) {
    if (!refreshLock) {
      refreshLock = refreshAccessToken().finally(() => {
        refreshLock = null;
      });
    }
    const refreshed = await refreshLock;
    if (refreshed) return refreshed;
    if (cfg.initialAccessToken && cfg.initialAccessToken !== cachedAccessToken) {
      return cfg.initialAccessToken;
    }
  }

  return cachedAccessToken || cfg.initialAccessToken || null;
}

export async function forceRefreshAccessToken(): Promise<string | null> {
  // Force refresh regardless of tokenExpiresAt. Used when Zalo returns -401.
  tokenExpiresAt = 0;
  if (!refreshLock) {
    refreshLock = refreshAccessToken().finally(() => {
      refreshLock = null;
    });
  }
  return refreshLock;
}

// ─── Error Code Map (consolidated) ───────────────────────────────────────────

export const ZALO_ERRORS: Record<number, string> = {
  [-1]: 'Lỗi hệ thống Zalo',
  [-2]: 'Access token không hợp lệ',
  [-3]: 'App không tồn tại hoặc bị khóa',
  [-4]: 'Template không tồn tại hoặc chưa được duyệt',
  [-5]: 'Template data không hợp lệ',
  [-6]: 'SĐT không hợp lệ hoặc không tồn tại trên Zalo',
  [-7]: 'User chưa follow OA',
  [-8]: 'Gửi quá giới hạn cho phép',
  [-9]: 'OA bị khóa hoặc không hoạt động',
  [-10]: 'Dữ liệu không hợp lệ',
  [-11]: 'SĐT chưa đăng ký Zalo',
  [-12]: 'User đã hủy follow OA',
  [-13]: 'Template chưa được duyệt',
  [-14]: 'Nội dung template vi phạm chính sách',
  [-100]: 'Lỗi không xác định',
  [-120]:
    'OA chưa được cấp quyền sử dụng ZNS. Vào Zalo OA Manager → Cài đặt → ZNS để bật tính năng, hoặc liên hệ Zalo để được cấp quyền.',
  [-201]: 'User chưa follow/quan tâm OA',
  [-202]: 'SĐT không đúng định dạng quốc tế',
  [-203]: 'Template data thiếu required fields',
  [-210]: 'Gửi trùng tin nhắn (duplicate tracking_id)',
  [-215]: 'Tin nhắn bị từ chối bởi người nhận',
  [-401]: 'Access token expired hoặc không hợp lệ',
  [-429]: 'Rate limit - quá nhiều request',
  [-108]: 'Số điện thoại không hợp lệ',
  [-109]: 'Template ID không hợp lệ',
  [-111]: 'Template không có dữ liệu',
  [-115]: 'Tài khoản ZBS không đủ số dư',
  [-117]: 'OA hoặc ứng dụng chưa được cấp quyền dùng template',
  [-124]: 'Access token hết hạn hoặc không hợp lệ',
  [-131]: 'Template chưa được phê duyệt',
  [-139]: 'Người dùng từ chối nhận loại tin này',
  [-144]: 'OA đã vượt hạn mức gửi trong ngày',
  [-147]: 'Template đã vượt hạn mức gửi trong ngày',
  [-1121]: 'Dữ liệu tham số vượt giới hạn ký tự',
  [-1122]: 'Template data thiếu tham số bắt buộc',
  [-1124]: 'Date có định dạng không hợp lệ (cần dd/MM/yyyy)',
};

// ─── Send ZNS Message (with auto-retry on -401) ──────────────────────────────

export interface SendZNSResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: number;
}

export async function sendZaloZNSMessage(
  templateId: string,
  templateData: Record<string, string | number>,
  phone: string,
  trackingId?: string
): Promise<SendZNSResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { success: false, error: 'Không có access token hợp lệ' };
  }

  const makeRequest = async (token: string) => {
    return fetch('https://business.openapi.zalo.me/message/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: token },
      body: JSON.stringify({
        phone,
        template_id: templateId,
        template_data: templateData,
        tracking_id: trackingId || `edutrack_${Date.now()}`,
      }),
    });
  };

  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 1000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      let response = await makeRequest(accessToken);
      let data = await response.json();

      if (data.error === -401 || data.error === -124) {
        // Access token can be invalid even if our cached expiry says otherwise.
        // Force refresh then retry once.
        const freshToken = await forceRefreshAccessToken();
        if (freshToken) {
          response = await makeRequest(freshToken);
          data = await response.json();
        } else {
          const envAccessToken = getZaloConfig().initialAccessToken;
          if (envAccessToken && envAccessToken !== accessToken) {
            response = await makeRequest(envAccessToken);
            data = await response.json();
          } else {
            return {
              success: false,
              errorCode: typeof data.error === 'number' ? data.error : undefined,
              error: ZALO_ERRORS[data.error] || ZALO_ERRORS[-401],
            };
          }
        }
      }

      if (data.error === 0 || data.message === 'Success') {
        return { success: true, messageId: data.data?.msg_id || String(Date.now()) };
      }

      // Don't retry on client errors (non-transient)
      const msg = ZALO_ERRORS[data.error] || `Lỗi Zalo (code: ${data.error})`;
      return {
        success: false,
        errorCode: typeof data.error === 'number' ? data.error : undefined,
        error: `${msg}: ${data.message || ''}`.trim(),
      };
    } catch (err) {
      // Network error — retry with exponential backoff
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt)));
        continue;
      }
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  return { success: false, error: 'Max retries exceeded' };
}

// ─── Connection Check (for status endpoint) ──────────────────────────────────

export interface ZaloConnectionStatus {
  configured: boolean;
  connected: boolean;
  expiresIn: number;
  oaId: string | null;
  znsTemplateId: string | null;
  znsOtpTemplateId: string | null;
  znsEvalTemplateId: string | null;
  znsStaffTemplateId: string | null;
  znsPaymentTemplateId: string | null;
  znsTuitionNoticeTemplateId: string | null;
  znsNextCourseTuitionTemplateId: string | null;
  znsRankTemplateId: string | null;
  missingEnvVars: string[];
}

export async function checkZaloConnection(): Promise<ZaloConnectionStatus> {
  await ensureInitialized();
  const cfg = getZaloConfig();
  const missing = getMissingEnvVars();
  const configured = Boolean(
    (cfg.appId && cfg.appSecret && (cachedRefreshToken || cfg.refreshToken)) ||
    cachedAccessToken ||
    cfg.initialAccessToken
  );

  let hasValidToken = false;
  if (configured) {
    hasValidToken = Boolean(await getValidAccessToken());
  }

  return {
    configured,
    connected: hasValidToken,
    expiresIn:
      hasValidToken && tokenExpiresAt > Date.now()
        ? Math.floor((tokenExpiresAt - Date.now()) / 1000)
        : 0,
    oaId: cfg.oaId || null,
    znsTemplateId: cfg.znsTemplateId || null,
    znsOtpTemplateId: cfg.znsOtpTemplateId || null,
    znsEvalTemplateId: cfg.znsEvalTemplateId || null,
    znsStaffTemplateId: cfg.znsStaffTemplateId || null,
    znsPaymentTemplateId: cfg.znsPaymentTemplateId || null,
    znsTuitionNoticeTemplateId: cfg.znsTuitionNoticeTemplateId || null,
    znsNextCourseTuitionTemplateId: cfg.znsNextCourseTuitionTemplateId || null,
    znsRankTemplateId: cfg.znsRankTemplateId || null,
    missingEnvVars: missing,
  };
}
