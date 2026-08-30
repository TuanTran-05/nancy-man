import type { MonitorSample } from '../../shared/models.js';

export type AppProbeKind = 'liveness' | 'health';

export interface AppProbeConfig {
  appUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const expectedPath: Record<AppProbeKind, string> = {
  liveness: '/api/v1/liveness',
  health: '/api/v1/health'
};

function validateLoopbackUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('appUrl must be loopback http');
  return url;
}

export async function probeApp(
  config: AppProbeConfig,
  kind: AppProbeKind,
  now: Date = new Date()
): Promise<MonitorSample> {
  const observedAt = now.toISOString();
  let url: URL;
  try {
    url = validateLoopbackUrl(config.appUrl);
  } catch {
    return {
      monitor: kind === 'liveness' ? 'app_liveness' : 'app_health',
      level: 'critical',
      observedAt,
      latencyMs: null,
      details: {},
      errorCode: 'app_non_loopback_url'
    };
  }
  url.pathname = expectedPath[kind];
  url.search = '';
  url.hash = '';
  const started = performance.now();
  try {
    const response = await (config.fetchImpl ?? fetch)(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.timeoutMs ?? 5000)
    });
    if (!response.ok) throw new Error('non-success response');
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('invalid response');
    const record = body as Record<string, unknown>;
    const details: Record<string, unknown> = { probeOk: true };
    if (typeof record.status === 'string' && ['ok', 'healthy', 'degraded'].includes(record.status))
      details.status = record.status;
    if (typeof record.release === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(record.release))
      details.release = record.release;
    if (
      typeof record.postgres === 'string' &&
      ['ok', 'healthy', 'unavailable', 'degraded'].includes(record.postgres)
    )
      details.postgres = record.postgres;
    return {
      monitor: kind === 'liveness' ? 'app_liveness' : 'app_health',
      level: 'healthy',
      observedAt,
      latencyMs: Math.round(performance.now() - started),
      details,
      errorCode: null
    };
  } catch {
    return {
      monitor: kind === 'liveness' ? 'app_liveness' : 'app_health',
      level: 'critical',
      observedAt,
      latencyMs: Math.round(performance.now() - started),
      details: { probeOk: false },
      errorCode: kind === 'liveness' ? 'app_liveness_unreachable' : 'app_health_unreachable'
    };
  }
}

export const probeLiveness = (config: AppProbeConfig, now?: Date) =>
  probeApp(config, 'liveness', now);
export const probeHealth = (config: AppProbeConfig, now?: Date) => probeApp(config, 'health', now);
