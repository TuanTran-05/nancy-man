import { describe, expect, it } from 'vitest';
import { evaluateMonitor } from './statusMachine.js';
import type { MonitorSample } from '../../shared/models.js';

const sample = (
  level: MonitorSample['level'],
  observedAt: string,
  details: Record<string, unknown> = {},
  errorCode: string | null = null
): MonitorSample => ({
  monitor: 'app_liveness',
  level,
  observedAt,
  latencyMs: null,
  details,
  errorCode
});

describe('monitor state machine', () => {
  it('raises critical only after two failed app probes and recovers after two healthy probes', () => {
    const firstFailure = sample('critical', '2026-08-23T00:00:00Z', { probeOk: false }, 'down');
    const secondFailure = sample('critical', '2026-08-23T00:00:15Z', { probeOk: false }, 'down');
    expect(evaluateMonitor([firstFailure], secondFailure).level).toBe('critical');
    const firstHealthy = sample('healthy', '2026-08-23T00:01:00Z', {
      probeOk: true,
      effectiveLevel: 'critical'
    });
    const secondHealthy = sample('healthy', '2026-08-23T00:01:15Z', { probeOk: true });
    expect(
      evaluateMonitor([firstFailure, secondFailure, firstHealthy], secondHealthy).transition
    ).toBe('recovered');
  });

  it('starts unknown without alerting on the first failure', () => {
    expect(
      evaluateMonitor([], sample('critical', '2026-08-23T00:00:00Z', { probeOk: false })).level
    ).toBe('unknown');
  });

  it('does not emit recovery again after the monitor is already healthy', () => {
    const history = [
      sample(
        'critical',
        '2026-08-23T00:00:00Z',
        { probeOk: false, effectiveLevel: 'critical' },
        'down'
      ),
      sample('healthy', '2026-08-23T00:00:15Z', { probeOk: true, effectiveLevel: 'critical' }),
      sample('healthy', '2026-08-23T00:00:30Z', { probeOk: true, effectiveLevel: 'healthy' })
    ];

    expect(
      evaluateMonitor(history, sample('healthy', '2026-08-23T00:00:45Z', { probeOk: true }))
        .transition
    ).toBeNull();
  });

  it('emits recovery on the second healthy sample for a non-probe monitor', () => {
    const warning: MonitorSample = {
      ...sample(
        'warning',
        '2026-08-23T00:00:00Z',
        { effectiveLevel: 'warning' },
        'backup_local_only'
      ),
      monitor: 'backup'
    };
    const firstHealthy: MonitorSample = {
      ...sample('healthy', '2026-08-23T00:00:15Z', { effectiveLevel: 'healthy' }),
      monitor: 'backup'
    };
    const secondHealthy: MonitorSample = {
      ...sample('healthy', '2026-08-23T00:00:30Z'),
      monitor: 'backup'
    };

    expect(evaluateMonitor([warning, firstHealthy], secondHealthy).transition).toBe('recovered');
  });

  it('recovers PostgreSQL pressure once after the metrics clear', () => {
    const postgres = (
      observedAt: string,
      waitingLockCount: number,
      effectiveLevel?: MonitorSample['level']
    ): MonitorSample => ({
      monitor: 'postgres',
      level: 'healthy',
      observedAt,
      latencyMs: 2,
      details: { waitingLockCount, ...(effectiveLevel ? { effectiveLevel } : {}) },
      errorCode: null
    });
    const firstPressure = postgres('2026-08-23T00:00:00Z', 1, 'healthy');
    const secondPressure = postgres('2026-08-23T00:00:15Z', 1);
    const pressureEvaluation = evaluateMonitor([firstPressure], secondPressure);
    const storedPressure = postgres('2026-08-23T00:00:15Z', 1, pressureEvaluation.level);
    const firstClear = postgres('2026-08-23T00:00:30Z', 0);
    const recoveryEvaluation = evaluateMonitor([firstPressure, storedPressure], firstClear);
    const storedClear = postgres('2026-08-23T00:00:30Z', 0, recoveryEvaluation.level);

    expect(pressureEvaluation.level).toBe('warning');
    expect(recoveryEvaluation.transition).toBe('recovered');
    expect(
      evaluateMonitor(
        [firstPressure, storedPressure, storedClear],
        postgres('2026-08-23T00:00:45Z', 0)
      ).transition
    ).toBeNull();
  });

  it('requires sustained lock and connection pressure thresholds', () => {
    const make = (time: string, locks: number, count: number): MonitorSample => ({
      monitor: 'postgres',
      level: 'healthy',
      observedAt: time,
      latencyMs: 2,
      details: {
        waitingLockCount: locks,
        connectionStates: { active: count },
        settings: { maxConnections: 100 }
      },
      errorCode: null
    });
    const history = [make('2026-08-23T00:00:00Z', 1, 95), make('2026-08-23T00:03:00Z', 1, 95)];
    expect(evaluateMonitor(history, make('2026-08-23T00:05:00Z', 1, 95)).level).toBe('critical');
  });

  const resource = (
    observedAt: string,
    overrides: Record<string, unknown> = {}
  ): MonitorSample => ({
    monitor: 'host_resources',
    level: 'healthy',
    observedAt,
    latencyMs: null,
    details: {
      cpuPercent: 10,
      memoryPercent: 10,
      diskPercent: 10,
      load5: 0.1,
      cpuThreads: 4,
      ...overrides
    },
    errorCode: null
  });
  const minuteHistory = (value: number, minutes: number, field: string): MonitorSample[] =>
    Array.from({ length: minutes }, (_, index) =>
      resource(`2026-08-23T00:${String(index).padStart(2, '0')}:00Z`, { [field]: value })
    );

  it('applies exact resource thresholds and sustained windows', () => {
    expect(
      evaluateMonitor(
        minuteHistory(85, 10, 'cpuPercent'),
        resource('2026-08-23T00:10:00Z', { cpuPercent: 85 })
      ).level
    ).toBe('warning');
    expect(
      evaluateMonitor(
        minuteHistory(95, 10, 'cpuPercent'),
        resource('2026-08-23T00:10:00Z', { cpuPercent: 95 })
      )
    ).toMatchObject({ level: 'critical', dedupeKey: 'host_resources:cpu_critical' });
    expect(
      evaluateMonitor(
        minuteHistory(95, 5, 'memoryPercent'),
        resource('2026-08-23T00:05:00Z', { memoryPercent: 95 })
      ).level
    ).toBe('critical');
    expect(
      evaluateMonitor(
        [resource('2026-08-23T00:00:00Z', { diskPercent: 90 })],
        resource('2026-08-23T00:01:00Z', { diskPercent: 90 })
      )
    ).toMatchObject({ level: 'critical', dedupeKey: 'host_resources:disk_critical' });
    expect(
      evaluateMonitor(
        minuteHistory(4, 10, 'load5'),
        resource('2026-08-23T00:10:00Z', { load5: 4, cpuThreads: 4 })
      )
    ).toMatchObject({ level: 'warning', dedupeKey: 'host_resources:load_warning' });
  });

  it('uses critical severity and deterministic disk-first priority', () => {
    const history = minuteHistory(95, 10, 'cpuPercent').map((item) => ({
      ...item,
      details: { ...item.details, memoryPercent: 95, diskPercent: 90, load5: 6 }
    }));
    expect(
      evaluateMonitor(
        history,
        resource('2026-08-23T00:10:00Z', {
          cpuPercent: 95,
          memoryPercent: 95,
          diskPercent: 90,
          load5: 6
        })
      )
    ).toMatchObject({ level: 'critical', dedupeKey: 'host_resources:disk_critical' });
    const memoryHistory = Array.from({ length: 5 }, (_, index) =>
      resource(`2026-08-23T00:0${index}:00Z`, { diskPercent: 80, memoryPercent: 95 })
    );
    expect(
      evaluateMonitor(
        memoryHistory,
        resource('2026-08-23T00:05:00Z', { diskPercent: 80, memoryPercent: 95 })
      )
    ).toMatchObject({ level: 'critical', dedupeKey: 'host_resources:memory_critical' });
    expect(
      evaluateMonitor(
        [],
        resource('2026-08-23T00:00:00Z', {
          swapPercent: 99,
          diskIoUtilizationPercent: 99,
          networkReceiveBytesPerSecond: 999
        })
      )
    ).toMatchObject({ level: 'healthy', conditionHealthy: true });
  });

  it('requires two consecutive Beszel failures and the same failed service', () => {
    const failed = (at: string, errorCode = 'beszel_timeout'): MonitorSample => ({
      monitor: 'beszel',
      level: 'critical',
      observedAt: at,
      latencyMs: null,
      details: { probeOk: false },
      errorCode
    });
    expect(evaluateMonitor([], failed('2026-08-23T00:00:00Z')).level).toBe('unknown');
    expect(
      evaluateMonitor([failed('2026-08-23T00:00:00Z')], failed('2026-08-23T00:00:15Z'))
    ).toMatchObject({ level: 'critical', dedupeKey: 'beszel:beszel_unavailable' });
    const services = (at: string, failedServices: string[]): MonitorSample => ({
      monitor: 'host_services',
      level: 'healthy',
      observedAt: at,
      latencyMs: null,
      details: { failedServices, services: [] },
      errorCode: null
    });
    expect(
      evaluateMonitor(
        [services('2026-08-23T00:00:00Z', ['nginx'])],
        services('2026-08-23T00:00:15Z', ['nginx', 'postgresql'])
      )
    ).toMatchObject({ level: 'critical', dedupeKey: 'host_services:service_failed:nginx' });
    expect(
      evaluateMonitor(
        [services('2026-08-23T00:00:00Z', ['nginx'])],
        services('2026-08-23T00:00:15Z', ['postgresql'])
      ).level
    ).toBe('healthy');
  });

  it('waits for a second genuinely clear sample before infrastructure recovery', () => {
    const badHistory = minuteHistory(95, 10, 'cpuPercent').map((item) => ({
      ...item,
      details: { ...item.details, conditionHealthy: false }
    }));
    const bad = resource('2026-08-23T00:10:00Z', { cpuPercent: 95, conditionHealthy: false });
    const evaluatedBad = evaluateMonitor(badHistory, bad);
    const storedBad = {
      ...bad,
      details: {
        ...bad.details,
        effectiveLevel: evaluatedBad.level,
        conditionHealthy: evaluatedBad.conditionHealthy
      }
    };
    const clear = resource('2026-08-23T00:10:00Z');
    const firstClear = evaluateMonitor([...badHistory, storedBad], clear);
    expect(firstClear.transition).toBeNull();
    const storedClear = {
      ...clear,
      details: {
        ...clear.details,
        effectiveLevel: firstClear.level,
        conditionHealthy: firstClear.conditionHealthy
      }
    };
    expect(
      evaluateMonitor([...badHistory, storedBad, storedClear], resource('2026-08-23T00:11:00Z'))
        .transition
    ).toBe('recovered');
    expect(
      evaluateMonitor(
        [...badHistory, storedBad],
        resource('2026-08-23T00:10:00Z', { cpuPercent: 95 })
      ).transition
    ).toBeNull();
  });
});
