import { describe, expect, it } from 'vitest';

import { serializeConfigChangeSse } from './configChangeEvents.js';

const status = {
  changeId: '11111111-1111-4111-8111-111111111111',
  state: 'READY' as const,
  sequence: 1,
  changeDigest: `hmac-sha256:v1:${'a'.repeat(64)}`,
  events: [
    {
      eventId: '22222222-2222-4222-8222-222222222222',
      changeId: '11111111-1111-4111-8111-111111111111',
      sequence: 1,
      state: 'READY' as const,
      reasonCode: 'validation_ready',
      occurredAt: '2026-08-31T13:10:00.000Z'
    }
  ]
};

describe('config change SSE', () => {
  it('serializes value-free replay IDs and heartbeats', () => {
    const output = serializeConfigChangeSse(status);
    expect(output).toContain('id: 22222222-2222-4222-8222-222222222222');
    expect(output).toContain('event: change');
    expect(output).toContain(': heartbeat');
    expect(output).not.toContain('value');
  });

  it('rejects a status payload with an unregistered value field', () => {
    expect(() => serializeConfigChangeSse({ ...status, value: 'secret' } as never)).toThrow();
  });
});
