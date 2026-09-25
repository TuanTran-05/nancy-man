import { describe, expect, it, vi } from 'vitest';

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

  it('produces summaries with status and readOnly', async () => {
    const registry = createTargetRegistry([
      { id: 'edutrack_production', label: 'EduTrack Production', status: 'disabled' },
      healthyOpsTarget
    ]);
    expect(await registry.summaries()).toEqual([
      {
        id: 'edutrack_production',
        label: 'EduTrack Production',
        status: 'disabled',
        readOnly: true
      },
      { id: 'ops', label: 'Ops Database', status: 'available', readOnly: true }
    ]);
  });

  it('isolates target health and recovers after an outage at the bounded probe cadence', async () => {
    let now = 10_000;
    let opsAvailable = true;
    const probed: string[] = [];
    const edutrack: TargetEntry = {
      ...healthyOpsTarget,
      id: 'edutrack_production',
      label: 'EduTrack Production'
    };
    const registry = createTargetRegistry([edutrack, healthyOpsTarget], {
      now: () => now,
      probe: async (target) => {
        probed.push(target.id);
        if (target.id === 'ops' && !opsAvailable) throw new Error('database offline');
      }
    });

    expect(await registry.summaries()).toMatchObject([
      { id: 'edutrack_production', status: 'available' },
      { id: 'ops', status: 'available' }
    ]);
    expect(probed).toEqual([]);

    now += 5_000;
    opsAvailable = false;
    expect(await registry.summaries()).toMatchObject([
      { id: 'edutrack_production', status: 'available' },
      { id: 'ops', status: 'unavailable', unavailableReason: 'DATABASE_TARGET_UNAVAILABLE' }
    ]);
    await registry.summaries();
    expect(probed).toEqual(['edutrack_production', 'ops']);
    expect(() => registry.get('ops')).toThrow('DATABASE_TARGET_UNAVAILABLE');

    now += 5_000;
    opsAvailable = true;
    expect(await registry.summaries()).toMatchObject([
      { id: 'edutrack_production', status: 'available' },
      { id: 'ops', status: 'available' }
    ]);
    expect(registry.get('ops').id).toBe('ops');
    expect(probed).toEqual(['edutrack_production', 'ops', 'edutrack_production', 'ops']);
  });

  it('shares one in-flight health probe across concurrent target listings', async () => {
    let now = 0;
    let releaseProbe: (() => void) | undefined;
    let probeCount = 0;
    const registry = createTargetRegistry([healthyOpsTarget], {
      now: () => now,
      probe: async () => {
        probeCount++;
        await new Promise<void>((resolve) => {
          releaseProbe = resolve;
        });
      }
    });
    now = 5_000;

    const first = registry.summaries();
    const second = registry.summaries();
    await Promise.resolve();
    expect(probeCount).toBe(1);
    releaseProbe?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('reports configured targets as disabled without probing them', async () => {
    let probed = false;
    const registry = createTargetRegistry(
      [{ id: 'edutrack_production', label: 'EduTrack Production', status: 'disabled' }],
      {
        probe: async () => {
          probed = true;
        }
      }
    );

    expect(await registry.summaries()).toEqual([
      {
        id: 'edutrack_production',
        label: 'EduTrack Production',
        status: 'disabled',
        readOnly: true
      }
    ]);
    expect(probed).toBe(false);
  });

  it('uses a one-second timeout on the SELECT 1 health query', async () => {
    let now = 0;
    let healthQuery: unknown;
    const target: TargetEntry = {
      ...healthyOpsTarget,
      pool: {
        ...healthyOpsTarget.pool,
        connectionTag: 'pool-receiver',
        query: async function <T>(this: { connectionTag: string }, sql: string) {
          expect(this.connectionTag).toBe('pool-receiver');
          healthQuery = sql;
          return { rows: [{ '?column?': 1 }] as T[] };
        },
        connect: async () => {
          const connection = {
            connectionTag: 'client-receiver',
            query: async function <T>(this: { connectionTag: string }, config: unknown) {
              expect(this.connectionTag).toBe('client-receiver');
              healthQuery = config;
              return { rows: [{ '?column?': 1 }] as T[] };
            },
            release: () => undefined
          };
          return connection;
        }
      }
    };
    const registry = createTargetRegistry([target], { now: () => now });
    now = 5_000;

    await registry.summaries();

    expect(healthQuery).toEqual({ text: 'SELECT 1', query_timeout: 1_000 });
  });

  it('marks a stalled probe unavailable at its deadline and keeps only one query in flight', async () => {
    let now = 0;
    let probeCount = 0;
    let releaseProbe: (() => void) | undefined;
    const registry = createTargetRegistry([healthyOpsTarget], {
      now: () => now,
      probeTimeoutMs: 10,
      probe: async () => {
        probeCount++;
        await new Promise<void>((resolve) => {
          releaseProbe = resolve;
        });
      }
    });
    now = 5_000;

    const result = await Promise.race([
      registry.summaries(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 50))
    ]);

    expect(result).toMatchObject([
      { id: 'ops', status: 'unavailable', unavailableReason: 'DATABASE_TARGET_UNAVAILABLE' }
    ]);
    await registry.summaries();
    expect(probeCount).toBe(1);
    releaseProbe?.();
  });

  it('shares the deadline-bounded promise between concurrent target listings', async () => {
    let now = 0;
    let probeCount = 0;
    const registry = createTargetRegistry([healthyOpsTarget], {
      now: () => now,
      probeTimeoutMs: 25,
      probe: async () => {
        probeCount++;
        await new Promise<void>(() => undefined);
      }
    });
    now = 5_000;
    const startedAt = Date.now();

    const result = await Promise.race([
      Promise.all([registry.summaries(), registry.summaries()]),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 100))
    ]);

    expect(result).toEqual([
      [
        {
          id: 'ops',
          label: 'Ops Database',
          status: 'unavailable',
          readOnly: true,
          unavailableReason: 'DATABASE_TARGET_UNAVAILABLE'
        }
      ],
      [
        {
          id: 'ops',
          label: 'Ops Database',
          status: 'unavailable',
          readOnly: true,
          unavailableReason: 'DATABASE_TARGET_UNAVAILABLE'
        }
      ]
    ]);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(probeCount).toBe(1);
  });

  it('does not let a probe that completes after its deadline restore availability', async () => {
    let now = 0;
    let releaseProbe: (() => void) | undefined;
    const registry = createTargetRegistry([healthyOpsTarget], {
      now: () => now,
      probeTimeoutMs: 10,
      probe: async () => {
        await new Promise<void>((resolve) => {
          releaseProbe = resolve;
        });
      }
    });
    now = 5_000;

    await expect(registry.summaries()).resolves.toMatchObject([{ status: 'unavailable' }]);
    releaseProbe?.();
    await Promise.resolve();
    await Promise.resolve();

    await expect(registry.summaries()).resolves.toMatchObject([{ status: 'unavailable' }]);
  });

  it('recovers after a never-settling probe while capping stale probes and clearing deadlines', async () => {
    let now = 0;
    let probeCount = 0;
    let activeProbes = 0;
    let maxActiveProbes = 0;
    const staleRejectors: Array<(error: Error) => void> = [];
    const registry = createTargetRegistry([healthyOpsTarget], {
      now: () => now,
      probeTimeoutMs: 10,
      probe: async () => {
        probeCount++;
        activeProbes++;
        maxActiveProbes = Math.max(maxActiveProbes, activeProbes);
        if (probeCount !== 2) {
          await new Promise<void>((_resolve, reject) => {
            staleRejectors.push(reject);
          }).finally(() => {
            activeProbes--;
          });
          return;
        }
        activeProbes--;
      }
    });
    now = 5_000;

    try {
      vi.useFakeTimers();
      const outageSummary = registry.summaries();
      await vi.advanceTimersByTimeAsync(10);
      await expect(outageSummary).resolves.toMatchObject([{ status: 'unavailable' }]);
      expect(vi.getTimerCount()).toBe(0);

      now += 5_000;
      await expect(registry.summaries()).resolves.toMatchObject([{ status: 'available' }]);
      expect(probeCount).toBe(2);

      now += 5_000;
      const secondStalledSummary = registry.summaries();
      await vi.advanceTimersByTimeAsync(10);
      await expect(secondStalledSummary).resolves.toMatchObject([{ status: 'unavailable' }]);
      expect(probeCount).toBe(3);

      now += 5_000;
      await registry.summaries();
      expect(probeCount).toBe(3);
      expect(maxActiveProbes).toBeLessThanOrEqual(2);
      expect(vi.getTimerCount()).toBe(0);

      for (const reject of staleRejectors) reject(new Error('late probe failure'));
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds pool acquisition through the configured target pool and skips query on acquire failure', async () => {
    let now = 0;
    let queryCalls = 0;
    let connectCalls = 0;
    const target: TargetEntry = {
      ...healthyOpsTarget,
      pool: {
        ...healthyOpsTarget.pool,
        query: async () => {
          queryCalls++;
          return { rows: [] };
        },
        connect: async () => {
          connectCalls++;
          throw new Error('timeout exceeded when trying to connect');
        }
      }
    };
    const registry = createTargetRegistry([target], { now: () => now, probeTimeoutMs: 10 });
    now = 5_000;

    await expect(registry.summaries()).resolves.toMatchObject([{ status: 'unavailable' }]);

    expect(connectCalls).toBe(1);
    expect(queryCalls).toBe(0);
  });

  it('destroys an acquired client exactly once when a health query reaches its deadline', async () => {
    let now = 0;
    let queryStarted = false;
    const releaseCalls: Array<Error | boolean | undefined> = [];
    let rejectQuery: ((error: Error) => void) | undefined;
    const target: TargetEntry = {
      ...healthyOpsTarget,
      pool: {
        ...healthyOpsTarget.pool,
        query: async () => ({ rows: [] }),
        connect: async () => ({
          query: async <T>(config: unknown) => {
            expect(config).toEqual({ text: 'SELECT 1', query_timeout: 1_000 });
            queryStarted = true;
            return new Promise<{ rows: T[] }>((_resolve, reject) => {
              rejectQuery = reject;
            });
          },
          release: (error?: Error | boolean) => {
            releaseCalls.push(error);
            if (error instanceof Error) rejectQuery?.(error);
          }
        })
      }
    };
    const registry = createTargetRegistry([target], { now: () => now, probeTimeoutMs: 10 });
    now = 5_000;

    const result = await registry.summaries();

    expect(result).toMatchObject([{ status: 'unavailable' }]);
    expect(queryStarted).toBe(true);
    expect(releaseCalls).toHaveLength(1);
    expect(releaseCalls[0]).toBeInstanceOf(Error);
  });
});
