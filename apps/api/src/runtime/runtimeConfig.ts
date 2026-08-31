import { isAbsolute, normalize } from 'node:path';

type Environment = Readonly<Record<string, string | undefined>>;

type BrowserContextKey = {
  id: string;
  secretReference: string;
};
type SqlWorkerConfig =
  | { enabled: false }
  | {
      enabled: true;
      socketPath: string;
      hmacSecretReference: string;
      auditEncryptionKeyReference: string;
    };

export type ConfigAgentRuntimeConfig =
  | { enabled: false }
  | {
      enabled: true;
      socketPath: string;
      protocolHmacKeyReference: string;
      protocolHmacKeyId: string;
      expectedManifestVersion: string;
      expectedCatalogVersion: string;
      expectedCatalogDigest: string;
      connectTimeoutMs: number;
      readTimeoutMs: number;
      totalTimeoutMs: number;
      maximumResponseBytes: number;
    };

export type OpsRuntimeConfig = {
  apiHost: '127.0.0.1';
  apiPort: number;
  publicUrl: 'https://man.thienuy.edu.vn';
  secretDirectory: string;
  databaseUrlReference: string;
  sessionPepperReference: string;
  rateLimitPepperReference: string;
  authSessionPepperReference: string;
  mfaEncryptionKeyReference: string;
  passwordFingerprintPepperReference: string;
  legacyMonitoringHmacReference: string;
  browserContextKey: BrowserContextKey;
  objectStoreDirectory: string;
  browserCorsOrigins: string[];
  sqlWorker: SqlWorkerConfig;
  configAgent: ConfigAgentRuntimeConfig;
};

const credentialReference = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const schemaVersion = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[A-Za-z0-9._-]+)?$/u;
const digest = /^sha256:[a-f0-9]{64}$/u;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredCredentialReference(environment: Environment, name: string): string {
  const value = required(environment, name);
  if (!credentialReference.test(value)) {
    throw new Error(`${name} must be a credential reference`);
  }
  return value;
}

function requiredAbsolutePath(environment: Environment, name: string): string {
  const value = required(environment, name);
  if (!isAbsolute(value) || value === '/') throw new Error(`${name} must be an absolute directory`);
  return value;
}

function requiredBoolean(environment: Environment, name: string): boolean {
  const value = required(environment, name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function optionalBoolean(environment: Environment, name: string, fallback: boolean): boolean {
  const value = environment[name]?.trim();
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function requiredTimeout(environment: Environment, name: string): number {
  const value = required(environment, name);
  if (!/^[0-9]{1,5}$/u.test(value)) throw new Error(`${name} must be a timeout in milliseconds`);
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 60_000) {
    throw new Error(`${name} must be a timeout in milliseconds`);
  }
  return milliseconds;
}

function configAgent(environment: Environment): ConfigAgentRuntimeConfig {
  if (!optionalBoolean(environment, 'OPS_VARIABLES_READ_ONLY_ENABLED', false)) {
    return { enabled: false };
  }
  if (environment.OPS_CONFIG_AGENT_HMAC) {
    throw new Error('OPS_CONFIG_AGENT_HMAC is forbidden; use a credential reference instead');
  }
  const socket = required(environment, 'OPS_CONFIG_AGENT_SOCKET_PATH');
  if (!isAbsolute(socket) || normalize(socket) !== socket || !socket.endsWith('.sock')) {
    throw new Error('OPS_CONFIG_AGENT_SOCKET_PATH must be an absolute socket path');
  }
  const manifestVersion = required(environment, 'OPS_CONFIG_AGENT_MANIFEST_VERSION');
  const catalogVersion = required(environment, 'OPS_CONFIG_AGENT_CATALOG_VERSION');
  if (!schemaVersion.test(manifestVersion) || !schemaVersion.test(catalogVersion)) {
    throw new Error('OPS_CONFIG_AGENT catalog and manifest versions are invalid');
  }
  const catalogDigest = required(environment, 'OPS_CONFIG_AGENT_CATALOG_DIGEST');
  if (!digest.test(catalogDigest)) throw new Error('OPS_CONFIG_AGENT_CATALOG_DIGEST is invalid');
  const connectTimeoutMs = requiredTimeout(environment, 'OPS_CONFIG_AGENT_CONNECT_TIMEOUT_MS');
  const readTimeoutMs = requiredTimeout(environment, 'OPS_CONFIG_AGENT_READ_TIMEOUT_MS');
  const totalTimeoutMs = requiredTimeout(environment, 'OPS_CONFIG_AGENT_TOTAL_TIMEOUT_MS');
  if (totalTimeoutMs < Math.max(connectTimeoutMs, readTimeoutMs)) {
    throw new Error('OPS_CONFIG_AGENT_TOTAL_TIMEOUT_MS must cover connect and read timeouts');
  }
  const maximumResponseBytes = Number(required(environment, 'OPS_CONFIG_AGENT_MAX_RESPONSE_BYTES'));
  if (!Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1 || maximumResponseBytes > 1_048_576) {
    throw new Error('OPS_CONFIG_AGENT_MAX_RESPONSE_BYTES is invalid');
  }
  return {
    enabled: true,
    socketPath: socket,
    protocolHmacKeyReference: requiredCredentialReference(
      environment,
      'OPS_CONFIG_AGENT_HMAC_REFERENCE'
    ),
    protocolHmacKeyId: requiredCredentialReference(environment, 'OPS_CONFIG_AGENT_HMAC_KEY_ID'),
    expectedManifestVersion: manifestVersion,
    expectedCatalogVersion: catalogVersion,
    expectedCatalogDigest: catalogDigest,
    connectTimeoutMs,
    readTimeoutMs,
    totalTimeoutMs,
    maximumResponseBytes
  };
}

function socketPath(environment: Environment): string {
  const value = required(environment, 'OPS_SQL_SOCKET_PATH');
  if (!isAbsolute(value) || normalize(value) !== value || !value.endsWith('.sock')) {
    throw new Error('OPS_SQL_SOCKET_PATH must be an absolute socket path');
  }
  return value;
}

function sqlWorker(environment: Environment): SqlWorkerConfig {
  if (!requiredBoolean(environment, 'OPS_SQL_WORKER_ENABLED')) return { enabled: false };
  return {
    enabled: true,
    socketPath: socketPath(environment),
    hmacSecretReference: requiredCredentialReference(environment, 'OPS_SQL_WORKER_HMAC_REFERENCE'),
    auditEncryptionKeyReference: requiredCredentialReference(
      environment,
      'OPS_SQL_AUDIT_ENCRYPTION_KEY_REFERENCE'
    )
  };
}

function browserOrigins(environment: Environment): string[] {
  const configured = required(environment, 'OPS_BROWSER_CORS_ORIGINS');
  const origins = configured.split(',').map((origin) => origin.trim());
  if (origins.length === 0 || origins.some((origin) => !origin)) {
    throw new Error('OPS_BROWSER_CORS_ORIGINS must contain one or more origins');
  }
  const uniqueOrigins = new Set<string>();
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('OPS_BROWSER_CORS_ORIGINS contains an invalid origin');
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || uniqueOrigins.has(origin)) {
      throw new Error('OPS_BROWSER_CORS_ORIGINS must contain unique HTTPS origins only');
    }
    uniqueOrigins.add(origin);
  }
  return [...uniqueOrigins];
}

export function readOpsRuntimeConfig(environment: Environment): OpsRuntimeConfig {
  if (environment.OPS_DATABASE_URL) {
    throw new Error('OPS_DATABASE_URL is forbidden; use a credential reference instead');
  }
  if (environment.OPS_AUTO_MIGRATE) {
    throw new Error('Automatic migration at API startup is forbidden');
  }

  const apiHost = required(environment, 'OPS_API_HOST');
  if (apiHost !== '127.0.0.1') throw new Error('OPS_API_HOST must be loopback-only');

  const apiPortText = required(environment, 'OPS_API_PORT');
  if (!/^[0-9]{1,5}$/.test(apiPortText)) throw new Error('OPS_API_PORT must be a valid port');
  const apiPort = Number(apiPortText);
  if (!Number.isSafeInteger(apiPort) || apiPort < 1024 || apiPort > 65_535) {
    throw new Error('OPS_API_PORT must be between 1024 and 65535');
  }

  const publicUrl = required(environment, 'OPS_PUBLIC_URL');
  if (publicUrl !== 'https://man.thienuy.edu.vn') {
    throw new Error('OPS_PUBLIC_URL must be https://man.thienuy.edu.vn');
  }

  return {
    apiHost,
    apiPort,
    publicUrl,
    secretDirectory: requiredAbsolutePath(environment, 'OPS_SECRET_DIRECTORY'),
    databaseUrlReference: requiredCredentialReference(environment, 'OPS_DATABASE_URL_REFERENCE'),
    sessionPepperReference: requiredCredentialReference(
      environment,
      'OPS_SESSION_PEPPER_REFERENCE'
    ),
    rateLimitPepperReference: requiredCredentialReference(
      environment,
      'OPS_RATE_LIMIT_PEPPER_REFERENCE'
    ),
    authSessionPepperReference: requiredCredentialReference(
      environment,
      'OPS_AUTH_SESSION_PEPPER_REFERENCE'
    ),
    mfaEncryptionKeyReference: requiredCredentialReference(
      environment,
      'OPS_MFA_ENCRYPTION_KEY_REFERENCE'
    ),
    passwordFingerprintPepperReference: requiredCredentialReference(
      environment,
      'OPS_PASSWORD_FINGERPRINT_PEPPER_REFERENCE'
    ),
    legacyMonitoringHmacReference: requiredCredentialReference(
      environment,
      'OPS_LEGACY_MONITORING_HMAC_REFERENCE'
    ),
    browserContextKey: {
      id: requiredCredentialReference(environment, 'OPS_BROWSER_CONTEXT_KEY_ID'),
      secretReference: requiredCredentialReference(environment, 'OPS_BROWSER_CONTEXT_KEY_REFERENCE')
    },
    objectStoreDirectory: requiredAbsolutePath(environment, 'OPS_OBJECT_STORE_DIRECTORY'),
    browserCorsOrigins: browserOrigins(environment),
    sqlWorker: sqlWorker(environment),
    configAgent: configAgent(environment)
  };
}
