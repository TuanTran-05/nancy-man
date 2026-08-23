import type { MonitorLevel, MonitorSample } from '../../shared/models.js';

export type Transition = 'opened' | 'changed' | 'recovered' | null;

export interface Evaluation {
  level: MonitorLevel;
  transition: Transition;
  dedupeKey: string;
  safeSummary: string;
}

const isHealthy = (sample: MonitorSample) => sample.level === 'healthy';
const trailing = (samples: MonitorSample[], predicate: (sample: MonitorSample) => boolean): MonitorSample[] => {
  const result: MonitorSample[] = [];
  for (let index = samples.length - 1; index >= 0 && predicate(samples[index]); index--) result.unshift(samples[index]);
  return result;
};

const sustained = (samples: MonitorSample[], predicate: (sample: MonitorSample) => boolean, milliseconds: number): boolean => {
  const matches = trailing(samples, predicate);
  if (matches.length < 2) return false;
  return Date.parse(matches[matches.length - 1].observedAt) - Date.parse(matches[0].observedAt) >= milliseconds;
};

export function evaluateMonitor(history: MonitorSample[], sample: MonitorSample): Evaluation {
  const samples = [...history, sample];
  const previous = history.at(-1);
  const previousEffectiveLevel = (previous?.details.effectiveLevel as MonitorLevel | undefined) ?? previous?.level ?? 'unknown';
  const monitor = sample.monitor;
  const failure = sample.level === 'critical' || sample.level === 'warning' || sample.details.probeOk === false;
  let level: MonitorLevel = sample.level === 'healthy' ? 'healthy' : 'unknown';
  let reason = sample.errorCode ?? `${monitor}_state`;

  if (['app_liveness', 'app_health', 'app_process', 'postgres'].includes(monitor)) {
    const failures = trailing(samples, (item) => item.level !== 'healthy' || item.details.probeOk === false);
    const healthySamples = trailing(samples, isHealthy);
    if (failures.length >= 2) { level = 'critical'; reason = sample.errorCode ?? `${monitor}_failed`; }
    else if (previousEffectiveLevel === 'critical' && healthySamples.length < 2) { level = 'critical'; reason = 'awaiting_recovery_baseline'; }
    else if (failure) level = 'unknown';
  }

  const details = sample.details;
  const waitingLocks = Number(details.waitingLockCount ?? 0);
  const maxConnections = Number((details.settings as Record<string, unknown> | undefined)?.maxConnections ?? details.maxConnections ?? 0);
  const connectionStates = (details.connectionStates ?? {}) as Record<string, unknown>;
  const connectionCount = Object.values(connectionStates).reduce((total: number, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
  const ratio = maxConnections > 0 ? connectionCount / maxConnections : 0;
  const threshold5m = 5 * 60 * 1000;
  if (monitor === 'postgres' && waitingLocks > 0 && sustained(samples, (item) => Number(item.details.waitingLockCount ?? 0) > 0, threshold5m)) { level = 'critical'; reason = 'waiting_locks_critical'; }
  else if (monitor === 'postgres' && waitingLocks > 0 && trailing(samples, (item) => Number(item.details.waitingLockCount ?? 0) > 0).length >= 2) { level = 'warning'; reason = 'waiting_locks_warning'; }
  if (monitor === 'postgres' && ratio > 0.9 && sustained(samples, (item) => {
    const max = Number((item.details.settings as Record<string, unknown> | undefined)?.maxConnections ?? item.details.maxConnections ?? 0);
    const count = Object.values((item.details.connectionStates ?? {}) as Record<string, unknown>).reduce((sum: number, value) => sum + Number(value), 0);
    return max > 0 && count / max > 0.9;
  }, threshold5m)) { level = 'critical'; reason = 'connections_critical'; }
  else if (monitor === 'postgres' && ratio > 0.8 && sustained(samples, (item) => {
    const max = Number((item.details.settings as Record<string, unknown> | undefined)?.maxConnections ?? item.details.maxConnections ?? 0);
    const count = Object.values((item.details.connectionStates ?? {}) as Record<string, unknown>).reduce((sum: number, value) => sum + Number(value), 0);
    return max > 0 && count / max > 0.8;
  }, threshold5m)) { level = 'warning'; reason = 'connections_warning'; }
  if (['backup', 'cron'].includes(monitor) && sample.level !== 'healthy') { level = sample.level; reason = sample.errorCode ?? `${monitor}_failure`; }
  if (monitor === 'errors' && (Number(details.fingerprintCount5m ?? 0) >= 10 || details.isFatal === true)) { level = 'critical'; reason = details.isFatal === true ? 'fatal_log_line' : 'error_fingerprint_burst'; }

  const previousLevel = previousEffectiveLevel;
  const healthySamples = trailing(samples, isHealthy);
  const stateBeforeHealthy = samples.at(-(healthySamples.length + 1));
  const stateBeforeHealthyLevel = (stateBeforeHealthy?.details.effectiveLevel as MonitorLevel | undefined) ?? stateBeforeHealthy?.level ?? previousLevel;
  const healthyRecovery = isHealthy(sample) && healthySamples.length >= 2 && ['warning', 'critical'].includes(stateBeforeHealthyLevel);
  const transition: Transition = healthyRecovery ? 'recovered' : level !== previousLevel && (level === 'warning' || level === 'critical') ? (previousLevel === 'unknown' ? 'opened' : 'changed') : null;
  return { level, transition, dedupeKey: `${monitor}:${reason}`, safeSummary: `${monitor} ${level}`.slice(0, 500) };
}
