import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assertPermission,
  createCsrfToken,
  hashSessionToken,
  isSqlElevationActive,
  issueSession,
  verifyCsrfToken
} from './sessions.js';

describe('Ops sessions and authorization', () => {
  it('issues an opaque session with separate idle and absolute expiry', () => {
    const now = new Date('2026-08-22T03:14:00.000Z');
    const issued = issueSession({
      now,
      randomBytes: (size) => Buffer.alloc(size, 7)
    });

    expect(issued.token).toHaveLength(64);
    expect(issued.idleExpiresAt).toBe('2026-08-22T03:44:00.000Z');
    expect(issued.absoluteExpiresAt).toBe('2026-08-22T15:14:00.000Z');
    expect(hashSessionToken(issued.token, 'pepper')).toBe(
      createHash('sha256').update(`${issued.token}pepper`).digest('hex')
    );
  });

  it('binds the synchronizer CSRF token to the session secret', () => {
    const csrfToken = createCsrfToken({ sessionId: 'session-01', csrfSecret: 'csrf-secret' });

    expect(verifyCsrfToken({ sessionId: 'session-01', csrfSecret: 'csrf-secret', csrfToken })).toBe(
      true
    );
    expect(verifyCsrfToken({ sessionId: 'session-02', csrfSecret: 'csrf-secret', csrfToken })).toBe(
      false
    );
  });

  it('enforces RBAC and a separate 15-minute SQL elevation', () => {
    expect(() => assertPermission('ops_viewer', 'sql:read')).toThrow(/permission/i);
    expect(() => assertPermission('ops_maintainer', 'sql:workspace')).not.toThrow();
    expect(
      isSqlElevationActive(
        { grantedAt: '2026-08-22T03:00:00.000Z', expiresAt: '2026-08-22T03:15:00.000Z' },
        new Date('2026-08-22T03:14:00.000Z')
      )
    ).toBe(true);
    expect(
      isSqlElevationActive(
        { grantedAt: '2026-08-22T03:00:00.000Z', expiresAt: '2026-08-22T03:15:00.000Z' },
        new Date('2026-08-22T03:16:00.000Z')
      )
    ).toBe(false);
  });
});
