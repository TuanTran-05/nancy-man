import { createHmac } from 'node:crypto';

import { type IngestRateLimiter } from './browserIngest.js';

type QueryDatabase = {
  query: <T>(sql: string, parameters?: readonly unknown[]) => Promise<{ rows: T[] }>;
};

type RateLimitDimension = 'ip' | 'session' | 'fingerprint';

const perMinuteLimit: Record<RateLimitDimension, number> = {
  ip: 120,
  session: 60,
  fingerprint: 200
};

function windowStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCSeconds(0, 0);
  return start;
}

function digest(pepper: string, dimension: RateLimitDimension, value: string): string {
  return createHmac('sha256', pepper).update(`${dimension}:${value}`, 'utf8').digest('hex');
}

export class PostgresBrowserRateLimiter implements IngestRateLimiter {
  private readonly now: () => Date;

  constructor(
    private readonly input: {
      database: QueryDatabase;
      pepper: string;
      now?: () => Date;
    }
  ) {
    this.now = input.now ?? (() => new Date());
  }

  private async increment(input: {
    windowStartedAt: Date;
    clientId: string;
    dimension: RateLimitDimension;
    value: string;
  }): Promise<boolean> {
    const { rows } = await this.input.database.query<{ requestCount: number }>(
      `
        INSERT INTO ingest_rate_limits (
          window_started_at,
          ingest_client_id,
          dimension,
          value_hash,
          request_count
        ) VALUES ($1, $2, $3, $4, 1)
        ON CONFLICT (window_started_at, ingest_client_id, dimension, value_hash) DO UPDATE
          SET request_count = ingest_rate_limits.request_count + 1
          WHERE ingest_rate_limits.request_count < $5
        RETURNING request_count AS "requestCount"
      `,
      [
        input.windowStartedAt,
        input.clientId,
        input.dimension,
        digest(this.input.pepper, input.dimension, input.value),
        perMinuteLimit[input.dimension]
      ]
    );
    return rows.length === 1;
  }

  async allow(input: {
    clientId: string;
    clientIp: string;
    sessionHash?: string;
    fingerprint: string;
  }): Promise<boolean> {
    const windowStartedAt = windowStart(this.now());
    const dimensions: Array<{ dimension: RateLimitDimension; value: string }> = [
      { dimension: 'ip', value: input.clientIp },
      { dimension: 'fingerprint', value: input.fingerprint }
    ];
    if (input.sessionHash) {
      dimensions.splice(1, 0, { dimension: 'session', value: input.sessionHash });
    }

    for (const dimension of dimensions) {
      const allowed = await this.increment({
        windowStartedAt,
        clientId: input.clientId,
        ...dimension
      });
      if (!allowed) return false;
    }
    return true;
  }
}
