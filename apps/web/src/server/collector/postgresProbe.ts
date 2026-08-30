import { Client } from 'pg';
import { z } from 'zod';
import type { MonitorSample } from '../../shared/models.js';

const metricSchema = z
  .object({
    probeAt: z.string(),
    databaseSizeBytes: z.number().nonnegative(),
    connectionStates: z.record(z.string(), z.number().nonnegative()),
    activeCount: z.number().int().nonnegative(),
    waitingLockCount: z.number().int().nonnegative(),
    deadlocks: z.number().nonnegative(),
    rollbacks: z.number().nonnegative(),
    tempFiles: z.number().nonnegative(),
    tempBytes: z.number().nonnegative(),
    userTables: z.array(
      z
        .object({
          table: z.string().max(256),
          liveTuples: z.number(),
          deadTuples: z.number(),
          lastAutovacuum: z.string().nullable(),
          lastAutoanalyze: z.string().nullable()
        })
        .strict()
    ),
    settings: z
      .object({
        maxConnections: z.number().int().positive(),
        trackIoTiming: z.boolean(),
        extensions: z.array(z.string().max(128))
      })
      .strict()
  })
  .strict();

interface ProbeClient {
  query(sql: string): Promise<{ rows: Array<{ snapshot?: unknown }> }>;
  end(): Promise<unknown>;
}

export interface PostgresProbeConfig {
  postgresUrl: string;
  timeoutMs?: number;
  clientFactory?: () => ProbeClient | Promise<ProbeClient>;
}

const safeErrorCode = (error: unknown): string => {
  if (error instanceof z.ZodError) return 'database_invalid_metric';
  return 'database_unreachable';
};

export async function probePostgres(
  config: PostgresProbeConfig,
  now: Date = new Date()
): Promise<MonitorSample> {
  const started = performance.now();
  let client: ProbeClient | undefined;
  try {
    client = config.clientFactory
      ? await config.clientFactory()
      : (new Client({
          connectionString: config.postgresUrl,
          connectionTimeoutMillis: config.timeoutMs ?? 5000,
          query_timeout: config.timeoutMs ?? 5000
        }) as unknown as ProbeClient);
    if (!config.clientFactory) await (client as Client).connect();
    const result = await client.query('SELECT ops_metrics.snapshot() AS snapshot');
    const raw = result.rows[0]?.snapshot;
    const parsed = metricSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
    return {
      monitor: 'postgres',
      level: 'healthy',
      observedAt: now.toISOString(),
      latencyMs: Math.round(performance.now() - started),
      details: parsed,
      errorCode: null
    };
  } catch (error) {
    return {
      monitor: 'postgres',
      level: 'critical',
      observedAt: now.toISOString(),
      latencyMs: Math.round(performance.now() - started),
      details: {},
      errorCode: safeErrorCode(error)
    };
  } finally {
    if (client) await client.end().catch(() => undefined);
  }
}

export { metricSchema };
