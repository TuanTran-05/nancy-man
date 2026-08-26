import { describe, expect, it } from 'vitest';
import { deriveCsrfSecret, hashCsrfSecret } from '../../../../../packages/security/src/sessions.js';

import { authorizeOpsSession } from './sessionAuthorization.js';

describe('authorizeOpsSession', () => {
  it('requires an active opaque session and a synchronizer CSRF proof for mutations', async () => {
    const session = {
      id: 'session-id',
      userId: 'user-id',
      sessionHash: 'a'.repeat(64),
      csrfSecretHash: hashCsrfSecret(
        deriveCsrfSecret({ sessionToken: 'token'.repeat(8), csrfPepper: 'pepper' })
      ),
      role: 'ops_owner' as const,
      lastActivityAt: '2026-08-22T03:00:00.000Z',
      idleExpiresAt: '2026-08-22T03:30:00.000Z',
      absoluteExpiresAt: '2026-08-22T15:00:00.000Z'
    };
    const cookie = `__Host-ops-session=${'token'.repeat(8)}`;
    await expect(
      authorizeOpsSession({
        cookieHeader: cookie,
        csrfToken: 'bad',
        mutation: true,
        sessionPepper: 'pepper',
        repository: { findActiveByToken: async () => session }
      })
    ).resolves.toBeNull();
    await expect(
      authorizeOpsSession({
        cookieHeader: cookie,
        mutation: false,
        sessionPepper: 'pepper',
        repository: { findActiveByToken: async () => session }
      })
    ).resolves.toMatchObject({ role: 'ops_owner', sessionId: 'session-id' });
  });
});
