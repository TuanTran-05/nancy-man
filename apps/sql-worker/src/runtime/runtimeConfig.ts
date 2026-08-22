import { isAbsolute, normalize } from 'node:path';

type Environment = Readonly<Record<string, string | undefined>>;

type ReadConfiguration =
  | { enabled: false }
  | {
      enabled: true;
      databaseUrlReference: string;
      databaseName: string;
      role: string;
    };

export type SqlWorkerRuntimeConfig = {
  secretDirectory: string;
  socketPath: string;
  hmacSecretReference: string;
  read: ReadConfiguration;
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

export function readSqlWorkerRuntimeConfig(environment: Environment): SqlWorkerRuntimeConfig {
  if (environment.OPS_PRODUCTION_READ_DATABASE_URL || environment.OPS_SQL_WORKER_HMAC) {
    throw new Error('Raw production credentials are forbidden; use a credential reference instead');
  }
  return {
    secretDirectory: absolutePath(environment, 'OPS_SECRET_DIRECTORY'),
    socketPath: absolutePath(environment, 'OPS_SQL_SOCKET_PATH', '.sock'),
    hmacSecretReference: credential(environment, 'OPS_SQL_WORKER_HMAC_REFERENCE'),
    read: readConfiguration(environment)
  };
}
