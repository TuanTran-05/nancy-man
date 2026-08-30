import type { CollectorConfig } from '../config.js';
import type { OpsStore } from '../storage/store.js';
import type { MonitorSample, MonitorName } from '../../shared/models.js';
import { probeHealth, probeLiveness, type AppProbeConfig } from './healthProbe.js';
import { probeAppProcess } from './processProbe.js';
import { probePostgres } from './postgresProbe.js';
import { tailSinceCursor } from './logTailer.js';
import { redactLogLine } from './redactor.js';
import { parseCronAndBackupState } from './opsParsers.js';
import { evaluateMonitor, type Evaluation, type Transition } from './statusMachine.js';

export interface CollectorTransition {
  incidentId?: string;
  monitor: MonitorName;
  sample: MonitorSample;
  level: 'warning' | 'critical';
  transition: Exclude<Transition, null>;
  dedupeKey: string;
  safeSummary: string;
  occurrenceCount: number;
}

export interface CollectorDeps {
  config: CollectorConfig;
  store: OpsStore;
  histories: Map<MonitorName, MonitorSample[]>;
  lastPostgresAt?: number;
  lastBeszelAt?: number;
  beszelProbe?: (now: Date) => Promise<MonitorSample[]>;
  appProbe?: (
    config: AppProbeConfig,
    kind: 'liveness' | 'health',
    now: Date
  ) => Promise<MonitorSample>;
  postgresProbe?: typeof probePostgres;
}

function readLogLines(deps: CollectorDeps, source: string, path: string): string[] {
  try {
    const result = tailSinceCursor(path, deps.store.getCursor(source));
    deps.store.setCursor(source, result.cursor);
    return result.lines;
  } catch {
    return [];
  }
}

function remember(
  deps: CollectorDeps,
  sample: MonitorSample
): { evaluation: Evaluation; stored: MonitorSample } {
  const history = deps.histories.get(sample.monitor) ?? [];
  const evaluation = evaluateMonitor(history, sample);
  const details = {
    ...sample.details,
    dedupeKey: evaluation.dedupeKey,
    effectiveLevel: evaluation.level,
    conditionHealthy: evaluation.conditionHealthy
  };
  const stored = { ...sample, level: evaluation.level, details };
  deps.store.recordSample(stored);
  history.push({ ...sample, details });
  deps.histories.set(sample.monitor, history.slice(-120));
  return { evaluation, stored };
}

export async function runCollectorCycle(
  deps: CollectorDeps,
  now: Date = new Date()
): Promise<CollectorTransition[]> {
  const appConfig: AppProbeConfig = { appUrl: deps.config.appUrl, timeoutMs: 5000 };
  const appProbe =
    deps.appProbe ??
    ((config, kind, at) =>
      kind === 'liveness' ? probeLiveness(config, at) : probeHealth(config, at));
  const probePromises: Array<Promise<MonitorSample[]>> = [
    appProbe(appConfig, 'liveness', now).then((sample) => [sample]),
    appProbe(appConfig, 'health', now).then((sample) => [sample]),
    Promise.resolve(probeAppProcess({ pidFile: deps.config.pm2PidPath }, now)).then((sample) => [
      sample
    ]),
    ...(deps.lastPostgresAt === undefined || now.getTime() - deps.lastPostgresAt >= 60_000
      ? [
          (deps.postgresProbe ?? probePostgres)({ postgresUrl: deps.config.postgresUrl }, now).then(
            (sample) => {
              deps.lastPostgresAt = now.getTime();
              return [sample];
            }
          )
        ]
      : [])
  ];
  const beszelDue =
    deps.config.beszel.enabled &&
    deps.beszelProbe !== undefined &&
    (deps.lastBeszelAt === undefined || now.getTime() - deps.lastBeszelAt >= 60_000);
  if (beszelDue) {
    probePromises.push(
      deps.beszelProbe!(now)
        .catch((): MonitorSample[] => [
          {
            monitor: 'beszel',
            level: 'critical',
            observedAt: now.toISOString(),
            latencyMs: null,
            details: { probeOk: false },
            errorCode: 'beszel_unreachable'
          }
        ])
        .then((result) => {
          deps.lastBeszelAt = now.getTime();
          return result;
        })
    );
  }
  const samples = (await Promise.all(probePromises)).flat();

  const transitions: CollectorTransition[] = [];
  const evaluateAndCollect = (sample: MonitorSample) => {
    const history = deps.histories.get(sample.monitor) ?? [];
    const previous = history.at(-1);
    const remembered = remember(deps, sample);
    const evaluation = remembered.evaluation;
    const stored = remembered.stored;
    const previousDedupe =
      (previous?.details.dedupeKey as string | undefined) ?? evaluation.dedupeKey;
    const shouldReconcile =
      (evaluation.level === 'healthy' && evaluation.transition !== 'recovered') ||
      evaluation.level === 'warning' ||
      evaluation.level === 'critical';
    if (shouldReconcile) {
      deps.store.reconcileIncidents({
        monitor: sample.monitor,
        activeDedupeKey:
          evaluation.level === 'warning' || evaluation.level === 'critical'
            ? evaluation.dedupeKey
            : undefined,
        now: sample.observedAt
      });
    }
    if (evaluation.level === 'warning' || evaluation.level === 'critical') {
      const incident = deps.store.upsertIncident({
        dedupeKey: evaluation.transition === 'recovered' ? previousDedupe : evaluation.dedupeKey,
        monitor: sample.monitor,
        level: evaluation.level,
        state: 'open',
        recoveredAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        note: null,
        safeSummary: evaluation.safeSummary,
        now: sample.observedAt
      });
      if (evaluation.transition)
        transitions.push({
          incidentId: incident.id,
          monitor: sample.monitor,
          sample: stored,
          level: evaluation.level,
          transition: evaluation.transition,
          dedupeKey: incident.dedupeKey,
          safeSummary: evaluation.safeSummary,
          occurrenceCount: incident.occurrenceCount
        });
    } else if (evaluation.transition === 'recovered') {
      const incident = deps.store.upsertIncident({
        dedupeKey: previousDedupe,
        monitor: sample.monitor,
        level: previous?.level === 'warning' ? 'warning' : 'critical',
        state: 'recovered',
        recoveredAt: sample.observedAt,
        acknowledgedAt: null,
        acknowledgedBy: null,
        note: null,
        safeSummary: evaluation.safeSummary,
        now: sample.observedAt
      });
      transitions.push({
        incidentId: incident.id,
        monitor: sample.monitor,
        sample: stored,
        level: incident.level,
        transition: 'recovered',
        dedupeKey: incident.dedupeKey,
        safeSummary: evaluation.safeSummary,
        occurrenceCount: incident.occurrenceCount
      });
    }
  };

  for (const sample of samples) evaluateAndCollect(sample);

  const errorLines = readLogLines(deps, deps.config.pm2ErrorLogPath, deps.config.pm2ErrorLogPath);
  const redacted = errorLines.map(redactLogLine);
  const fingerprintCounts = new Map<string, number>();
  for (const line of redacted)
    fingerprintCounts.set(line.fingerprint, (fingerprintCounts.get(line.fingerprint) ?? 0) + 1);
  const mostCommon = [...fingerprintCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const fiveMinutesAgo = now.getTime() - 5 * 60_000;
  const historicalCount = mostCommon
    ? (deps.histories.get('errors') ?? [])
        .filter(
          (item) =>
            Date.parse(item.observedAt) >= fiveMinutesAgo &&
            item.details.fingerprint === mostCommon[0]
        )
        .reduce((sum, item) => sum + Number(item.details.fingerprintCountSample ?? 0), 0)
    : 0;
  evaluateAndCollect({
    monitor: 'errors',
    level: redacted.length ? 'warning' : 'healthy',
    observedAt: now.toISOString(),
    latencyMs: 0,
    details: {
      fingerprint: mostCommon?.[0] ?? null,
      fingerprintCount5m: (mostCommon?.[1] ?? 0) + historicalCount,
      fingerprintCountSample: mostCommon?.[1] ?? 0,
      isFatal: redacted.some((line) => line.isFatal),
      safeExcerpt: redacted[0]?.safeText ?? null
    },
    errorCode: redacted.some((line) => line.isFatal) ? 'fatal_log_line' : null
  });

  const cronLines = readLogLines(deps, deps.config.cronLogPath, deps.config.cronLogPath);
  const parsed = parseCronAndBackupState({ cronLines, backupDir: deps.config.backupDir }, now);
  evaluateAndCollect({
    monitor: 'cron',
    level: parsed.cronLevel,
    observedAt: now.toISOString(),
    latencyMs: 0,
    details: { jobs: parsed.cron },
    errorCode: parsed.cronErrorCode
  });
  evaluateAndCollect({
    monitor: 'backup',
    level: parsed.backupLevel,
    observedAt: now.toISOString(),
    latencyMs: 0,
    details: parsed.backup,
    errorCode: parsed.backupErrorCode
  });

  return transitions;
}
