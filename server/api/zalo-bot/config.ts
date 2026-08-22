import { ADMIN_CHAT_INTENTS, type AdminChatIntent } from '../../../shared/adminChatMetrics.js';

export type ZaloBotConfig = {
  enabled: boolean;
  dailyDigestEnabled: boolean;
  dryRun: boolean;
  chatEnabled: boolean;
  adminDataEnabled: boolean;
  adminIntentsEnabled: AdminChatIntent[];
  adminSnapshotRefreshEnabled: boolean;
  adminPilotUids: string[];
  adminReadAuditRetentionDays: number;
  token: string;
  webhookSecret: string;
  linkCodePepper: string;
  chatHashSecret: string;
  appUrl: string;
  requestTimeoutMs: number;
};

function readBooleanEnv(name: string): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false`);
}

function readRequestTimeoutMs(): number {
  const value = process.env.ZALO_BOT_REQUEST_TIMEOUT_MS;
  if (!value) return 10_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 60_000) {
    throw new Error('ZALO_BOT_REQUEST_TIMEOUT_MS must be an integer between 1000 and 60000');
  }
  return parsed;
}

function parseAdminIntents(raw: string | undefined): AdminChatIntent[] {
  if (!raw || !raw.trim()) return [];
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const result: AdminChatIntent[] = [];
  for (const part of parts) {
    if (!(ADMIN_CHAT_INTENTS as readonly string[]).includes(part)) {
      throw new Error(`Invalid intent capability in ZALO_BOT_ADMIN_INTENTS_ENABLED: "${part}"`);
    }
    if (!result.includes(part as AdminChatIntent)) {
      result.push(part as AdminChatIntent);
    }
  }
  return result;
}

function parsePilotUids(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readAdminReadAuditRetentionDays(adminDataEnabled: boolean): number {
  const value = process.env.ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS;
  if (!value || !value.trim()) {
    if (adminDataEnabled) {
      throw new Error(
        'ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS is required when ZALO_BOT_ADMIN_DATA_ENABLED is true'
      );
    }
    return 90;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 30 || parsed > 365) {
    throw new Error(
      'ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS must be an integer between 30 and 365'
    );
  }
  return parsed;
}

function serviceUnavailable(message: string): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 503;
  return error;
}

export function loadZaloBotConfig(): ZaloBotConfig {
  const enabled = readBooleanEnv('ZALO_BOT_ENABLED');
  const dailyDigestEnabled = readBooleanEnv('ZALO_BOT_DAILY_DIGEST_ENABLED');
  const dryRun = readBooleanEnv('ZALO_BOT_DRY_RUN');
  const chatEnabled = readBooleanEnv('ZALO_BOT_CHAT_ENABLED');
  const adminDataEnabled = readBooleanEnv('ZALO_BOT_ADMIN_DATA_ENABLED');
  const adminSnapshotRefreshEnabled = readBooleanEnv('ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED');

  const adminIntentsEnabled = parseAdminIntents(process.env.ZALO_BOT_ADMIN_INTENTS_ENABLED);
  const adminPilotUids = parsePilotUids(process.env.ZALO_BOT_ADMIN_PILOT_UIDS);
  const adminReadAuditRetentionDays = readAdminReadAuditRetentionDays(adminDataEnabled);

  const token = process.env.ZALO_BOT_TOKEN || '';
  const webhookSecret = process.env.ZALO_BOT_WEBHOOK_SECRET || '';
  const linkCodePepper = process.env.ZALO_BOT_LINK_CODE_PEPPER || '';
  const chatHashSecret = process.env.ZALO_BOT_CHAT_HASH_SECRET || '';

  const appUrlRaw = process.env.APP_URL || 'https://vps.thienuy.edu.vn';
  const appUrl = appUrlRaw.endsWith('/') ? appUrlRaw.slice(0, -1) : appUrlRaw;
  const requestTimeoutMs = readRequestTimeoutMs();

  if (enabled) {
    if (!token) throw new Error('Missing ZALO_BOT_TOKEN');
    if (!webhookSecret) throw new Error('Missing ZALO_BOT_WEBHOOK_SECRET');
    if (webhookSecret.length < 8 || webhookSecret.length > 256) {
      throw new Error('ZALO_BOT_WEBHOOK_SECRET must be between 8 and 256 characters');
    }
    if (!linkCodePepper) throw new Error('Missing ZALO_BOT_LINK_CODE_PEPPER');
    if (!chatHashSecret) throw new Error('Missing ZALO_BOT_CHAT_HASH_SECRET');
    if (chatEnabled && !process.env.GEMINI_API_KEY) {
      throw serviceUnavailable('Missing GEMINI_API_KEY');
    }
  }

  if (adminDataEnabled) {
    if (!chatHashSecret || chatHashSecret.length < 16) {
      throw serviceUnavailable(
        'ZALO_BOT_CHAT_HASH_SECRET of at least 16 characters is required for admin read audit HMAC'
      );
    }
    if (!process.env.GEMINI_API_KEY) {
      throw serviceUnavailable('Missing GEMINI_API_KEY for Zalo admin data assistant');
    }
  }

  return {
    enabled,
    dailyDigestEnabled,
    dryRun,
    chatEnabled,
    adminDataEnabled,
    adminIntentsEnabled,
    adminSnapshotRefreshEnabled,
    adminPilotUids,
    adminReadAuditRetentionDays,
    token,
    webhookSecret,
    linkCodePepper,
    chatHashSecret,
    appUrl,
    requestTimeoutMs,
  };
}
