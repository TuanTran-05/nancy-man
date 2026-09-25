import { isAbsolute, normalize } from 'node:path';

import {
  readServerTelemetryRuntimeConfig,
  type ServerTelemetryRuntimeConfig
} from '../../../../packages/telemetry-sdk/src/serverRuntimeConfig.js';

type Environment = Readonly<Record<string, string | undefined>>;

type ReadConfiguration =
  | { enabled: false }
  | {
      enabled: true;
      databaseUrlReference: string;
      databaseName: string;
      role: string;
    };

type MutationConfiguration =
  | { enabled: false }
  | {
      enabled: true;
      databaseUrlReference: string;
      databaseName: string;
      role: string;
    };

export type DatabaseTargetConfig =
  | { enabled: false }
  | {
      enabled: true;
      databaseUrlReference: string;
      databaseName: string;
      role: string;
    };

export type DatabaseExplorerConfig =
  | { enabled: false }
  | {
      enabled: true;
      cursorKeyReference: string;
      policyApprovalReference: string;
      targets: {
        edutrack_production: DatabaseTargetConfig;
        ops: DatabaseTargetConfig;
      };
    };

export type SqlWorkerRuntimeConfig = {
  secretDirectory: string;
  socketPath: string;
  hmacSecretReference: string;
  telemetry: ServerTelemetryRuntimeConfig;
  telemetryHmacPath?: string;
  read: ReadConfiguration;
  mutation: MutationConfiguration;
  explorer: DatabaseExplorerConfig;
};

const credentialReference = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const postgresIdentifier = /^[a-z_][a-z0-9_]{0,62}$/;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function credential(environment: Environment, name: string): string {
  const value = required(environment, name);
  if (!credentialReference.test(value)) throw new Error(`${name} must be a credential reference`);
  return value;
}

function absolutePath(environment: Environment, name: string, suffix?: string): string {
  const value = required(environment, name);
  if (
    !isAbsolute(value) ||
    value === '/' ||
    normalize(value) !== value ||
    (suffix !== undefined && !value.endsWith(suffix))
  ) {
    throw new Error(`${name} must be an absolute ${suffix ? suffix : 'path'}`);
  }
  return value;
}

function postgresName(environment: Environment, name: string): string {
  const value = required(environment, name);
  if (!postgresIdentifier.test(value)) throw new Error(`${name} must be a PostgreSQL identifier`);
  return value;
}

function readConfiguration(environment: Environment): ReadConfiguration {
  const enabled = required(environment, 'OPS_SQL_READ_ENABLED');
  if (enabled === 'false') return { enabled: false };
  if (enabled !== 'true') throw new Error('OPS_SQL_READ_ENABLED must be true or false');
  return {
    enabled: true,
    databaseUrlReference: credential(environment, 'OPS_PRODUCTION_READ_DATABASE_URL_REFERENCE'),
    databaseName: postgresName(environment, 'OPS_PRODUCTION_READ_DATABASE_NAME'),
    role: postgresName(environment, 'OPS_PRODUCTION_READ_ROLE')
  };
}

function mutationConfiguration(environment: Environment): MutationConfiguration {
  const enabled = required(environment, 'OPS_SQL_MUTATION_ENABLED');
  if (enabled === 'false') return { enabled: false };
  if (enabled !== 'true') throw new Error('OPS_SQL_MUTATION_ENABLED must be true or false');
  return {
    enabled: true,
    databaseUrlReference: credential(environment, 'OPS_PRODUCTION_MUTATION_DATABASE_URL_REFERENCE'),
    databaseName: postgresName(environment, 'OPS_PRODUCTION_MUTATION_DATABASE_NAME'),
    role: postgresName(environment, 'OPS_PRODUCTION_MUTATION_ROLE')
  };
}

const ALLOWED_DATABASE_KEYS = new Set([
  'OPS_DATABASE_EXPLORER_ENABLED',
  'OPS_DATABASE_EDUTRACK_ENABLED',
  'OPS_DATABASE_EDUTRACK_URL_REFERENCE',
  'OPS_DATABASE_EDUTRACK_NAME',
  'OPS_DATABASE_EDUTRACK_ROLE',
  'OPS_DATABASE_OPS_ENABLED',
  'OPS_DATABASE_OPS_URL_REFERENCE',
  'OPS_DATABASE_OPS_NAME',
  'OPS_DATABASE_OPS_ROLE',
  'OPS_DATABASE_CURSOR_KEY_REFERENCE',
  'OPS_DATABASE_POLICY_APPROVAL_REFERENCE'
]);

function targetConfiguration(
  environment: Environment,
  prefix: 'OPS_DATABASE_EDUTRACK' | 'OPS_DATABASE_OPS'
): DatabaseTargetConfig {
  const enabled = environment[`${prefix}_ENABLED`]?.trim();
  if (enabled === 'false' || enabled === undefined) return { enabled: false };
  if (enabled !== 'true') throw new Error(`${prefix}_ENABLED must be true or false`);
  return {
    enabled: true,
    databaseUrlReference: credential(environment, `${prefix}_URL_REFERENCE`),
    databaseName: postgresName(environment, `${prefix}_NAME`),
    role: postgresName(environment, `${prefix}_ROLE`)
  };
}

function explorerConfiguration(environment: Environment): DatabaseExplorerConfig {
  const enabled = environment.OPS_DATABASE_EXPLORER_ENABLED?.trim();
  if (enabled === 'false' || enabled === undefined) return { enabled: false };
  if (enabled !== 'true') throw new Error('OPS_DATABASE_EXPLORER_ENABLED must be true or false');

  for (const key of Object.keys(environment)) {
    if (key.startsWith('OPS_DATABASE_') && !ALLOWED_DATABASE_KEYS.has(key)) {
      throw new Error(`Unknown or arbitrary target environment key: ${key}`);
    }
  }

  return {
    enabled: true,
    cursorKeyReference: credential(environment, 'OPS_DATABASE_CURSOR_KEY_REFERENCE'),
    policyApprovalReference: credential(environment, 'OPS_DATABASE_POLICY_APPROVAL_REFERENCE'),
    targets: {
      edutrack_production: targetConfiguration(environment, 'OPS_DATABASE_EDUTRACK'),
      ops: targetConfiguration(environment, 'OPS_DATABASE_OPS')
    }
  };
}

export function readSqlWorkerRuntimeConfig(environment: Environment): SqlWorkerRuntimeConfig {
  if (
    environment.OPS_PRODUCTION_READ_DATABASE_URL ||
    environment.OPS_PRODUCTION_MUTATION_DATABASE_URL ||
    environment.OPS_SQL_WORKER_HMAC ||
    environment.OPS_DATABASE_EDUTRACK_URL ||
    environment.OPS_DATABASE_OPS_URL ||
    environment.OPS_DATABASE_CURSOR_KEY ||
    environment.OPS_DATABASE_POLICY_APPROVAL
  ) {
    throw new Error('Raw production credentials are forbidden; use a credential reference instead');
  }
  const telemetry = readServerTelemetryRuntimeConfig({
    ...environment,
    ...(environment.OPS_TELEMETRY_ENABLED === undefined ? { OPS_TELEMETRY_ENABLED: 'false' } : {})
  });
  const telemetryHmacPath = telemetry.enabled
    ? absolutePath(environment, 'OPS_TELEMETRY_HMAC_FILE')
    : undefined;
  return {
    secretDirectory: absolutePath(environment, 'OPS_SECRET_DIRECTORY'),
    socketPath: absolutePath(environment, 'OPS_SQL_SOCKET_PATH', '.sock'),
    hmacSecretReference: credential(environment, 'OPS_SQL_WORKER_HMAC_REFERENCE'),
    telemetry,
    ...(telemetryHmacPath ? { telemetryHmacPath } : {}),
    read: readConfiguration(environment),
    mutation: mutationConfiguration(environment),
    explorer: explorerConfiguration(environment)
  };
}
