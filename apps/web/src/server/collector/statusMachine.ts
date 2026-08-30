import type { MonitorLevel, MonitorSample } from '../../shared/models.js';

export type Transition = 'opened' | 'changed' | 'recovered' | null;

export interface Evaluation {
  level: MonitorLevel;
  transition: Transition;
  dedupeKey: string;
  safeSummary: string;
  conditionHealthy: boolean;
}

type Candidate = { level: 'warning' | 'critical'; reason: string; priority: number };
const alertLevels: MonitorLevel[] = ['warning', 'critical'];

const isHealthy = (sample: MonitorSample): boolean =>
  sample.level === 'healthy' && sample.details.probeOk !== false;
const trailing = (
  samples: MonitorSample[],
  predicate: (sample: MonitorSample) => boolean
): MonitorSample[] => {
  const result: MonitorSample[] = [];
  for (let index = samples.length - 1; index >= 0 && predicate(samples[index]); index--)
    result.unshift(samples[index]);
  return result;
};

const sustained = (
  samples: MonitorSample[],
  predicate: (sample: MonitorSample) => boolean,
  milliseconds: number
): boolean => {
  const matches = trailing(samples, predicate);
  if (matches.length < 2) return false;
  const first = Date.parse(matches[0].observedAt);
  const last = Date.parse(matches[matches.length - 1].observedAt);
  return Number.isFinite(first) && Number.isFinite(last) && last - first >= milliseconds;
};

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const effectiveLevel = (sample: MonitorSample | undefined): MonitorLevel => {
  const value = sample?.details.effectiveLevel;
  return value === 'unknown' || value === 'healthy' || value === 'warning' || value === 'critical'
    ? value
    : (sample?.level ?? 'unknown');
};
const storedConditionHealthy = (sample: MonitorSample): boolean =>
  typeof sample.details.conditionHealthy === 'boolean'
    ? sample.details.conditionHealthy
    : isHealthy(sample);
const choose = (items: Candidate[]): Candidate | undefined =>
  [...items].sort((a, b) =>
    a.level === b.level ? a.priority - b.priority : a.level === 'critical' ? -1 : 1
  )[0];
const RESOURCE_PRIORITY = { disk: 0, memory: 1, cpu: 2, load: 3 } as const;

function evaluateResources(
  samples: MonitorSample[],
  details: Record<string, unknown>
): { candidate?: Candidate; conditionHealthy: boolean } {
  const cpu = finiteNumber(details.cpuPercent);
  const memory = finiteNumber(details.memoryPercent);
  const disk = finiteNumber(details.diskPercent);
  const load5 = finiteNumber(details.load5);
  const threads = finiteNumber(details.cpuThreads);
  const loadRatio = load5 !== null && threads !== null && threads > 0 ? load5 / threads : null;
  const candidates: Candidate[] = [];
  if (
    sustained(
      samples,
      (item) => (finiteNumber(item.details.cpuPercent) ?? -Infinity) >= 95,
      10 * 60_000
    )
  )
    candidates.push({ level: 'critical', reason: 'cpu_critical', priority: RESOURCE_PRIORITY.cpu });
  else if (
    sustained(
      samples,
      (item) => (finiteNumber(item.details.cpuPercent) ?? -Infinity) >= 85,
      10 * 60_000
    )
  )
    candidates.push({ level: 'warning', reason: 'cpu_warning', priority: RESOURCE_PRIORITY.cpu });
  if (
    sustained(
      samples,
      (item) => (finiteNumber(item.details.memoryPercent) ?? -Infinity) >= 95,
      5 * 60_000
    )
  )
    candidates.push({
      level: 'critical',
      reason: 'memory_critical',
      priority: RESOURCE_PRIORITY.memory
    });
  else if (
    sustained(
      samples,
      (item) => (finiteNumber(item.details.memoryPercent) ?? -Infinity) >= 85,
      10 * 60_000
    )
  )
    candidates.push({
      level: 'warning',
      reason: 'memory_warning',
      priority: RESOURCE_PRIORITY.memory
    });
  if (
    trailing(samples, (item) => (finiteNumber(item.details.diskPercent) ?? -Infinity) >= 90)
      .length >= 2
  )
    candidates.push({
      level: 'critical',
      reason: 'disk_critical',
      priority: RESOURCE_PRIORITY.disk
    });
  else if (
    trailing(samples, (item) => (finiteNumber(item.details.diskPercent) ?? -Infinity) >= 80)
      .length >= 2
  )
    candidates.push({ level: 'warning', reason: 'disk_warning', priority: RESOURCE_PRIORITY.disk });
  if (
    sustained(
      samples,
      (item) => {
        const load = finiteNumber(item.details.load5);
        const cpuThreads = finiteNumber(item.details.cpuThreads);
        return load !== null && cpuThreads !== null && cpuThreads > 0 && load / cpuThreads >= 1.5;
      },
      10 * 60_000
    )
  )
    candidates.push({
      level: 'critical',
      reason: 'load_critical',
      priority: RESOURCE_PRIORITY.load
    });
  else if (
    sustained(
      samples,
      (item) => {
        const load = finiteNumber(item.details.load5);
        const cpuThreads = finiteNumber(item.details.cpuThreads);
        return load !== null && cpuThreads !== null && cpuThreads > 0 && load / cpuThreads >= 1;
      },
      10 * 60_000
    )
  )
    candidates.push({ level: 'warning', reason: 'load_warning', priority: RESOURCE_PRIORITY.load });
  const conditionHealthy =
    cpu !== null &&
    memory !== null &&
    disk !== null &&
    loadRatio !== null &&
    cpu < 85 &&
    memory < 85 &&
    disk < 80 &&
    loadRatio < 1;
  return { candidate: choose(candidates), conditionHealthy };
}

function evaluateInfrastructure(
  history: MonitorSample[],
  sample: MonitorSample
): { level: MonitorLevel; reason: string; conditionHealthy: boolean } {
  const samples = [...history, sample];
  if (sample.monitor === 'host_resources') {
    const evaluated = evaluateResources(samples, sample.details);
    return evaluated.candidate
      ? { ...evaluated, level: evaluated.candidate.level, reason: evaluated.candidate.reason }
      : { ...evaluated, level: 'healthy', reason: 'host_resources_state' };
  }
  if (sample.monitor === 'beszel') {
    const failed = sample.level !== 'healthy' || sample.details.probeOk === false;
    const twoFailures =
      trailing(samples, (item) => item.level !== 'healthy' || item.details.probeOk === false)
        .length >= 2;
    return {
      level: twoFailures ? 'critical' : failed ? 'unknown' : 'healthy',
      reason: twoFailures ? 'beszel_unavailable' : (sample.errorCode ?? 'beszel_state'),
      conditionHealthy: !failed
    };
  }
  const failedServices = Array.isArray(sample.details.failedServices)
    ? sample.details.failedServices.filter((value): value is string => typeof value === 'string')
    : [];
  const previous = history.at(-1);
  const previousFailed = Array.isArray(previous?.details.failedServices)
    ? previous.details.failedServices.filter((value): value is string => typeof value === 'string')
    : [];
  const sameFailed = failedServices
    .filter((value) => previousFailed.includes(value))
    .sort((a, b) => a.localeCompare(b, 'vi'));
  return {
    level: sameFailed.length ? 'critical' : 'healthy',
    reason: sameFailed.length ? `service_failed:${sameFailed[0]}` : 'host_services_state',
    conditionHealthy: failedServices.length === 0
  };
}

function infrastructureRecovery(
  samples: MonitorSample[],
  conditionHealthy: boolean,
  previousEffective: MonitorLevel
): { level: MonitorLevel; transition: Transition; reason?: string } {
  if (!conditionHealthy || !alertLevels.includes(previousEffective))
    return { level: 'healthy', transition: null };
  const clearSamples = trailing(samples, storedConditionHealthy);
  const beforeClear = samples.at(-(clearSamples.length + 1));
  const beforeClearLevel = effectiveLevel(beforeClear);
  const priorAlert =
    alertLevels.includes(previousEffective) || alertLevels.includes(beforeClearLevel);
  if (!priorAlert) return { level: 'healthy', transition: null };
  if (clearSamples.length < 2)
    return { level: previousEffective, transition: null, reason: 'awaiting_recovery_baseline' };
  return { level: 'healthy', transition: 'recovered' };
}

export function evaluateMonitor(history: MonitorSample[], sample: MonitorSample): Evaluation {
  const samples = [...history, sample];
  const previous = history.at(-1);
  const previousLevel = effectiveLevel(previous);
  const monitor = sample.monitor;
  let level: MonitorLevel = sample.level === 'healthy' ? 'healthy' : 'unknown';
  let reason = sample.errorCode ?? `${monitor}_state`;
  let conditionHealthy: boolean;

  if (monitor === 'beszel' || monitor === 'host_resources' || monitor === 'host_services') {
    const infrastructure = evaluateInfrastructure(history, sample);
    level = infrastructure.level;
    reason = infrastructure.reason;
    conditionHealthy = infrastructure.conditionHealthy;
    if (level === 'healthy') {
      const recovery = infrastructureRecovery(samples, conditionHealthy, previousLevel);
      level = recovery.level;
      if (recovery.transition)
        reason = previous?.details.dedupeKey
          ? String(previous.details.dedupeKey).split(':').slice(1).join(':')
          : 'recovered';
      else if (recovery.reason) reason = recovery.reason;
      return {
        level,
        transition: recovery.transition,
        dedupeKey: `${monitor}:${reason}`,
        safeSummary: `${monitor} ${level}`.slice(0, 500),
        conditionHealthy
      };
    }
    const transition: Transition =
      level !== previousLevel && (level === 'warning' || level === 'critical')
        ? previousLevel === 'unknown'
          ? 'opened'
          : 'changed'
        : null;
    return {
      level,
      transition,
      dedupeKey: `${monitor}:${reason}`,
      safeSummary: `${monitor} ${level}`.slice(0, 500),
      conditionHealthy
    };
  }

  const failure =
    sample.level === 'critical' || sample.level === 'warning' || sample.details.probeOk === false;
  if (['app_liveness', 'app_health', 'app_process', 'postgres'].includes(monitor)) {
    const failures = trailing(
      samples,
      (item) => item.level !== 'healthy' || item.details.probeOk === false
    );
    const healthySamples = trailing(samples, isHealthy);
    if (failures.length >= 2) {
      level = 'critical';
      reason = sample.errorCode ?? `${monitor}_failed`;
    } else if (previousLevel === 'critical' && healthySamples.length < 2) {
      level = 'critical';
      reason = 'awaiting_recovery_baseline';
    } else if (failure) level = 'unknown';
  }

  const details = sample.details;
  const waitingLocks = Number(details.waitingLockCount ?? 0);
  const maxConnections = Number(
    (details.settings as Record<string, unknown> | undefined)?.maxConnections ??
      details.maxConnections ??
      0
  );
  const connectionStates = (details.connectionStates ?? {}) as Record<string, unknown>;
  const connectionCount = Object.values(connectionStates).reduce<number>(
    (total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0),
    0
  );
  const ratio = maxConnections > 0 ? connectionCount / maxConnections : 0;
  const threshold5m = 5 * 60 * 1000;
  if (
    monitor === 'postgres' &&
    waitingLocks > 0 &&
    sustained(samples, (item) => Number(item.details.waitingLockCount ?? 0) > 0, threshold5m)
  ) {
    level = 'critical';
    reason = 'waiting_locks_critical';
  } else if (
    monitor === 'postgres' &&
    waitingLocks > 0 &&
    trailing(samples, (item) => Number(item.details.waitingLockCount ?? 0) > 0).length >= 2
  ) {
    level = 'warning';
    reason = 'waiting_locks_warning';
  }
  if (
    monitor === 'postgres' &&
    ratio > 0.9 &&
    sustained(
      samples,
      (item) => {
        const max = Number(
          (item.details.settings as Record<string, unknown> | undefined)?.maxConnections ??
            item.details.maxConnections ??
            0
        );
        const count = Object.values(
          (item.details.connectionStates ?? {}) as Record<string, unknown>
        ).reduce<number>((sum, value) => sum + Number(value), 0);
        return max > 0 && count / max > 0.9;
      },
      threshold5m
    )
  ) {
    level = 'critical';
    reason = 'connections_critical';
  } else if (
    monitor === 'postgres' &&
    ratio > 0.8 &&
    sustained(
      samples,
      (item) => {
        const max = Number(
          (item.details.settings as Record<string, unknown> | undefined)?.maxConnections ??
            item.details.maxConnections ??
            0
        );
        const count = Object.values(
          (item.details.connectionStates ?? {}) as Record<string, unknown>
        ).reduce<number>((sum, value) => sum + Number(value), 0);
        return max > 0 && count / max > 0.8;
      },
      threshold5m
    )
  ) {
    level = 'warning';
    reason = 'connections_warning';
  }
  if (['backup', 'cron'].includes(monitor) && sample.level !== 'healthy') {
    level = sample.level;
    reason = sample.errorCode ?? `${monitor}_failure`;
  }
  if (
    monitor === 'errors' &&
    (Number(details.fingerprintCount5m ?? 0) >= 10 || details.isFatal === true)
  ) {
    level = 'critical';
    reason = details.isFatal === true ? 'fatal_log_line' : 'error_fingerprint_burst';
  }

  if (monitor === 'postgres')
    conditionHealthy = isHealthy(sample) && waitingLocks <= 0 && ratio <= 0.8;
  else if (monitor === 'errors')
    conditionHealthy =
      isHealthy(sample) && Number(details.fingerprintCount5m ?? 0) < 10 && details.isFatal !== true;
  else conditionHealthy = isHealthy(sample);

  const clearSamples = trailing(samples, storedConditionHealthy);
  const beforeClear = samples.at(-(clearSamples.length + 1));
  const beforeClearLevel = effectiveLevel(beforeClear);
  const previousWasAlert = alertLevels.includes(previousLevel);
  const hasExplicitCondition = samples.some(
    (item) => typeof item.details.conditionHealthy === 'boolean'
  );
  const recoveryEligible =
    conditionHealthy &&
    ((previousWasAlert && clearSamples.length >= 2) ||
      (!hasExplicitCondition &&
        alertLevels.includes(beforeClearLevel) &&
        clearSamples.length === 2));
  const holdRecovery =
    conditionHealthy &&
    (previousWasAlert || alertLevels.includes(beforeClearLevel)) &&
    clearSamples.length < 2;
  if (recoveryEligible && level === 'healthy')
    return {
      level: 'healthy',
      transition: 'recovered',
      dedupeKey: `${monitor}:${reason}`,
      safeSummary: `${monitor} healthy`.slice(0, 500),
      conditionHealthy
    };
  if (holdRecovery && level === 'healthy') {
    level = previousWasAlert ? previousLevel : beforeClearLevel;
    reason = 'awaiting_recovery_baseline';
  }
  const transition: Transition =
    level !== previousLevel && (level === 'warning' || level === 'critical')
      ? previousLevel === 'unknown'
        ? 'opened'
        : 'changed'
      : null;
  return {
    level,
    transition,
    dedupeKey: `${monitor}:${reason}`,
    safeSummary: `${monitor} ${level}`.slice(0, 500),
    conditionHealthy
  };
}
