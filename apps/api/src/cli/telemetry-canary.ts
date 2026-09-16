import { getOpsPool } from '../../../../packages/db/src/client.js';
import type {
  TelemetryEnvelopeV1,
  TelemetrySource
} from '../../../../packages/contracts/src/telemetry.js';
import { createEventId } from '../../../../packages/telemetry-sdk/src/ids.js';
import { createSignedServerTransport } from '../../../../packages/telemetry-sdk/src/serverTransport.js';
import {
  createOpsProcessRuntimeTelemetryFromEnvironment,
  runConfiguredOpsTelemetryOneShot
} from '../../../../packages/telemetry-sdk/src/oneShot.js';
import type { RuntimeTelemetry } from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { FileSecretResolver } from '../runtime/fileSecretResolver.js';
import { readOpsRuntimeConfig } from '../runtime/runtimeConfig.js';

export type TelemetryCanaryEnvelope = TelemetryEnvelopeV1;

export type TelemetryCanaryIngestResult = void | { accepted?: boolean; eventId?: string };

type TelemetryCanaryInput = {
  envelope?: TelemetryCanaryEnvelope;
  ingest: (envelope: TelemetryCanaryEnvelope) => Promise<TelemetryCanaryIngestResult>;
  findOccurrence: (eventId: string) => Promise<unknown>;
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

export type TelemetryCanaryResult = {
  eventId: string;
  polls: number;
  observedAt: string;
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function validDuration(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum} milliseconds`);
  }
  return value;
}

export function createTelemetryCanaryEnvelope(input: {
  release: string;
  service: string;
  source?: TelemetrySource;
  now?: () => Date;
  eventId?: `EVT_${string}`;
}): TelemetryCanaryEnvelope {
  const now = input.now ?? (() => new Date());
  const capturedAt = now().toISOString();
  const eventId = input.eventId ?? createEventId(Date.parse(capturedAt));
  return {
    schemaVersion: 1,
    eventId,
    idempotencyKey: eventId,
    capturedAt,
    source: input.source ?? 'synthetic',
    level: 'error',
    error: {
      name: 'TelemetryCanaryError',
      code: 'TELEMETRY_CANARY',
      safeMessage: 'Synthetic telemetry canary event'
    },
    context: {
      release: input.release,
      service: input.service,
      environment: 'production',
      route: '/telemetry/canary',
      tags: { canary: 'true' }
    }
  };
}

export async function runTelemetryCanary(
  input: TelemetryCanaryInput
): Promise<TelemetryCanaryResult> {
  const envelope =
    input.envelope ??
    createTelemetryCanaryEnvelope({
      release: '0000000000000000000000000000000000000000',
      service: 'edutrack-ops-telemetry-canary'
    });
  const timeoutMs = validDuration(input.timeoutMs ?? 30_000, 'timeoutMs', 300_000);
  const pollMs = validDuration(input.pollMs ?? 250, 'pollMs', 60_000);
  const sleep = input.sleep ?? wait;
  const now = input.now ?? Date.now;
  const accepted = await input.ingest(envelope);
  if (accepted && accepted.accepted === false) {
    throw new Error('TELEMETRY_CANARY_NOT_ACCEPTED');
  }
  if (accepted && accepted.eventId && accepted.eventId !== envelope.eventId) {
    throw new Error('TELEMETRY_CANARY_EVENT_ID_MISMATCH');
  }

  const deadline = now() + timeoutMs;
  let polls = 0;
  while (true) {
    polls += 1;
    if (await input.findOccurrence(envelope.eventId)) {
      return { eventId: envelope.eventId, polls, observedAt: new Date().toISOString() };
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  }
  throw new Error('TELEMETRY_CANARY_NOT_OBSERVED');
}

function requiredCanaryDuration(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum: number
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d{1,6}$/u.test(raw)) throw new Error(`${name} is invalid`);
  return validDuration(Number(raw), name, maximum);
}

function browserOrigin(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== value ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('TELEMETRY_CANARY_BROWSER_ORIGIN_INVALID');
  }
  return parsed.origin;
}

function browserProjectKey(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u.test(value)) {
    throw new Error('TELEMETRY_CANARY_BROWSER_PROJECT_KEY_INVALID');
  }
  return value;
}

function createBrowserCanaryIngest(input: {
  endpoint: string;
  projectKey: string;
  origin: string;
  fetch?: typeof globalThis.fetch;
}): (envelope: TelemetryCanaryEnvelope) => Promise<TelemetryCanaryIngestResult> {
  const endpoint = new URL(input.endpoint);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.pathname !== '/api/v1/ingest/browser' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('TELEMETRY_CANARY_BROWSER_ENDPOINT_INVALID');
  }
  const projectKey = browserProjectKey(input.projectKey);
  const origin = browserOrigin(input.origin);
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') {
    throw new Error('TELEMETRY_CANARY_FETCH_UNAVAILABLE');
  }
  return async (envelope) => {
    const response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Ops-Project-Key': projectKey
      },
      body: JSON.stringify(envelope)
    });
    if (response.status !== 202) throw new Error('TELEMETRY_CANARY_NOT_ACCEPTED');
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== 'object' ||
      (body as { accepted?: unknown }).accepted !== true ||
      (body as { eventId?: unknown }).eventId !== envelope.eventId
    ) {
      throw new Error('TELEMETRY_CANARY_ACK_INVALID');
    }
    return { accepted: true, eventId: envelope.eventId };
  };
}

type CanaryMode =
  | { kind: 'server'; service: string }
  | { kind: 'browser'; projectKey: string; origin: string; service: string };

function parseArguments(arguments_: readonly string[]): CanaryMode {
  if (arguments_.length === 0 || arguments_[0] === '--server') {
    const service = arguments_[1] ?? 'edutrack-ops-api';
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(service))
      throw new Error('TELEMETRY_CANARY_SERVICE_INVALID');
    return { kind: 'server', service };
  }
  if (arguments_[0] === '--browser' && arguments_.length === 4) {
    const projectKey = browserProjectKey(arguments_[1]!);
    const origin = browserOrigin(arguments_[2]!);
    const service = arguments_[3]!;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(service))
      throw new Error('TELEMETRY_CANARY_SERVICE_INVALID');
    return { kind: 'browser', projectKey, origin, service };
  }
  throw new Error('TELEMETRY_CANARY_USAGE');
}

export async function runConfiguredTelemetryCanary(
  environment: NodeJS.ProcessEnv = process.env,
  arguments_: readonly string[] = []
): Promise<TelemetryCanaryResult> {
  const config = readOpsRuntimeConfig(environment);
  if (!config.telemetry.enabled) throw new Error('TELEMETRY_CANARY_REQUIRES_ENABLED_TELEMETRY');
  const mode = parseArguments(arguments_);
  const resolver = new FileSecretResolver(config.secretDirectory);
  const databaseUrl = await resolver.resolve(config.databaseUrlReference);
  if (!databaseUrl) throw new Error('TELEMETRY_CANARY_DATABASE_CREDENTIAL_UNAVAILABLE');
  const pool = getOpsPool(databaseUrl);
  try {
    const envelope = createTelemetryCanaryEnvelope({
      release: config.telemetry.release,
      service: mode.service,
      source: mode.kind === 'browser' ? 'browser' : 'synthetic'
    });
    const hmacSecret =
      mode.kind === 'server'
        ? await resolver.resolve(config.telemetry.hmacSecretReference)
        : undefined;
    if (mode.kind === 'server' && !hmacSecret?.trim()) {
      throw new Error('TELEMETRY_CANARY_HMAC_CREDENTIAL_UNAVAILABLE');
    }
    const ingest =
      mode.kind === 'browser'
        ? createBrowserCanaryIngest({
            endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/browser',
            projectKey: mode.projectKey,
            origin: mode.origin
          })
        : createSignedServerTransport({
            endpoint: config.telemetry.endpoint,
            keyId: config.telemetry.keyId,
            secret: hmacSecret!
          });
    return await runTelemetryCanary({
      envelope,
      ingest: async (value) => {
        await ingest(value);
        return { accepted: true, eventId: value.eventId };
      },
      findOccurrence: async (eventId) => {
        const { rows } = await pool.query<{ eventId: string }>(
          'SELECT event_id AS "eventId" FROM error_events WHERE event_id = $1 LIMIT 1',
          [eventId]
        );
        return rows[0]?.eventId === eventId;
      },
      timeoutMs: requiredCanaryDuration(
        environment,
        'OPS_TELEMETRY_CANARY_TIMEOUT_MS',
        30_000,
        300_000
      ),
      pollMs: requiredCanaryDuration(environment, 'OPS_TELEMETRY_CANARY_POLL_MS', 250, 60_000)
    });
  } finally {
    await pool.end();
  }
}

export function runTelemetryCanaryEntrypoint(
  input: {
    environment?: NodeJS.ProcessEnv;
    arguments?: readonly string[];
    telemetry?: RuntimeTelemetry;
    run?: () => Promise<TelemetryCanaryResult>;
    onFailure?: (error: unknown) => void | Promise<void>;
    rethrow?: boolean;
  } = {}
): Promise<TelemetryCanaryResult | undefined> {
  const environment = input.environment ?? process.env;
  const common = {
    createTelemetry: () =>
      input.telemetry ??
      createOpsProcessRuntimeTelemetryFromEnvironment({
        environment,
        resolveHmacSecret: async (reference) => {
          const secretDirectory = environment.OPS_SECRET_DIRECTORY?.trim();
          if (!secretDirectory) throw new Error('OPS_SECRET_DIRECTORY is required');
          return new FileSecretResolver(secretDirectory).resolve(reference);
        },
        service: 'edutrack-ops-telemetry-canary',
        spoolName: 'telemetry-canary'
      }),
    failureContext: {
      code: 'TELEMETRY_CANARY_FAILED',
      source: 'process' as const,
      level: 'error' as const
    },
    run:
      input.run ??
      (() => runConfiguredTelemetryCanary(environment, input.arguments ?? process.argv.slice(2)))
  };
  if (input.rethrow === false) {
    return runConfiguredOpsTelemetryOneShot({
      ...common,
      ...(input.onFailure ? { onFailure: input.onFailure } : {}),
      rethrow: false
    });
  }
  return runConfiguredOpsTelemetryOneShot({
    ...common,
    ...(input.onFailure ? { onFailure: input.onFailure } : {}),
    rethrow: true
  });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void runTelemetryCanaryEntrypoint({
    rethrow: false,
    onFailure: () => {
      process.stderr.write('Telemetry canary failed\n');
      process.exitCode = 1;
    }
  });
}
