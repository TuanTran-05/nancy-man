import { describe, expect, it } from 'vitest';

import { createSignedServerTransport } from './serverTransport.js';

const envelope = {
  schemaVersion: 1 as const,
  eventId: 'EVT_00000000000000000000000000' as const,
  idempotencyKey: 'EVT_00000000000000000000000000',
  capturedAt: '2026-09-04T00:00:00.000Z',
  source: 'api' as const,
  level: 'error' as const,
  error: { name: 'Error', code: 'API_FAILURE', safeMessage: 'Request failed' },
  context: {
    release: '0123456789abcdef0123456789abcdef01234567',
    service: 'edutrack-ops-api',
    environment: 'production' as const
  }
};

describe('signed server telemetry transport', () => {
  it('sends an authenticated server-ingest request and requires acknowledgement', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = createSignedServerTransport({
      endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/server',
      keyId: 'edutrack-ops-api',
      secret: 'a'.repeat(32),
      now: () => new Date('2026-09-04T00:00:00.000Z'),
      nonce: () => 'nonce-0123456789abcdef',
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ accepted: true }), { status: 202 });
      }
    });

    await transport(envelope);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://man.thienuy.edu.vn/api/v1/ingest/server');
    const headers = new Headers(requests[0]?.init.headers);
    expect(headers.get('X-Ops-Key-Id')).toBe('edutrack-ops-api');
    expect(headers.get('X-Ops-Timestamp')).toBe('2026-09-04T00:00:00.000Z');
    expect(headers.get('X-Ops-Nonce')).toBe('nonce-0123456789abcdef');
    expect(headers.get('X-Ops-Signature')).toMatch(/^v1=[a-f0-9]{64}$/);
  });

  it('fails closed for a collector response other than 202', async () => {
    const transport = createSignedServerTransport({
      endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/server',
      keyId: 'edutrack-ops-api',
      secret: 'a'.repeat(32),
      fetch: async () => new Response('{}', { status: 503 })
    });

    await expect(transport(envelope)).rejects.toThrow('SERVER_TELEMETRY_NOT_ACCEPTED');
  });
});
