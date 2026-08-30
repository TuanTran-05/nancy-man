import { readFileSync } from 'node:fs';
import type { BeszelCollectorConfig } from '../config.js';
import {
  authResponseSchema,
  hubInfoSchema,
  systemRecordSchema,
  systemStatsListSchema,
  systemdServicesListSchema,
  type HubInfo,
  type SystemRecord,
  type SystemStatsList,
  type SystemdServicesList
} from './contracts.js';

const FIXED_PATHS = {
  auth: '/api/collections/users/auth-with-password',
  info: '/api/beszel/info',
  systems: '/api/collections/systems/records/',
  stats: '/api/collections/system_stats/records',
  services: '/api/collections/systemd_services/records'
} as const;

export interface BeszelRawSnapshot {
  hub: HubInfo;
  system: SystemRecord;
  stats: SystemStatsList['items'][number];
  services: SystemdServicesList;
}

export type BeszelErrorCode =
  | 'beszel_auth_failed'
  | 'beszel_timeout'
  | 'beszel_unreachable'
  | 'beszel_http_error'
  | 'beszel_invalid_json'
  | 'beszel_contract_invalid'
  | 'beszel_no_stats';

export type BeszelProbeErrorCode = BeszelErrorCode | 'beszel_agent_down' | 'beszel_metric_stale';

export class BeszelClientError extends Error {
  constructor(readonly code: BeszelErrorCode) {
    super(code);
    this.name = 'BeszelClientError';
  }
}

interface ClientDeps {
  fetchImpl?: typeof fetch;
  readPassword?: (path: string) => string;
}

const boundedError = (code: BeszelErrorCode): BeszelClientError => new BeszelClientError(code);

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw boundedError('beszel_invalid_json');
  }
}

export function createBeszelClient(
  config: Extract<BeszelCollectorConfig, { enabled: true }>,
  deps: ClientDeps = {}
) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const readPassword = deps.readPassword ?? ((path: string) => readFileSync(path, 'utf8'));
  let cachedToken: string | null = null;

  const makeUrl = (path: string, params?: Record<string, string>): string => {
    const url = new URL(path, `${config.baseUrl}/`);
    if (params) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  };

  const fetchResponse = async (
    url: string,
    init: RequestInit,
    signal: AbortSignal
  ): Promise<Response> => {
    try {
      return await fetchImpl(url, { ...init, signal });
    } catch (error) {
      if (isAbort(error, signal)) throw boundedError('beszel_timeout');
      throw boundedError('beszel_unreachable');
    }
  };

  const responseJson = async (response: Response): Promise<unknown> => {
    let body: string;
    try {
      body = await response.text();
    } catch {
      throw boundedError('beszel_invalid_json');
    }
    return parseBody(body);
  };

  const authenticate = async (signal: AbortSignal): Promise<string> => {
    let password: string;
    try {
      password = readPassword(config.passwordFile).trim();
    } catch {
      throw boundedError('beszel_unreachable');
    }
    if (!password) throw boundedError('beszel_auth_failed');
    const response = await fetchResponse(
      makeUrl(FIXED_PATHS.auth),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identity: config.username, password })
      },
      signal
    );
    if (response.status === 401) throw boundedError('beszel_auth_failed');
    if (!response.ok) throw boundedError('beszel_http_error');
    const parsed = authResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success || parsed.data.record.email !== config.username)
      throw boundedError('beszel_contract_invalid');
    cachedToken = parsed.data.token;
    return cachedToken;
  };

  let reauthUsed = false;
  const protectedJson = async (
    path: string,
    params: Record<string, string> | undefined,
    signal: AbortSignal,
    allowReauth: boolean
  ): Promise<unknown> => {
    const token = cachedToken ?? (await authenticate(signal));
    const response = await fetchResponse(
      makeUrl(path, params),
      {
        headers: { Accept: 'application/json', Authorization: token }
      },
      signal
    );
    if (response.status === 401) {
      if (!allowReauth || reauthUsed) throw boundedError('beszel_auth_failed');
      reauthUsed = true;
      cachedToken = null;
      await authenticate(signal);
      return protectedJson(path, params, signal, false);
    }
    if (!response.ok) throw boundedError('beszel_http_error');
    return responseJson(response);
  };

  return {
    async readSnapshot(): Promise<BeszelRawSnapshot> {
      const signal = AbortSignal.timeout(config.timeoutMs);
      reauthUsed = false;
      try {
        const authToken = cachedToken ?? (await authenticate(signal));
        const infoRaw = await protectedJson(FIXED_PATHS.info, undefined, signal, true);
        const systemRaw = await protectedJson(
          `${FIXED_PATHS.systems}${config.systemId}`,
          undefined,
          signal,
          true
        );
        const statsRaw = await protectedJson(
          FIXED_PATHS.stats,
          {
            page: '1',
            perPage: '1',
            sort: '-created',
            filter: `system="${config.systemId}" && type="1m"`,
            fields: 'created,stats'
          },
          signal,
          true
        );
        const servicesRaw = await protectedJson(
          FIXED_PATHS.services,
          {
            page: '1',
            perPage: '200',
            filter: `system="${config.systemId}"`,
            fields: 'name,state,sub,cpu,memory,updated'
          },
          signal,
          true
        );
        const hub = hubInfoSchema.safeParse(infoRaw);
        const system = systemRecordSchema.safeParse(systemRaw);
        const stats = systemStatsListSchema.safeParse(statsRaw);
        const services = systemdServicesListSchema.safeParse(servicesRaw);
        if (!hub.success || !system.success || !stats.success || !services.success)
          throw boundedError('beszel_contract_invalid');
        if (
          system.data.id !== config.systemId ||
          services.data.totalItems > services.data.items.length
        )
          throw boundedError('beszel_contract_invalid');
        const firstStats = stats.data.items[0];
        if (!firstStats) throw boundedError('beszel_no_stats');
        void authToken;
        return { hub: hub.data, system: system.data, stats: firstStats, services: services.data };
      } catch (error) {
        if (error instanceof BeszelClientError) throw error;
        if (isAbort(error, signal)) throw boundedError('beszel_timeout');
        throw boundedError('beszel_contract_invalid');
      }
    }
  };
}
