import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import { type DocumentStore } from '@/server/db/documentStore.js';
import { getDb } from '../../lib/auth/verifyAuth.js';
import { sanitizeLogValue } from '../../lib/logging/logSanitizer.js';
import { checkRateLimit, isDuplicateWithinWindow, markRecord } from '../../lib/auth/rateLimit.js';
import { getClientIp } from '../../lib/logging/auditLog.js';

export const ZALO_DELIVERY_ERROR = 'Failed to send Zalo notification';
export const ZALO_SEND_RATE_WINDOW_MS = 60 * 60 * 1000;
export const ZALO_DEDUP_WINDOW_MS = 10 * 60 * 1000;
export const ZALO_TRACKING_WRITE_TIMEOUT_MS = 2500;

export const ZALO_ACTION_LIMITS: Record<string, number> = {
  'notify-staff-credentials': 10,
  'notify-payment-confirm': 30,
  'notify-tuition-reminder': 30,
  'notify-tuition-notice': 30,
  'notify-evaluation': 30,
  'notify-absence': 60,
  test: 20,
  'admin-manual-send': 20,
};

export function limitTextLength(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export function sendZaloGatewayError(res: ApiResponse, details: Record<string, unknown> = {}) {
  return res.status(502).json({
    success: false,
    errorCode: 'gateway_error',
    error: ZALO_DELIVERY_ERROR,
    ...details,
  });
}

export function maskPhone(value: unknown): string {
  const phone = String(value || '');
  if (phone.length <= 4) return phone ? '***' : '';
  return `${phone.slice(0, 2)}***${phone.slice(-3)}`;
}

export function maskName(value: unknown): string {
  const name = String(value || '').trim();
  if (!name) return '';
  return name
    .split(/\s+/)
    .map((part) => `${part[0] || ''}${part.length > 1 ? '***' : ''}`)
    .join(' ');
}

export function parseNumberParam(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;

  const raw = value.trim().replace(/[^\d.,-]/g, '');
  if (!raw) return 0;

  if (/^-?\d{1,3}([.,]\d{3})+$/.test(raw)) {
    const parsed = Number(raw.replace(/[.,]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function rateLimitKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 160) || 'unknown';
}

export function zaloDedupKey(action: string, key: string): string {
  return `zalo_dedup:${rateLimitKeyPart(action)}:${rateLimitKeyPart(key)}`;
}

export async function awaitZaloTrackingWrite<T>(
  operation: Promise<T>,
  fallback: T,
  label: string,
  timeoutMs = ZALO_TRACKING_WRITE_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guardedOperation = operation.catch((err) => {
    console.error(label, err);
    return fallback;
  });
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.error(`${label} timed out after ${timeoutMs}ms`);
      resolve(fallback);
    }, timeoutMs);
    const maybeNodeTimer = timer as unknown as { unref?: () => void };
    if (typeof maybeNodeTimer.unref === 'function') {
      maybeNodeTimer.unref();
    }
  });

  try {
    return await Promise.race([guardedOperation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function enforceZaloSendGuard(
  db: DocumentStore,
  req: ApiRequest,
  res: ApiResponse,
  uid: string,
  action: string,
  dedupKey: string,
  dedupWindowMs = ZALO_DEDUP_WINDOW_MS
): Promise<'send' | 'blocked' | 'duplicate'> {
  const rate = await checkRateLimit(
    db,
    `zalo_send:${rateLimitKeyPart(action)}:${rateLimitKeyPart(getClientIp(req))}:${rateLimitKeyPart(uid)}`,
    ZALO_ACTION_LIMITS[action] || 20,
    ZALO_SEND_RATE_WINDOW_MS,
    { failClosed: true }
  );
  if (!rate.allowed) {
    res.status(429).json({
      success: false,
      errorCode: 'rate_limited',
      error: 'Too many Zalo notification requests',
    });
    return 'blocked';
  }

  if (await isDuplicateWithinWindow(db, zaloDedupKey(action, dedupKey), dedupWindowMs)) {
    res.status(200).json({ success: true, alreadySent: true });
    return 'duplicate';
  }

  return 'send';
}

export async function markZaloSendRecord(db: DocumentStore, action: string, dedupKey: string) {
  await awaitZaloTrackingWrite(
    markRecord(db, zaloDedupKey(action, dedupKey), ZALO_DEDUP_WINDOW_MS),
    undefined,
    `[Zalo] Failed to write send guard record for ${action}`
  );
}

export async function logZaloNotification(entry: Record<string, unknown>) {
  await awaitZaloTrackingWrite(
    getDb()
      .collection('zalo_notifications')
      .add(sanitizeLogValue({ ...entry, createdAt: new Date().toISOString() })),
    undefined,
    '[Zalo] Failed to write notification log'
  );
}
