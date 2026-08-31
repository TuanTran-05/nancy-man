import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_INTERNAL_MONITORING_BODY_BYTES = 64 * 1024;
export const INTERNAL_MONITORING_PATHS = new Set([
  '/internal/v1/monitoring/overview',
  '/internal/v1/monitoring/infrastructure/history',
  '/internal/v1/monitoring/incidents/ack',
  '/internal/v1/monitoring/zalo/link',
  '/internal/v1/monitoring/zalo/link-code',
  '/internal/v1/monitoring/zalo/unlink'
]);

export type LegacyMonitoringRole = 'ops_viewer' | 'ops_maintainer' | 'ops_owner';
export type LegacyMonitoringRequest = {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
  userId: string;
  role: LegacyMonitoringRole;
};
export type LegacyMonitoringVerification =
  | { ok: true }
  | {
      ok: false;
      code: 'EXPIRED_TIMESTAMP' | 'INVALID_SIGNATURE' | 'REPLAYED_NONCE' | 'PATH_NOT_ALLOWED' | 'BODY_TOO_LARGE';
    };

function canonicalRequest(input: LegacyMonitoringRequest): string {
  const bodyHash = createHash('sha256').update(input.rawBody, 'utf8').digest('hex');
  return [
    'v1',
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    bodyHash,
    input.userId,
    input.role
  ].join('\n');
}

export function signLegacyMonitoringRequest(input: LegacyMonitoringRequest & { secret: string }): string {
  return `v1=${createHmac('sha256', input.secret).update(canonicalRequest(input), 'utf8').digest('hex')}`;
}

export class BoundedNonceReplayCache {
  private readonly expiries = new Map<string, number>();

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid nonce cache capacity');
  }

  async consume(nonce: string, expiresAt: Date, now: Date): Promise<boolean> {
    for (const [stored, expiry] of this.expiries) {
      if (expiry <= now.getTime()) this.expiries.delete(stored);
    }
    if (this.expiries.has(nonce) || this.expiries.size >= this.capacity) return false;
    this.expiries.set(nonce, expiresAt.getTime());
    return true;
  }
}

export async function verifyLegacyMonitoringRequest(
  input: LegacyMonitoringRequest & {
    secret: string;
    signature: string;
    nonceStore: BoundedNonceReplayCache;
    now?: Date;
  }
): Promise<LegacyMonitoringVerification> {
  const now = input.now ?? new Date();
  if (!INTERNAL_MONITORING_PATHS.has(input.path.split('?', 1)[0] ?? '')) {
    return { ok: false, code: 'PATH_NOT_ALLOWED' };
  }
  if (Buffer.byteLength(input.rawBody, 'utf8') > MAX_INTERNAL_MONITORING_BODY_BYTES) {
    return { ok: false, code: 'BODY_TOO_LARGE' };
  }
  const timestamp = Date.parse(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now.getTime() - timestamp) > 30_000) {
    return { ok: false, code: 'EXPIRED_TIMESTAMP' };
  }
  if (!/^[A-Za-z0-9_-]{16,255}$/u.test(input.nonce) || !input.userId || !input.secret) {
    return { ok: false, code: 'INVALID_SIGNATURE' };
  }
  const supplied = /^v1=([a-f0-9]{64})$/iu.exec(input.signature)?.[1];
  if (!supplied) return { ok: false, code: 'INVALID_SIGNATURE' };
  const expected = Buffer.from(signLegacyMonitoringRequest(input), 'utf8');
  const actual = Buffer.from(`v1=${supplied}`, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, code: 'INVALID_SIGNATURE' };
  }
  const accepted = await input.nonceStore.consume(input.nonce, new Date(timestamp + 30_000), now);
  return accepted ? { ok: true } : { ok: false, code: 'REPLAYED_NONCE' };
}
