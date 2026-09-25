import { describe, expect, it } from 'vitest';

import { createTargetRegistry, type TargetEntry } from './targetRegistry.js';

describe('Database target registry', () => {
  const healthyOpsTarget: TargetEntry = {
    id: 'ops',
    label: 'Ops Database',
    status: 'available',
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => undefined
      }),
      end: async () => undefined
    },
    databaseName: 'edutrack_ops',
    role: 'ops_database_browser'
  };

  it('never falls back from an unavailable requested target', async () => {
    const registry = createTargetRegistry([
      {
        id: 'edutrack_production',
        label: 'EduTrack Production',
        status: 'unavailable',
        code: 'DATABASE_TARGET_UNAVAILABLE'
      },
      healthyOpsTarget
    ]);
    expect(() => registry.get('edutrack_production')).toThrow('DATABASE_TARGET_UNAVAILABLE');
    expect(registry.get('ops').id).toBe('ops');
  });

  it('rejects target IDs absent from the closed union', () => {
    const registry = createTargetRegistry([healthyOpsTarget]);
    expect(() => registry.get('arbitrary_database')).toThrow('DATABASE_TARGET_INVALID');
  });

  it('rejects disabled targets with DATABASE_TARGET_UNAVAILABLE', () => {
    const registry = createTargetRegistry([
      { id: 'edutrack_production', label: 'EduTrack Production', status: 'disabled' },
      healthyOpsTarget
    ]);
    expect(() => registry.get('edutrack_production')).toThrow('DATABASE_TARGET_UNAVAILABLE');
  });

  it('produces summaries with status and readOnly', () => {
    const registry = createTargetRegistry([
      { id: 'edutrack_production', label: 'EduTrack Production', status: 'disabled' },
      healthyOpsTarget
    ]);
    expect(registry.summaries()).toEqual([
      {
        id: 'edutrack_production',
        label: 'EduTrack Production',
        status: 'disabled',
        readOnly: true
      },
      { id: 'ops', label: 'Ops Database', status: 'available', readOnly: true }
    ]);
  });
});
