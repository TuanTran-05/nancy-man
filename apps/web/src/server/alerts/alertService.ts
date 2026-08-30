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

export function formatAlertText(input: {
  level: 'warning' | 'critical';
  monitor: string;
  occurrenceCount: number;
  observedAt: string;
  recovered: boolean;
}): string {
  const localTime = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date(input.observedAt));
  return [
    `${input.recovered ? 'RECOVERED' : input.level.toUpperCase()}: Ops Console`,
    `Monitor: ${input.monitor}`,
    `Thời điểm: ${localTime}`,
    `Số lần: ${input.occurrenceCount}`,
    `Trạng thái: ${input.recovered ? 'recovered' : input.level}`,
    'https://man.thienuy.edu.vn'
  ].join('\n');
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
              recovered: delivery.kind === 'recovered'
            });
      try {
        const recipientId = decryptSecret(delivery.recipientCiphertext, deps.recipientKey);
        if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(recipientId))
          throw new ZaloDeliveryError('invalid_recipient', false, false);
        await sender({ botToken: deps.botToken, recipientId, timeoutMs: deps.timeoutMs }, text);
        deps.store.completeDelivery(delivery.id);
      } catch (error) {
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
    } catch {
      // The direct failsafe isolates malformed local state and provider failures per recipient.
    }
  }
}
