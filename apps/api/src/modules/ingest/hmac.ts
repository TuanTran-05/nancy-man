import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type NonceStore = {
  consume: (nonce: string, expiresAt: Date, now: Date) => Promise<boolean>;
};

export class InMemoryNonceStore implements NonceStore {
  private readonly expiries = new Map<string, number>();

  async consume(nonce: string, expiresAt: Date, now: Date): Promise<boolean> {
    for (const [storedNonce, expiry] of this.expiries) {
      if (expiry <= now.getTime()) {
        this.expiries.delete(storedNonce);
      }
    }

    if (this.expiries.has(nonce)) {
      return false;
    }

    this.expiries.set(nonce, expiresAt.getTime());
    return true;
  }
}

type CanonicalRequest = {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
};

function canonicalRequest(input: CanonicalRequest): string {
  const bodyHash = createHash('sha256').update(input.rawBody, 'utf8').digest('hex');
  return [
    'v1',
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    bodyHash
  ].join('\n');
}

function computeSignature(secret: string, request: CanonicalRequest): Buffer {
  return createHmac('sha256', secret).update(canonicalRequest(request), 'utf8').digest();
}

export function signServerIngestRequest(input: CanonicalRequest & { secret: string }): string {
  return `v1=${computeSignature(input.secret, input).toString('hex')}`;
}

export async function verifyServerIngestRequest(
  input: CanonicalRequest & {
    secret: string;
    signature: string;
    nonceStore: NonceStore;
    now?: Date;
  }
): Promise<
  { ok: true } | { ok: false; code: 'EXPIRED_TIMESTAMP' | 'INVALID_SIGNATURE' | 'REPLAYED_NONCE' }
> {
  const now = input.now ?? new Date();
  const timestamp = Date.parse(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now.getTime() - timestamp) > 60_000) {
    return { ok: false, code: 'EXPIRED_TIMESTAMP' };
  }

  if (!/^[A-Za-z0-9_-]{16,255}$/.test(input.nonce)) {
    return { ok: false, code: 'INVALID_SIGNATURE' };
  }

  const supplied = /^v1=([a-f0-9]{64})$/i.exec(input.signature)?.[1];
  if (!supplied) {
    return { ok: false, code: 'INVALID_SIGNATURE' };
  }

  const expected = computeSignature(input.secret, input);
  const actual = Buffer.from(supplied, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, code: 'INVALID_SIGNATURE' };
  }

  const accepted = await input.nonceStore.consume(input.nonce, new Date(timestamp + 60_000), now);
  return accepted ? { ok: true } : { ok: false, code: 'REPLAYED_NONCE' };
}
