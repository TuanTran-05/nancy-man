import { describe, expect, it } from 'vitest';

import { assertPolicyApproved, type DatabasePolicyApproval } from './policyApproval.js';

describe('Database policy approval check', () => {
  it('blocks row access when the live schema checksum is not approved', () => {
    expect(() =>
      assertPolicyApproved({
        targetId: 'ops',
        liveChecksum: 'b'.repeat(64),
        approval: { version: '2026-09-25', targets: { ops: 'a'.repeat(64) } }
      })
    ).toThrowError('DATABASE_SCHEMA_STALE');
  });

  it('rejects missing or wrong policy approval version', () => {
    expect(() =>
      assertPolicyApproved({
        targetId: 'ops',
        liveChecksum: 'a'.repeat(64),
        approval: { version: 'wrong-version', targets: { ops: 'a'.repeat(64) } }
      })
    ).toThrowError('DATABASE_SCHEMA_STALE');

    expect(() =>
      assertPolicyApproved({
        targetId: 'ops',
        liveChecksum: 'a'.repeat(64),
        approval: undefined as unknown as DatabasePolicyApproval
      })
    ).toThrowError('DATABASE_SCHEMA_STALE');
  });

  it('rejects unapproved target even if other targets are approved', () => {
    expect(() =>
      assertPolicyApproved({
        targetId: 'edutrack_production',
        liveChecksum: 'a'.repeat(64),
        approval: { version: '2026-09-25', targets: { ops: 'a'.repeat(64) } }
      })
    ).toThrowError('DATABASE_SCHEMA_STALE');
  });

  it('succeeds when target checksum matches approved checksum', () => {
    expect(() =>
      assertPolicyApproved({
        targetId: 'ops',
        liveChecksum: 'a'.repeat(64),
        approval: { version: '2026-09-25', targets: { ops: 'a'.repeat(64) } }
      })
    ).not.toThrow();
  });
});
