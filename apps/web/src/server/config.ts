import { z } from 'zod';
import { lstatSync, readFileSync } from 'node:fs';
import { isValidOpsZaloSecret } from './security/zaloLink.js';

export interface WebConfig {
  nodeEnv: string;
  dbPath: string;
  listenHost: '127.0.0.1';
  port: number;
  dataKey: Buffer;
  zaloBotToken: string;
  zaloWebhookSecret: string;
  zaloLinkCodePepper: string;
  zaloChatHashSecret: string;
  zaloRecipientKey: Buffer;
  zaloTimeoutMs: number;
  zaloLinkTtlSeconds: number;
}

export interface CollectorConfig {
  nodeEnv: string;
  dbPath: string;
  appUrl: string;
  postgresUrl: string;
  pm2PidPath: string;
  pm2ErrorLogPath: string;
  cronLogPath: string;
  backupDir: string;
  zaloBotToken: string;
  recipientIds: string[];
  zaloRecipientKey: Buffer;
  zaloTimeoutMs: number;
  beszel: BeszelCollectorConfig;
}

export type BeszelCollectorConfig =
  | { enabled: false }
  | {
      enabled: true;
      baseUrl: 'http://127.0.0.1:8090';
      username: string;
      passwordFile: string;
      systemId: string;
      timeoutMs: number;
    };

export interface FailsafeConfig {
  dbPath: string;
  zaloBotToken: string;
  recipientIds: string[];
  zaloRecipientKey: Buffer;
  zaloTimeoutMs: number;
}

type Env = Record<string, string | undefined>;

const required = (env: Env, name: string): string => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const positiveInteger = (env: Env, name: string, fallback?: number): number => {
  const raw = env[name] ?? (fallback === undefined ? undefined : String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

const parseRecipients = (env: Env): string[] => {
  const raw = (env.OPS_ALERT_ZALO_RECIPIENT_UIDS ?? '').trim();
  if (!raw) return [];
  const recipients = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (recipients.some((item) => !/^[A-Za-z0-9_.:-]{1,128}$/.test(item))) {
    throw new Error('OPS_ALERT_ZALO_RECIPIENT_UIDS contains an invalid recipient');
  }
  return [...new Set(recipients)];
};

const requiredSecret = (env: Env, name: string): string => {
  const value = required(env, name);
  if (!isValidOpsZaloSecret(value)) throw new Error(`${name} must contain 32 to 256 characters`);
  return value;
};

const requiredKey = (env: Env, name: string): Buffer => {
  const raw = required(env, name);
  const value = Buffer.from(raw, 'base64');
  if (value.length !== 32 || value.toString('base64') !== raw)
    throw new Error(`${name} must encode exactly 32 bytes`);
  return value;
};

const requireLoopbackUrl = (env: Env, name: string): string => {
  const value = required(env, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
    throw new Error(`${name} must use an http://127.0.0.1 URL`);
  }
  return value.replace(/\/$/, '');
};

function loadBeszelConfig(env: Env): BeszelCollectorConfig {
  const rawEnabled = env.OPS_BESZEL_ENABLED ?? 'false';
  if (rawEnabled !== 'true' && rawEnabled !== 'false')
    throw new Error('OPS_BESZEL_ENABLED must be true or false');
  if (rawEnabled === 'false') return { enabled: false };

  const configuredUrl = required(env, 'OPS_BESZEL_URL');
  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error('OPS_BESZEL_URL must be exactly http://127.0.0.1:8090');
  }
  if (parsed.href !== 'http://127.0.0.1:8090/')
    throw new Error('OPS_BESZEL_URL must be exactly http://127.0.0.1:8090');

  const passwordFile = required(env, 'OPS_BESZEL_PASSWORD_FILE');
  const stat = lstatSync(passwordFile);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('OPS_BESZEL_PASSWORD_FILE must be a regular file');
  if (!readFileSync(passwordFile, 'utf8').trim())
    throw new Error('OPS_BESZEL_PASSWORD_FILE must not be empty');

  const timeoutMs = positiveInteger(env, 'OPS_BESZEL_TIMEOUT_MS', 5000);
  if (timeoutMs < 1000 || timeoutMs > 10000)
    throw new Error('OPS_BESZEL_TIMEOUT_MS must be between 1000 and 10000');
  const username = z.string().email().max(254).parse(required(env, 'OPS_BESZEL_USER'));
  const systemId = z
    .string()
    .regex(/^[a-z0-9]{15}$/u)
    .parse(required(env, 'OPS_BESZEL_SYSTEM_ID'));
  return {
    enabled: true,
    baseUrl: 'http://127.0.0.1:8090',
    username,
    passwordFile,
    systemId,
    timeoutMs
  };
}

export function loadWebConfig(env: Env = process.env): WebConfig {
  const listenHost = env.OPS_LISTEN_HOST ?? '127.0.0.1';
  if (listenHost !== '127.0.0.1') throw new Error('OPS_LISTEN_HOST must be 127.0.0.1');
  const keyRaw = required(env, 'OPS_DATA_KEY');
  let dataKey: Buffer;
  try {
    dataKey = Buffer.from(keyRaw, 'base64');
  } catch {
    throw new Error('OPS_DATA_KEY must be base64');
  }
  if (dataKey.length !== 32 || dataKey.toString('base64') !== keyRaw) {
    throw new Error('OPS_DATA_KEY must encode exactly 32 bytes');
  }
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    dbPath: required(env, 'OPS_DB_PATH'),
    listenHost,
    port: positiveInteger(env, 'OPS_PORT', 3101),
    dataKey,
    zaloBotToken: required(env, 'OPS_ALERT_ZALO_BOT_TOKEN'),
    zaloWebhookSecret: requiredSecret(env, 'OPS_ZALO_WEBHOOK_SECRET'),
    zaloLinkCodePepper: requiredSecret(env, 'OPS_ZALO_LINK_CODE_PEPPER'),
    zaloChatHashSecret: requiredSecret(env, 'OPS_ZALO_CHAT_HASH_SECRET'),
    zaloRecipientKey: requiredKey(env, 'OPS_ZALO_RECIPIENT_KEY'),
    zaloTimeoutMs: positiveInteger(env, 'OPS_ALERT_ZALO_TIMEOUT_MS', 10000),
    zaloLinkTtlSeconds: positiveInteger(env, 'OPS_ZALO_LINK_TTL_SECONDS', 600)
  };
}

export function loadCollectorConfig(env: Env = process.env): CollectorConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const config: CollectorConfig = {
    nodeEnv,
    dbPath: required(env, 'OPS_DB_PATH'),
    appUrl: requireLoopbackUrl(env, 'OPS_APP_URL'),
    postgresUrl: required(env, 'OPS_MONITOR_DATABASE_URL'),
    pm2PidPath: required(env, 'OPS_PM2_PID_PATH'),
    pm2ErrorLogPath: required(env, 'OPS_PM2_ERROR_LOG_PATH'),
    cronLogPath: required(env, 'OPS_CRON_LOG_PATH'),
    backupDir: required(env, 'OPS_BACKUP_DIR'),
    zaloBotToken: required(env, 'OPS_ALERT_ZALO_BOT_TOKEN'),
    recipientIds: parseRecipients(env),
    zaloRecipientKey: requiredKey(env, 'OPS_ZALO_RECIPIENT_KEY'),
    zaloTimeoutMs: positiveInteger(env, 'OPS_ALERT_ZALO_TIMEOUT_MS', 10000),
    beszel: loadBeszelConfig(env)
  };
  if (config.zaloTimeoutMs < 5000 || config.zaloTimeoutMs > 60000) {
    throw new Error('OPS_ALERT_ZALO_TIMEOUT_MS must be between 5000 and 60000');
  }
  return config;
}

export function loadFailsafeConfig(env: Env = process.env): FailsafeConfig {
  const timeout = positiveInteger(env, 'OPS_ALERT_ZALO_TIMEOUT_MS', 10000);
  if (timeout < 5000 || timeout > 60000)
    throw new Error('OPS_ALERT_ZALO_TIMEOUT_MS must be between 5000 and 60000');
  return {
    dbPath: required(env, 'OPS_DB_PATH'),
    zaloBotToken: required(env, 'OPS_ALERT_ZALO_BOT_TOKEN'),
    recipientIds: parseRecipients(env),
    zaloRecipientKey: requiredKey(env, 'OPS_ZALO_RECIPIENT_KEY'),
    zaloTimeoutMs: timeout
  };
}

export const safeConfigSchema = z.object({
  nodeEnv: z.string(),
  port: z.number().int().positive()
});
