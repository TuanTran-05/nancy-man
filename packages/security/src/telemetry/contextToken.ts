import { createHmac, timingSafeEqual } from 'node:crypto';

type TelemetryContext = {
  audience: 'edutrack-ops-ingest';
  channel: 'browser';
  userRef: string;
  role: string;
  displayLabel: string;
  sessionHash: string;
  nonce: string;
};

type SignedTelemetryContext = TelemetryContext & {
  issuedAt: string;
  expiresAt: string;
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signature(key: string, keyId: string, encodedPayload: string): Buffer {
  return createHmac('sha256', key).update(`v1.${keyId}.${encodedPayload}`, 'utf8').digest();
}

export function issueTelemetryContextToken(
  context: TelemetryContext,
  input: { keyId: string; key: string; now?: Date }
): string {
  const now = input.now ?? new Date();
  const payload: SignedTelemetryContext = {
    ...context,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1_000).toISOString()
  };
  const encodedPayload = encode(payload);
  const encodedSignature = signature(input.key, input.keyId, encodedPayload).toString('base64url');

  return `v1.${input.keyId}.${encodedPayload}.${encodedSignature}`;
}

export function verifyTelemetryContextToken(
  token: string,
  keyring: Record<string, string>,
  now = new Date()
): (TelemetryContext & { expiresAt: string }) | null {
  const [version, keyId, encodedPayload, encodedSignature, extra] = token.split('.');
  if (version !== 'v1' || !keyId || !encodedPayload || !encodedSignature || extra !== undefined) {
    return null;
  }
  const key = keyring[keyId];
  if (!key) {
    return null;
  }

  const expected = signature(key, keyId, encodedPayload);
  const actual = Buffer.from(encodedSignature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as SignedTelemetryContext;
    if (
      payload.audience !== 'edutrack-ops-ingest' ||
      payload.channel !== 'browser' ||
      !payload.userRef ||
      !payload.role ||
      !payload.displayLabel ||
      !payload.sessionHash ||
      !payload.nonce ||
      !Number.isFinite(Date.parse(payload.expiresAt)) ||
      Date.parse(payload.expiresAt) <= now.getTime()
    ) {
      return null;
    }

    return {
      audience: payload.audience,
      channel: payload.channel,
      userRef: payload.userRef,
      role: payload.role,
      displayLabel: payload.displayLabel,
      sessionHash: payload.sessionHash,
      nonce: payload.nonce,
      expiresAt: payload.expiresAt
    };
  } catch {
    return null;
  }
}
