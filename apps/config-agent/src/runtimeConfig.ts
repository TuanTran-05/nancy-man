import { isAbsolute, normalize } from 'node:path';

import { MAX_FRAME_BYTES } from '../../../packages/config-contracts/src/framing.js';

export const MAXIMUM_FRAME_BYTES = MAX_FRAME_BYTES;

export type Environment = Readonly<Record<string, string | undefined>>;

export type ConfigAgentRuntimeConfig = Readonly<{
  socketPath: string;
  catalogPath: string;
  manifestPath: string;
  protocolKeyPath: string;
  protocolKeyId: string;
  fingerprintKeyPath: string;
  fingerprintKeyVersion: string;
  socketGroup: string;
  allowedPeerUid?: number;
  allowedPeerGid?: number;
  clockSkewMs: number;
  requestTtlMs: number;
  maximumFrameBytes: typeof MAXIMUM_FRAME_BYTES;
}>;

export type RuntimeConfigErrorCode =
  | 'CONFIG_AGENT_ENV_REQUIRED'
  | 'CONFIG_AGENT_PATH_INVALID'
  | 'CONFIG_AGENT_KEY_ID_INVALID'
  | 'CONFIG_AGENT_KEY_PATHS_MUST_DIFFER'
  | 'CONFIG_AGENT_IDENTITY_INVALID'
  | 'CONFIG_AGENT_DURATION_INVALID';

export class RuntimeConfigError extends Error {
  readonly code: RuntimeConfigErrorCode;

  constructor(code: RuntimeConfigErrorCode) {
    super(code);
    this.name = 'RuntimeConfigError';
    this.code = code;
  }
}

function configured(
  environment: Environment,
  names: readonly string[],
  code: RuntimeConfigErrorCode
): string {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  throw new RuntimeConfigError(code);
}

function pathValue(environment: Environment, names: readonly string[], suffix?: string): string {
  const value = configured(environment, names, 'CONFIG_AGENT_ENV_REQUIRED');
  if (
    !isAbsolute(value) ||
    value === '/' ||
    value.includes('\u0000') ||
    normalize(value) !== value ||
    (suffix !== undefined && !value.endsWith(suffix))
  ) {
    throw new RuntimeConfigError('CONFIG_AGENT_PATH_INVALID');
  }
  return value;
}

function stableId(environment: Environment, names: readonly string[]): string {
  const value = configured(environment, names, 'CONFIG_AGENT_ENV_REQUIRED');
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(value)) {
    throw new RuntimeConfigError('CONFIG_AGENT_KEY_ID_INVALID');
  }
  return value;
}

function fingerprintVersion(environment: Environment): string {
  const value = configured(
    environment,
    ['OPS_CONFIG_AGENT_FINGERPRINT_KEY_VERSION', 'OPS_CONFIG_AGENT_FINGERPRINT_KEY_ID'],
    'CONFIG_AGENT_ENV_REQUIRED'
  );
  if (!/^v[0-9]+$/u.test(value)) throw new RuntimeConfigError('CONFIG_AGENT_KEY_ID_INVALID');
  return value;
}

function optionalIdentity(environment: Environment, names: readonly string[]): number | undefined {
  const value = names.map((name) => environment[name]?.trim()).find(Boolean);
  if (!value) return undefined;
  if (!/^[0-9]+$/u.test(value)) throw new RuntimeConfigError('CONFIG_AGENT_IDENTITY_INVALID');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RuntimeConfigError('CONFIG_AGENT_IDENTITY_INVALID');
  }
  return parsed;
}

function duration(
  environment: Environment,
  names: readonly string[],
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  const raw = names.map((name) => environment[name]?.trim()).find(Boolean);
  if (!raw) return defaultValue;
  if (!/^[0-9]+$/u.test(raw)) throw new RuntimeConfigError('CONFIG_AGENT_DURATION_INVALID');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RuntimeConfigError('CONFIG_AGENT_DURATION_INVALID');
  }
  return value;
}

export function readConfigAgentRuntimeConfig(
  environment: Environment = process.env
): ConfigAgentRuntimeConfig {
  const socketPath = pathValue(
    environment,
    ['OPS_CONFIG_AGENT_SOCKET_PATH', 'CONFIG_AGENT_SOCKET_PATH'],
    '.sock'
  );
  const catalogPath = pathValue(
    environment,
    ['OPS_CONFIG_AGENT_CATALOG_PATH', 'CONFIG_AGENT_CATALOG_PATH'],
    '.yaml'
  );
  const manifestPath = pathValue(
    environment,
    ['OPS_CONFIG_AGENT_MANIFEST_PATH', 'CONFIG_AGENT_MANIFEST_PATH'],
    '.yaml'
  );
  const protocolKeyPath = pathValue(environment, [
    'OPS_CONFIG_AGENT_PROTOCOL_KEY_PATH',
    'OPS_CONFIG_AGENT_PROTOCOL_HMAC_KEY_PATH',
    'CONFIG_AGENT_PROTOCOL_KEY_PATH'
  ]);
  const fingerprintKeyPath = pathValue(environment, [
    'OPS_CONFIG_AGENT_FINGERPRINT_KEY_PATH',
    'CONFIG_AGENT_FINGERPRINT_KEY_PATH'
  ]);
  if (protocolKeyPath === fingerprintKeyPath) {
    throw new RuntimeConfigError('CONFIG_AGENT_KEY_PATHS_MUST_DIFFER');
  }

  const result: ConfigAgentRuntimeConfig = {
    socketPath,
    catalogPath,
    manifestPath,
    protocolKeyPath,
    protocolKeyId: stableId(environment, [
      'OPS_CONFIG_AGENT_PROTOCOL_KEY_ID',
      'OPS_CONFIG_AGENT_PROTOCOL_HMAC_KEY_ID',
      'CONFIG_AGENT_PROTOCOL_KEY_ID'
    ]),
    fingerprintKeyPath,
    fingerprintKeyVersion: fingerprintVersion(environment),
    socketGroup: configured(
      environment,
      ['OPS_CONFIG_AGENT_SOCKET_GROUP', 'CONFIG_AGENT_SOCKET_GROUP'],
      'CONFIG_AGENT_ENV_REQUIRED'
    ),
    clockSkewMs: duration(
      environment,
      ['OPS_CONFIG_AGENT_CLOCK_SKEW_MS', 'CONFIG_AGENT_CLOCK_SKEW_MS'],
      60_000,
      1_000,
      300_000
    ),
    requestTtlMs: duration(
      environment,
      ['OPS_CONFIG_AGENT_REQUEST_TTL_MS', 'CONFIG_AGENT_REQUEST_TTL_MS'],
      60_000,
      1_000,
      300_000
    ),
    maximumFrameBytes: MAXIMUM_FRAME_BYTES
  };
  const allowedPeerUid = optionalIdentity(environment, [
    'OPS_CONFIG_AGENT_ALLOWED_PEER_UID',
    'CONFIG_AGENT_ALLOWED_PEER_UID'
  ]);
  const allowedPeerGid = optionalIdentity(environment, [
    'OPS_CONFIG_AGENT_ALLOWED_PEER_GID',
    'CONFIG_AGENT_ALLOWED_PEER_GID'
  ]);
  if (allowedPeerUid !== undefined)
    return {
      ...result,
      allowedPeerUid,
      ...(allowedPeerGid === undefined ? {} : { allowedPeerGid })
    };
  if (allowedPeerGid !== undefined) return { ...result, allowedPeerGid };
  return result;
}
