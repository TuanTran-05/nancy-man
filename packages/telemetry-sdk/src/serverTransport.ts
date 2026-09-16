import { createHash, createHmac, randomBytes } from 'node:crypto';

import type { TelemetryEnvelopeV1 } from '../../contracts/src/telemetry.js';

function validateEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  if (
    parsed.protocol !== 'https:' ||
    parsed.pathname !== '/api/v1/ingest/server' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('SERVER_TELEMETRY_ENDPOINT_INVALID');
  }
  return parsed.toString();
}

function requestSignature(input: {
  secret: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}): string {
  const bodyHash = createHash('sha256').update(input.rawBody, 'utf8').digest('hex');
  const canonical = [
    'v1',
    'POST',
    '/api/v1/ingest/server',
    input.timestamp,
    input.nonce,
    bodyHash
  ].join('\n');
  return `v1=${createHmac('sha256', input.secret).update(canonical, 'utf8').digest('hex')}`;
}

export function createSignedServerTransport(input: {
  endpoint: string;
  keyId: string;
  secret: string;
  now?: () => Date;
  nonce?: () => string;
  fetch?: typeof globalThis.fetch;
}): (envelope: TelemetryEnvelopeV1) => Promise<void> {
  const endpoint = validateEndpoint(input.endpoint);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(input.keyId) || input.secret.length < 16) {
    throw new Error('SERVER_TELEMETRY_CREDENTIALS_INVALID');
  }
  const now = input.now ?? (() => new Date());
  const nonce = input.nonce ?? (() => randomBytes(24).toString('base64url'));
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function')
    throw new Error('SERVER_TELEMETRY_FETCH_UNAVAILABLE');

  return async (envelope) => {
    const rawBody = JSON.stringify(envelope);
    const timestamp = now().toISOString();
    const requestNonce = nonce();
    if (!/^[A-Za-z0-9_-]{16,255}$/.test(requestNonce)) {
      throw new Error('SERVER_TELEMETRY_NONCE_INVALID');
    }
    const response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ops-Key-Id': input.keyId,
        'X-Ops-Timestamp': timestamp,
        'X-Ops-Nonce': requestNonce,
        'X-Ops-Signature': requestSignature({
          secret: input.secret,
          timestamp,
          nonce: requestNonce,
          rawBody
        })
      },
      body: rawBody
    });
    if (response.status !== 202) throw new Error('SERVER_TELEMETRY_NOT_ACCEPTED');
  };
}
