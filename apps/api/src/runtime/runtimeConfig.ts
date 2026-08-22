import { isAbsolute } from 'node:path';

type Environment = Readonly<Record<string, string | undefined>>;

type BrowserContextKey = {
  id: string;
  secretReference: string;
};

export type OpsRuntimeConfig = {
  apiHost: '127.0.0.1';
  apiPort: number;
  publicUrl: 'https://man.thienuy.edu.vn';
  secretDirectory: string;
  databaseUrlReference: string;
  sessionPepperReference: string;
  rateLimitPepperReference: string;
  browserContextKey: BrowserContextKey;
  objectStoreDirectory: string;
  browserCorsOrigins: string[];
};

const credentialReference = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

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
    browserContextKey: {
      id: requiredCredentialReference(environment, 'OPS_BROWSER_CONTEXT_KEY_ID'),
      secretReference: requiredCredentialReference(environment, 'OPS_BROWSER_CONTEXT_KEY_REFERENCE')
    },
    objectStoreDirectory: requiredAbsolutePath(environment, 'OPS_OBJECT_STORE_DIRECTORY'),
    browserCorsOrigins: browserOrigins(environment)
  };
}
