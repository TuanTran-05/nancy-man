import { describe, expect, it } from 'vitest';

import { resolveRuntimeCredentials } from './main.js';

const config = {
  apiHost: '127.0.0.1' as const,
  apiPort: 3100,
  publicUrl: 'https://man.thienuy.edu.vn' as const,
  secretDirectory: '/run/credentials/edutrack-ops-api.service',
  databaseUrlReference: 'ops-database-url',
  sessionPepperReference: 'ops-session-pepper',
  rateLimitPepperReference: 'ops-rate-limit-pepper',
  browserContextKey: {
    id: 'edutrack-browser-v1',
    secretReference: 'browser-context-edutrack-v1'
  },
  objectStoreDirectory: '/var/lib/edutrack-ops/object-store',
  browserCorsOrigins: ['https://thienuy.edu.vn']
};

describe('resolveRuntimeCredentials', () => {
  it('loads only the four required credentials before starting the Ops API', async () => {
    const requested: string[] = [];

    await expect(
      resolveRuntimeCredentials({
        config,
        resolveSecret: async (reference) => {
          requested.push(reference);
          return `value-for-${reference}`;
        }
      })
    ).resolves.toEqual({
      databaseUrl: 'value-for-ops-database-url',
      sessionPepper: 'value-for-ops-session-pepper',
      rateLimitPepper: 'value-for-ops-rate-limit-pepper',
      browserContextKey: 'value-for-browser-context-edutrack-v1'
    });
    expect(requested.sort()).toEqual([
      'browser-context-edutrack-v1',
      'ops-database-url',
      'ops-rate-limit-pepper',
      'ops-session-pepper'
    ]);
  });

  it('fails closed without putting a missing credential reference in the startup error', async () => {
    await expect(
      resolveRuntimeCredentials({
        config,
        resolveSecret: async (reference) =>
          reference === 'ops-database-url' ? 'postgres://ops:password@localhost/ops' : null
      })
    ).rejects.toThrow('Ops API runtime credentials are unavailable');
  });
});
