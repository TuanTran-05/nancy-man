import { z } from 'zod';

export interface WebConfig {
  nodeEnv: string;
  dbPath: string;
  listenHost: '127.0.0.1';
  port: number;
  dataKey: Buffer;
}

export interface CollectorConfig {
  nodeEnv: string;
  appUrl: string;
  postgresUrl: string;
  pm2PidPath: string;
  pm2ErrorLogPath: string;
  cronLogPath: string;
  backupDir: string;
  zaloBotToken: string;
  recipientIds: string[];
  zaloTimeoutMs: number;
}

export interface FailsafeConfig {
  zaloBotToken: string;
  recipientIds: string[];
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
  const raw = required(env, 'OPS_ALERT_ZALO_RECIPIENT_UIDS');
  const recipients = raw.split(',').map((item) => item.trim()).filter(Boolean);
  if (recipients.length === 0) throw new Error('OPS_ALERT_ZALO_RECIPIENT_UIDS must not be empty');
  if (recipients.some((item) => !/^[A-Za-z0-9_.:-]{1,128}$/.test(item))) {
    throw new Error('OPS_ALERT_ZALO_RECIPIENT_UIDS contains an invalid recipient');
  }
  return [...new Set(recipients)];
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
  };
}

export function loadCollectorConfig(env: Env = process.env): CollectorConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const config: CollectorConfig = {
    nodeEnv,
    appUrl: requireLoopbackUrl(env, 'OPS_APP_URL'),
    postgresUrl: required(env, 'OPS_MONITOR_DATABASE_URL'),
    pm2PidPath: required(env, 'OPS_PM2_PID_PATH'),
    pm2ErrorLogPath: required(env, 'OPS_PM2_ERROR_LOG_PATH'),
    cronLogPath: required(env, 'OPS_CRON_LOG_PATH'),
    backupDir: required(env, 'OPS_BACKUP_DIR'),
    zaloBotToken: required(env, 'OPS_ALERT_ZALO_BOT_TOKEN'),
    recipientIds: parseRecipients(env),
    zaloTimeoutMs: positiveInteger(env, 'OPS_ALERT_ZALO_TIMEOUT_MS', 10000),
  };
  if (config.zaloTimeoutMs < 5000 || config.zaloTimeoutMs > 60000) {
    throw new Error('OPS_ALERT_ZALO_TIMEOUT_MS must be between 5000 and 60000');
  }
  if (nodeEnv === 'production' && config.recipientIds.length === 0) {
    throw new Error('production collector requires at least one Zalo recipient');
  }
  return config;
}

export function loadFailsafeConfig(env: Env = process.env): FailsafeConfig {
  const timeout = positiveInteger(env, 'OPS_ALERT_ZALO_TIMEOUT_MS', 10000);
  if (timeout < 5000 || timeout > 60000) throw new Error('OPS_ALERT_ZALO_TIMEOUT_MS must be between 5000 and 60000');
  return {
    zaloBotToken: required(env, 'OPS_ALERT_ZALO_BOT_TOKEN'),
    recipientIds: parseRecipients(env),
    zaloTimeoutMs: timeout,
  };
}

export const safeConfigSchema = z.object({
  nodeEnv: z.string(),
  port: z.number().int().positive(),
});
