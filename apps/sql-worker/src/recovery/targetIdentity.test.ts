import { describe, expect, it } from 'vitest';

import { assertIsolatedTarget } from './targetIdentity.js';

const production = {
  hostId: 'postgres-primary-01',
  database: 'edutrack',
  systemId: 'production-system-identifier'
};

describe('assertIsolatedTarget', () => {
  it('rejects production itself as a recovery target', () => {
    expect(() => assertIsolatedTarget(production, production, ['restore-01'])).toThrow(
      /production/i
    );
  });

  it('requires a dedicated allowed host and an edutrack_recovery_ database name', () => {
    expect(() =>
      assertIsolatedTarget(
        production,
        {
          hostId: 'unapproved-host',
          database: 'edutrack_recovery_20260822',
          systemId: 'recovery-1'
        },
        ['restore-01']
      )
    ).toThrow(/allowlist/i);

    expect(() =>
      assertIsolatedTarget(
        production,
        { hostId: 'restore-01', database: 'restored_copy', systemId: 'recovery-1' },
        ['restore-01']
      )
    ).toThrow(/edutrack_recovery_/i);
  });
});
