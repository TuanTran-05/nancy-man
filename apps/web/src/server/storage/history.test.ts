import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpsStore } from './store.js';
import type { MonitorSample } from '../../shared/models.js';

const dirs: string[] = [];
const makeStore = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ops-history-'));
  dirs.push(dir);
  return createOpsStore(join(dir, 'ops.sqlite'), () => new Date('2026-08-24T00:10:00.000Z'));
};
const sample = (observedAt: string, details: Record<string, unknown>): MonitorSample => ({
  monitor: 'host_resources',
  level: 'healthy',
  observedAt,
  latencyMs: null,
  details,
  errorCode: null
});

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('infrastructure history storage', () => {
  it('aggregates UTC buckets, preserves nullable metrics and excludes samples outside 30 days', () => {
    const store = makeStore();
    store.recordSample(
      sample('2026-08-23T23:59:30.000Z', { cpuPercent: 40, memoryPercent: 50, load1: 1 })
    );
    store.recordSample(
      sample('2026-08-24T00:00:30.000Z', {
        cpuPercent: 50,
        memoryPercent: 60,
        networkReceiveBytesPerSecond: 10
      })
    );
    store.recordSample(sample('2026-07-01T00:00:00.000Z', { cpuPercent: 99 }));
    const points = store.readInfrastructureHistory({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-24T00:10:00.000Z',
      resolutionSeconds: 300,
      limit: 720
    });
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      observedAt: '2026-08-23T23:55:00.000Z',
      cpuPercent: 40,
      memoryPercent: 50,
      load1: 1,
      networkReceiveBytesPerSecond: null
    });
    expect(points[1]).toMatchObject({
      observedAt: '2026-08-24T00:00:00.000Z',
      cpuPercent: 50,
      memoryPercent: 60,
      networkReceiveBytesPerSecond: 10
    });
  });

  it('validates timestamps, resolution and bounded parameterized input', () => {
    const store = makeStore();
    expect(() =>
      store.readInfrastructureHistory({
        from: "2026-08-24T00:00:00.000Z' OR 1=1 --",
        to: '2026-08-24T00:10:00.000Z',
        resolutionSeconds: 60,
        limit: 720
      })
    ).toThrow('Invalid infrastructure history timestamp');
    expect(() =>
      store.readInfrastructureHistory({
        from: '2026-08-24T00:00:00.000Z',
        to: '2026-08-24T00:10:00.000Z',
        resolutionSeconds: 61 as 60,
        limit: 720
      })
    ).toThrow('Invalid infrastructure history resolution');
    expect(() =>
      store.readInfrastructureHistory({
        from: '2026-08-24T00:00:00.000Z',
        to: '2026-08-24T00:10:00.000Z',
        resolutionSeconds: 60,
        limit: 721
      })
    ).toThrow('Invalid infrastructure history limit');
    expect(() =>
      store.readInfrastructureHistory({
        from: '2026-08-24T01:00:00.000Z',
        to: '2026-08-24T00:10:00.000Z',
        resolutionSeconds: 60,
        limit: 720
      })
    ).toThrow('Invalid infrastructure history range');
    expect(store.getDatabaseForBackup().prepare('SELECT 1').get()).toEqual({ 1: 1 });
  });
});
