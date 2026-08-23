import { describe, expect, it } from 'vitest';
import { evaluateMonitor } from './statusMachine.js';
import type { MonitorSample } from '../../shared/models.js';

const sample = (level: MonitorSample['level'], observedAt: string, details: Record<string, unknown> = {}, errorCode: string | null = null): MonitorSample => ({ monitor: 'app_liveness', level, observedAt, latencyMs: null, details, errorCode });

describe('monitor state machine', () => {
  it('raises critical only after two failed app probes and recovers after two healthy probes', () => {
    const firstFailure = sample('critical', '2026-08-23T00:00:00Z', { probeOk: false }, 'down');
    const secondFailure = sample('critical', '2026-08-23T00:00:15Z', { probeOk: false }, 'down');
    expect(evaluateMonitor([firstFailure], secondFailure).level).toBe('critical');
    const firstHealthy = sample('healthy', '2026-08-23T00:01:00Z', { probeOk: true });
    const secondHealthy = sample('healthy', '2026-08-23T00:01:15Z', { probeOk: true });
    expect(evaluateMonitor([firstFailure, secondFailure, firstHealthy], secondHealthy).transition).toBe('recovered');
  });

  it('starts unknown without alerting on the first failure', () => {
    expect(evaluateMonitor([], sample('critical', '2026-08-23T00:00:00Z', { probeOk: false })).level).toBe('unknown');
  });

  it('requires sustained lock and connection pressure thresholds', () => {
    const make = (time: string, locks: number, count: number): MonitorSample => ({ monitor: 'postgres', level: 'healthy', observedAt: time, latencyMs: 2, details: { waitingLockCount: locks, connectionStates: { active: count }, settings: { maxConnections: 100 } }, errorCode: null });
    const history = [make('2026-08-23T00:00:00Z', 1, 95), make('2026-08-23T00:03:00Z', 1, 95)];
    expect(evaluateMonitor(history, make('2026-08-23T00:05:00Z', 1, 95)).level).toBe('critical');
  });
});
