import { isAbsolute, normalize, relative } from 'node:path';

export type ServerTelemetryRuntimeConfig =
  | { enabled: false }
  | {
      enabled: true;
      endpoint: 'https://man.thienuy.edu.vn/api/v1/ingest/server';
      keyId: string;
      hmacSecretReference: string;
      release: string;
      spoolRoot: string;
      spoolDirectory: string;
    };

type Environment = Readonly<Record<string, string | undefined>>;

const credentialReference = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const releaseSha = /^[a-f0-9]{40}$/iu;
const canonicalEndpoint = 'https://man.thienuy.edu.vn/api/v1/ingest/server' as const;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredBoolean(environment: Environment, name: string): boolean {
  const value = required(environment, name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function requiredCredentialReference(environment: Environment, name: string): string {
  const value = required(environment, name);
  if (!credentialReference.test(value)) {
    throw new Error(`${name} must be a credential reference`);
  }
  return value;
}

function requiredDirectory(environment: Environment, name: string): string {
  const value = required(environment, name);
  if (!isAbsolute(value) || value === '/' || normalize(value) !== value) {
    throw new Error(`${name} must be an absolute directory`);
  }
  return value;
}

export function readServerTelemetryRuntimeConfig(
  environment: Environment,
  input: { production?: boolean } = {}
): ServerTelemetryRuntimeConfig {
  const enabled = requiredBoolean(environment, 'OPS_TELEMETRY_ENABLED');
  const production = input.production ?? environment.NODE_ENV === 'production';
  if (!enabled) {
    if (production) throw new Error('OPS_TELEMETRY_ENABLED must be true in production');
    return { enabled: false };
  }

  const endpoint = required(environment, 'OPS_TELEMETRY_INGEST_URL');
  if (endpoint !== canonicalEndpoint) {
    throw new Error('OPS_TELEMETRY_INGEST_URL must target the canonical server ingest endpoint');
  }
  const release = required(environment, 'OPS_TELEMETRY_RELEASE');
  if (!releaseSha.test(release)) {
    throw new Error('OPS_TELEMETRY_RELEASE must be a 40-character commit SHA');
  }
  const spoolRoot = requiredDirectory(environment, 'OPS_TELEMETRY_SPOOL_ROOT');
  const spoolDirectory = requiredDirectory(environment, 'OPS_TELEMETRY_SPOOL_DIRECTORY');
  const spoolRelativePath = relative(spoolRoot, spoolDirectory);
  if (spoolRelativePath.startsWith('..') || isAbsolute(spoolRelativePath)) {
    throw new Error('OPS_TELEMETRY_SPOOL_DIRECTORY must be inside OPS_TELEMETRY_SPOOL_ROOT');
  }

  return {
    enabled: true,
    endpoint: canonicalEndpoint,
    keyId: requiredCredentialReference(environment, 'OPS_TELEMETRY_KEY_ID'),
    hmacSecretReference: requiredCredentialReference(
      environment,
      'OPS_TELEMETRY_HMAC_SECRET_REFERENCE'
    ),
    release: release.toLowerCase(),
    spoolRoot,
    spoolDirectory
  };
}
