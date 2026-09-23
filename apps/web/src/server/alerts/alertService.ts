import { captureOpsException } from '../telemetry/runtimeTelemetry.js';

import type { AlertDelivery, Incident } from '../../shared/models.js';
import type { OpsStore, ZaloRecipientRecord } from '../storage/store.js';
import { sendZaloText, type ZaloSendConfig, ZaloDeliveryError } from './zaloBotClient.js';
import type { CollectorTransition } from '../collector/collector.js';
import { decryptSecret } from '../security/crypto.js';

export interface AlertServiceDeps {
  store: OpsStore;
  botToken: string;
  recipients: ZaloRecipientRecord[];
  recipientProvider?: () => ZaloRecipientRecord[];
  recipientKey: Buffer;
  timeoutMs: number;
  now?: () => Date;
  sender?: (config: ZaloSendConfig, text: string) => Promise<{ messageId: string }>;
}

const COOLDOWN_MS = 30 * 60 * 1000;
const retryDelayMs = (attempt: number) => 60_000 * 2 ** Math.max(0, Math.min(4, attempt - 1));

export interface FormatAlertInput {
  level: 'warning' | 'critical';
  monitor: string;
  occurrenceCount: number;
  observedAt: string;
  recovered: boolean;
  openedAt?: string;
  recoveredAt?: string | null;
  dedupeKey?: string;
  safeSummary?: string;
}

export interface ParsedAlertDetails {
  errorName: string;
  errorCode: string;
  errorDetail?: string;
  target?: string;
}

export function parseAlertDetails(input: {
  monitor: string;
  dedupeKey?: string;
  safeSummary?: string;
}): ParsedAlertDetails {
  const monitor = input.monitor;
  const dedupeKey = input.dedupeKey ?? '';
  let rawSummary = (input.safeSummary ?? '').trim();

  // Strip Bearer to prevent any auth token leak
  rawSummary = rawSummary.replace(/\bBearer\b/gi, '[auth]');

  // Strip timestamp prefixes like "2026-09-18T22:21:56: "
  rawSummary = rawSummary.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?:\s*/, '').trim();

  // If summary is just generic `${monitor} healthy` or `${monitor} ${level}`, ignore it
  if (
    !rawSummary ||
    rawSummary === `${monitor} healthy` ||
    rawSummary === `${monitor} warning` ||
    rawSummary === `${monitor} critical` ||
    rawSummary === `${monitor} unknown`
  ) {
    rawSummary = '';
  }

  let errorName = '';
  let errorCode = '';
  let target = '';
  let errorDetail = rawSummary || undefined;

  // 1. Extract errorCode
  const errorCodeMatch =
    rawSummary.match(/\berrorCode:\s*['"]?([A-Za-z0-9_-]+)['"]?/) ||
    rawSummary.match(/\b([1-5]\d{2})\s+([a-z0-9_]+):/i) ||
    rawSummary.match(/\b(HTTP\s+[1-5]\d{2})\b/i);
  if (errorCodeMatch) {
    errorCode = errorCodeMatch[2] ? `${errorCodeMatch[1]} ${errorCodeMatch[2]}` : errorCodeMatch[1];
  } else if (dedupeKey) {
    const parts = dedupeKey.split(':');
    if (parts.length > 1 && parts[1] && parts[1] !== 'errors_state') {
      errorCode = parts.slice(1).join(':');
    }
  }

  // 2. Extract target / actor
  const apiRouteMatch = rawSummary.match(/\[API_ERROR\]\s+([A-Z]+\s+\/[^\s]+)/);
  const moduleTagMatch = rawSummary.match(/\[([A-Za-z0-9_/.-]+)\]/);
  const userMatch = rawSummary.match(/\b(?:user|account|actor)(?:Id)?[:=]\s*([A-Za-z0-9_.-]+)/i);

  if (userMatch) {
    target = `User: ${userMatch[1]}`;
  } else if (apiRouteMatch) {
    target = `Route: ${apiRouteMatch[1]}`;
  } else if (moduleTagMatch && moduleTagMatch[1] !== 'API_ERROR') {
    target = `Module: ${moduleTagMatch[1]}`;
  } else if (monitor === 'postgres') {
    target = 'Cơ sở dữ liệu PostgreSQL (127.0.0.1:5432)';
  } else if (monitor === 'backup') {
    target = 'Hệ thống lưu trữ sao lưu (Backups)';
  } else if (monitor === 'cron') {
    target = 'Hệ thống tác vụ nền (Cron)';
  } else if (monitor === 'app_liveness' || monitor === 'app_health' || monitor === 'app_process') {
    target = 'Ứng dụng EduTrack (http://127.0.0.1:3000)';
  } else if (monitor === 'beszel') {
    target = 'Agent giám sát hạ tầng Beszel';
  } else {
    target = 'Hệ thống (Background / System)';
  }

  // 3. Extract errorName
  if (rawSummary.includes('DeprecationWarning') || rawSummary.includes('trace-deprecation')) {
    errorName = 'Cảnh báo Deprecation trong Node.js / pg driver';
  } else if (rawSummary.includes('[API_ERROR]')) {
    const msgMatch = rawSummary.match(/\[API_ERROR\]\s+[A-Z]+\s+\/[^\s]+\s+\d{3}\s+[^:]+:\s*(.+?)(?:\s*\(eventId:|\s*$)/);
    errorName = msgMatch ? msgMatch[1].trim() : 'Lỗi yêu cầu API';
  } else if (rawSummary.includes('Error:')) {
    const errorMatch = rawSummary.match(/Error:\s*(.+?)(?:\s*at\s|\s*\{|\s*statusCode:|$)/);
    errorName = errorMatch ? errorMatch[1].trim() : 'Lỗi ngoại lệ ứng dụng';
  } else if (monitor === 'postgres') {
    if (errorCode === 'postgres_unreachable') errorName = 'Không thể kết nối cơ sở dữ liệu PostgreSQL';
    else if (errorCode === 'postgres_locked') errorName = 'Tắc nghẽn khóa truy vấn PostgreSQL (Lock contention)';
    else if (errorCode === 'connections_warning') errorName = 'Số lượng kết nối PostgreSQL vượt ngưỡng an toàn';
    else errorName = 'Sự cố cơ sở dữ liệu PostgreSQL';
  } else if (monitor === 'backup') {
    if (errorCode === 'backup_disk_warning') errorName = 'Dung lượng ổ đĩa sao lưu chạm ngưỡng cảnh báo';
    else if (errorCode === 'backup_stale') errorName = 'Không phát hiện bản sao lưu mới trong 24 giờ qua';
    else errorName = 'Sự cố hệ thống sao lưu';
  } else if (monitor === 'cron') {
    if (errorCode === 'cron_failed') errorName = 'Tác vụ định kỳ (Cron) thực thi thất bại';
    else if (errorCode === 'cron_late') errorName = 'Tác vụ định kỳ (Cron) bị trễ lịch trình';
    else errorName = 'Sự cố tác vụ định kỳ Cron';
  } else if (monitor === 'app_liveness') {
    errorName = 'Ứng dụng EduTrack không phản hồi (App down / Liveness failed)';
  } else if (monitor === 'app_health') {
    errorName = 'Ứng dụng EduTrack báo trạng thái không khỏe mạnh (Healthcheck failed)';
  } else if (monitor === 'app_process') {
    errorName = 'Tiến trình PM2 của EduTrack bị mất hoặc dừng';
  } else {
    errorName = rawSummary ? rawSummary.slice(0, 100) : `Sự cố giám sát ${monitor}`;
  }

  // Format errorDetail: truncate if too long, scrub extra spaces
  if (errorDetail) {
    errorDetail = errorDetail.replace(/\s+/g, ' ').trim();
    if (errorDetail.length > 250) {
      errorDetail = errorDetail.slice(0, 247) + '...';
    }
  }

  return {
    errorName,
    errorCode: errorCode || 'unknown',
    errorDetail,
    target
  };
}

export function formatAlertText(input: FormatAlertInput): string {
  const formatTime = (isoString?: string | null) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (!Number.isFinite(date.getTime())) return isoString;
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'short',
      timeStyle: 'medium'
    }).format(date);
  };

  const details = parseAlertDetails({
    monitor: input.monitor,
    dedupeKey: input.dedupeKey,
    safeSummary: input.safeSummary
  });

  const lines: string[] = [];

  if (input.recovered) {
    lines.push('RECOVERED: Ops Console');
    lines.push(`Monitor: ${input.monitor}`);
    lines.push(`Trạng thái: recovered`);
    lines.push(`Sự cố đã khắc phục: ${details.errorName}`);
    if (details.errorCode && details.errorCode !== 'unknown') {
      lines.push(`Mã lỗi: ${details.errorCode}`);
    }
    if (details.target) {
      lines.push(`Đối tượng / Vị trí: ${details.target}`);
    }
    if (input.openedAt) {
      lines.push(`Thời gian bắt đầu: ${formatTime(input.openedAt)}`);
      lines.push(`Thời điểm phục hồi: ${formatTime(input.recoveredAt ?? input.observedAt)}`);
      const startMs = new Date(input.openedAt).getTime();
      const endMs = new Date(input.recoveredAt ?? input.observedAt).getTime();
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
        const seconds = Math.round((endMs - startMs) / 1000);
        const durationText =
          seconds >= 60 ? `${Math.floor(seconds / 60)} phút ${seconds % 60}s` : `${seconds}s`;
        lines.push(`Thời gian gián đoạn: ${durationText}`);
      }
    } else {
      lines.push(`Thời điểm: ${formatTime(input.observedAt)}`);
    }
    lines.push(`Số lần lặp lại: ${input.occurrenceCount}`);
  } else {
    lines.push(`${input.level.toUpperCase()}: Ops Console`);
    lines.push(`Monitor: ${input.monitor}`);
    lines.push(`Trạng thái: ${input.level}`);
    lines.push(`Lỗi: ${details.errorName}`);
    if (details.errorCode && details.errorCode !== 'unknown') {
      lines.push(`Mã lỗi: ${details.errorCode}`);
    }
    if (details.errorDetail && details.errorDetail !== details.errorName) {
      lines.push(`Chi tiết: ${details.errorDetail}`);
    }
    if (details.target) {
      lines.push(`Đối tượng / Vị trí: ${details.target}`);
    }
    lines.push(`Thời điểm: ${formatTime(input.observedAt)}`);
    lines.push(`Số lần: ${input.occurrenceCount}`);
  }

  lines.push('https://man.thienuy.edu.vn');
  return lines.join('\n');
}

export function createAlertService(deps: AlertServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const sender = deps.sender ?? sendZaloText;

  function openOrUpdateIncident(input: CollectorTransition): Incident {
    if (input.incidentId) {
      const existing = deps.store.getIncident(input.incidentId);
      if (existing) return existing;
    }
    return deps.store.upsertIncident({
      dedupeKey: input.dedupeKey,
      monitor: input.monitor,
      level: input.level,
      state: input.transition === 'recovered' ? 'recovered' : 'open',
      recoveredAt: input.transition === 'recovered' ? input.sample.observedAt : null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      note: null,
      safeSummary: input.safeSummary,
      now: input.sample.observedAt
    });
  }

  async function queueTransitionDelivery(input: CollectorTransition): Promise<AlertDelivery[]> {
    const incident = openOrUpdateIncident(input);
    const kind: AlertDelivery['kind'] = input.transition === 'recovered' ? 'recovered' : 'opened';
    if (kind === 'recovered' && deps.store.hasDelivery({ incidentId: incident.id, kind }))
      return [];
    const cooldownMs =
      input.sample.errorCode === 'backup_local_only' ? 24 * 60 * 60_000 : COOLDOWN_MS;
    const since = new Date(now().getTime() - cooldownMs).toISOString();
    if (
      kind !== 'recovered' &&
      deps.store.hasDelivery({ incidentId: incident.id, kind: 'opened', since })
    )
      return [];
    const deliveryKind: AlertDelivery['kind'] =
      kind !== 'recovered' && deps.store.hasDelivery({ incidentId: incident.id, kind: 'opened' })
        ? 'reminder'
        : kind;
    const recipients = deps.recipientProvider ? deps.recipientProvider() : deps.recipients;
    return recipients.map((recipient) =>
      deps.store.enqueueDelivery({
        incidentId: incident.id,
        recipientCiphertext: recipient.recipientCiphertext,
        kind: deliveryKind,
        nextAttemptAt: now().toISOString(),
        lastErrorCode: null
      })
    );
  }

  async function deliverDueAlerts(at: Date = now(), limit = 50): Promise<void> {
    const deliveries = deps.store.claimDueDeliveries(at.toISOString(), limit);
    for (const delivery of deliveries) {
      const incident = delivery.incidentId
        ? deps.store.getIncident(delivery.incidentId)
        : undefined;
      const text =
        delivery.kind === 'collector_failed'
          ? 'CRITICAL: ops-collector stopped; open https://man.thienuy.edu.vn'
          : formatAlertText({
              level: incident?.level ?? 'critical',
              monitor: incident?.monitor ?? 'collector',
              occurrenceCount: incident?.occurrenceCount ?? delivery.attemptCount,
              observedAt: incident?.lastSeenAt ?? at.toISOString(),
              recovered: delivery.kind === 'recovered',
              openedAt: incident?.openedAt,
              recoveredAt:
                incident?.recoveredAt ??
                (delivery.kind === 'recovered' ? at.toISOString() : undefined),
              dedupeKey: incident?.dedupeKey,
              safeSummary: incident?.safeSummary
            });
      try {
        const recipientId = decryptSecret(delivery.recipientCiphertext, deps.recipientKey);
        if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(recipientId))
          throw new ZaloDeliveryError('invalid_recipient', false, false);
        await sender({ botToken: deps.botToken, recipientId, timeoutMs: deps.timeoutMs }, text);
        deps.store.completeDelivery(delivery.id);
      } catch (error) {
        captureOpsException(error, {
          code: 'UNHANDLED_OPS_EXCEPTION',
          source: 'api',
          status: 500
        });
        const failure =
          error instanceof ZaloDeliveryError
            ? error
            : new ZaloDeliveryError('delivery_failed', true, true);
        const nextAttemptAt = new Date(
          at.getTime() +
            (failure.retryable ? retryDelayMs(delivery.attemptCount) : 365 * 24 * 60 * 60_000)
        ).toISOString();
        deps.store.failDelivery(delivery.id, {
          state: failure.ambiguous ? 'delivery_ambiguous' : 'failed',
          errorCode: failure.code,
          nextAttemptAt
        });
      }
    }
  }

  return { openOrUpdateIncident, queueTransitionDelivery, deliverDueAlerts };
}

export async function sendCollectorFailureNotice(
  config: Omit<ZaloSendConfig, 'recipientId'> & {
    recipients: ZaloRecipientRecord[];
    recipientKey: Buffer;
  },
  fetchImpl?: typeof fetch
): Promise<void> {
  const text = 'CRITICAL: ops-collector stopped; open https://man.thienuy.edu.vn';
  for (const recipient of config.recipients) {
    try {
      const recipientId = decryptSecret(recipient.recipientCiphertext, config.recipientKey);
      if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(recipientId)) continue;
      await sendZaloText({ ...config, recipientId, fetchImpl }, text);
    } catch (error) {
      captureOpsException(error, {
        code: 'UNHANDLED_OPS_EXCEPTION',
        source: 'provider',
        status: 500
      });
      // The direct failsafe isolates malformed local state and provider failures per recipient.
    }
  }
}
