import { isAbsolute, join, normalize } from 'node:path';

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
  stagingKeyPath: string;
  stagingKeyId: string;
  stagingKeyVersion: string;
  stagingAcceptedOldKeyIds: readonly string[];
  snapshotKeyPath: string;
  snapshotKeyId: string;
  snapshotKeyVersion: string;
  snapshotAcceptedOldKeyIds: readonly string[];
  stateDirectory: string;
  draftsDirectory: string;
  stagedDirectory: string;
  snapshotsDirectory: string;
  locksDirectory: string;
  draftTtlMs: number;
  stagedTtlMs: number;
  snapshotRetentionMs: number;
  socketGroup: string;
  allowedPeerUid?: number;
  allowedPeerGid?: number;
  clockSkewMs: number;
  requestTtlMs: number;
  maximumFrameBytes: typeof MAXIMUM_FRAME_BYTES;
  draftEnabled?: boolean;
  runtimeApplyEnabled?: boolean;
  buildApplyEnabled?: boolean;
}>;

export type RuntimeConfigErrorCode =
  | 'CONFIG_AGENT_ENV_REQUIRED'
  | 'CONFIG_AGENT_PATH_INVALID'
  | 'CONFIG_AGENT_KEY_ID_INVALID'
  | 'CONFIG_AGENT_KEY_PATHS_MUST_DIFFER'
  | 'CONFIG_AGENT_KEY_IDS_MUST_DIFFER'
  | 'CONFIG_AGENT_IDENTITY_INVALID'
  | 'CONFIG_AGENT_DURATION_INVALID'
  | 'CONFIG_AGENT_RETENTION_INVALID';

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

function keyVersion(environment: Environment, names: readonly string[]): string {
  const value = configured(environment, names, 'CONFIG_AGENT_ENV_REQUIRED');
  if (!/^v[0-9]+$/u.test(value)) throw new RuntimeConfigError('CONFIG_AGENT_KEY_ID_INVALID');
  return value;
}

function oldKeyIds(environment: Environment, names: readonly string[]): string[] {
  const raw = names.map((name) => environment[name]?.trim()).find(Boolean);
  if (!raw) return [];
  const values = raw.split(',').map((value) => value.trim());
  if (values.some((value) => !value || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(value))) {
    throw new RuntimeConfigError('CONFIG_AGENT_KEY_ID_INVALID');
  }
  if (new Set(values).size !== values.length) {
    throw new RuntimeConfigError('CONFIG_AGENT_KEY_ID_INVALID');
  }
  return values;
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

function retentionDuration(
  environment: Environment,
  names: readonly string[],
  defaultValue: number,
  maximum: number
): number {
  const raw = names.map((name) => environment[name]?.trim()).find(Boolean);
  if (!raw) return defaultValue;
  if (!/^[0-9]+$/u.test(raw)) throw new RuntimeConfigError('CONFIG_AGENT_RETENTION_INVALID');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RuntimeConfigError('CONFIG_AGENT_RETENTION_INVALID');
  }
  return value;
}

function optionalBoolean(environment: Environment, names: readonly string[]): boolean | undefined {
  const raw = names
    .map((name) => environment[name]?.trim())
    .find((value) => value !== undefined && value !== '');
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new RuntimeConfigError('CONFIG_AGENT_ENV_REQUIRED');
}

function childDirectory(environment: Environment, stateDirectory: string, name: string): string {
  const directory = pathValue(environment, [
    `OPS_CONFIG_AGENT_${name.toUpperCase()}_DIRECTORY`,
    `CONFIG_AGENT_${name.toUpperCase()}_DIRECTORY`
  ]);
  if (directory !== join(stateDirectory, name.toLowerCase())) {
    throw new RuntimeConfigError('CONFIG_AGENT_PATH_INVALID');
  }
  return directory;
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
  const stagingKeyPath = pathValue(environment, [
    'OPS_CONFIG_AGENT_STAGING_KEY_PATH',
    'CONFIG_AGENT_STAGING_KEY_PATH'
  ]);
  const snapshotKeyPath = pathValue(environment, [
    'OPS_CONFIG_AGENT_SNAPSHOT_KEY_PATH',
    'CONFIG_AGENT_SNAPSHOT_KEY_PATH'
  ]);
  const keyPaths = [protocolKeyPath, fingerprintKeyPath, stagingKeyPath, snapshotKeyPath];
  if (new Set(keyPaths).size !== keyPaths.length) {
    throw new RuntimeConfigError('CONFIG_AGENT_KEY_PATHS_MUST_DIFFER');
  }

  const protocolKeyId = stableId(environment, [
    'OPS_CONFIG_AGENT_PROTOCOL_KEY_ID',
    'OPS_CONFIG_AGENT_PROTOCOL_HMAC_KEY_ID',
    'CONFIG_AGENT_PROTOCOL_KEY_ID'
  ]);
  const stagingKeyId = stableId(environment, [
    'OPS_CONFIG_AGENT_STAGING_KEY_ID',
    'CONFIG_AGENT_STAGING_KEY_ID'
  ]);
  const snapshotKeyId = stableId(environment, [
    'OPS_CONFIG_AGENT_SNAPSHOT_KEY_ID',
    'CONFIG_AGENT_SNAPSHOT_KEY_ID'
  ]);
  const fingerprintKeyId = stableId(environment, [
    'OPS_CONFIG_AGENT_FINGERPRINT_KEY_VERSION',
    'OPS_CONFIG_AGENT_FINGERPRINT_KEY_ID',
    'CONFIG_AGENT_FINGERPRINT_KEY_ID'
  ]);
  const keyIds = [protocolKeyId, fingerprintKeyId, stagingKeyId, snapshotKeyId];
  if (new Set(keyIds).size !== keyIds.length) {
    throw new RuntimeConfigError('CONFIG_AGENT_KEY_IDS_MUST_DIFFER');
  }

  const stagingAcceptedOldKeyIds = oldKeyIds(environment, [
    'OPS_CONFIG_AGENT_STAGING_OLD_KEY_IDS',
    'CONFIG_AGENT_STAGING_OLD_KEY_IDS'
  ]);
  const snapshotAcceptedOldKeyIds = oldKeyIds(environment, [
    'OPS_CONFIG_AGENT_SNAPSHOT_OLD_KEY_IDS',
    'CONFIG_AGENT_SNAPSHOT_OLD_KEY_IDS'
  ]);
  const allKeyIds = [...keyIds, ...stagingAcceptedOldKeyIds, ...snapshotAcceptedOldKeyIds];
  if (new Set(allKeyIds).size !== allKeyIds.length) {
    throw new RuntimeConfigError('CONFIG_AGENT_KEY_IDS_MUST_DIFFER');
  }

  const stateDirectory = pathValue(environment, [
    'OPS_CONFIG_AGENT_STATE_DIRECTORY',
    'CONFIG_AGENT_STATE_DIRECTORY'
  ]);
  const draftsDirectory = childDirectory(environment, stateDirectory, 'drafts');
  const stagedDirectory = childDirectory(environment, stateDirectory, 'staged');
  const snapshotsDirectory = childDirectory(environment, stateDirectory, 'snapshots');
  const locksDirectory = childDirectory(environment, stateDirectory, 'locks');

  const result: ConfigAgentRuntimeConfig = {
    socketPath,
    catalogPath,
    manifestPath,
    protocolKeyPath,
    protocolKeyId,
    fingerprintKeyPath,
    fingerprintKeyVersion: fingerprintVersion(environment),
    stagingKeyPath,
    stagingKeyId,
    stagingKeyVersion: keyVersion(environment, [
      'OPS_CONFIG_AGENT_STAGING_KEY_VERSION',
      'CONFIG_AGENT_STAGING_KEY_VERSION'
    ]),
    stagingAcceptedOldKeyIds,
    snapshotKeyPath,
    snapshotKeyId,
    snapshotKeyVersion: keyVersion(environment, [
      'OPS_CONFIG_AGENT_SNAPSHOT_KEY_VERSION',
      'CONFIG_AGENT_SNAPSHOT_KEY_VERSION'
    ]),
    snapshotAcceptedOldKeyIds,
    stateDirectory,
    draftsDirectory,
    stagedDirectory,
    snapshotsDirectory,
    locksDirectory,
    draftTtlMs: retentionDuration(
      environment,
      ['OPS_CONFIG_AGENT_DRAFT_TTL_MS', 'CONFIG_AGENT_DRAFT_TTL_MS'],
      24 * 60 * 60 * 1_000,
      24 * 60 * 60 * 1_000
    ),
    stagedTtlMs: retentionDuration(
      environment,
      ['OPS_CONFIG_AGENT_STAGED_TTL_MS', 'CONFIG_AGENT_STAGED_TTL_MS'],
      24 * 60 * 60 * 1_000,
      24 * 60 * 60 * 1_000
    ),
    snapshotRetentionMs: retentionDuration(
      environment,
      ['OPS_CONFIG_AGENT_SNAPSHOT_RETENTION_MS', 'CONFIG_AGENT_SNAPSHOT_RETENTION_MS'],
      30 * 24 * 60 * 60 * 1_000,
      30 * 24 * 60 * 60 * 1_000
    ),
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
  const draftEnabled = optionalBoolean(environment, [
    'OPS_VARIABLES_DRAFT_ENABLED',
    'CONFIG_AGENT_VARIABLES_DRAFT_ENABLED'
  ]);
  const runtimeApplyEnabled = optionalBoolean(environment, [
    'OPS_VARIABLES_RUNTIME_APPLY_ENABLED',
    'CONFIG_AGENT_VARIABLES_RUNTIME_APPLY_ENABLED'
  ]);
  const buildApplyEnabled = optionalBoolean(environment, [
    'OPS_VARIABLES_BUILD_APPLY_ENABLED',
    'CONFIG_AGENT_VARIABLES_BUILD_APPLY_ENABLED'
  ]);
  const configuredResult: ConfigAgentRuntimeConfig =
    draftEnabled !== undefined ||
    runtimeApplyEnabled !== undefined ||
    buildApplyEnabled !== undefined
      ? {
          ...result,
          draftEnabled: draftEnabled ?? false,
          runtimeApplyEnabled: runtimeApplyEnabled ?? false,
          buildApplyEnabled: buildApplyEnabled ?? false
        }
      : result;
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
      ...configuredResult,
      allowedPeerUid,
      ...(allowedPeerGid === undefined ? {} : { allowedPeerGid })
    };
  if (allowedPeerGid !== undefined) return { ...configuredResult, allowedPeerGid };
  return configuredResult;
}
