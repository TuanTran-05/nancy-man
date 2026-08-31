import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCollectorConfig, loadWebConfig } from './config.js';

const base = {
  NODE_ENV: 'test',
  OPS_DB_PATH: ':memory:',
  OPS_LISTEN_HOST: '127.0.0.1',
  OPS_PORT: '3101',
  OPS_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
  OPS_ALERT_ZALO_BOT_TOKEN: 'bot-token-for-tests',
  OPS_ZALO_WEBHOOK_SECRET: 'w'.repeat(32),
  OPS_ZALO_LINK_CODE_PEPPER: 'p'.repeat(32),
  OPS_ZALO_CHAT_HASH_SECRET: 'h'.repeat(32),
  OPS_ZALO_RECIPIENT_KEY: Buffer.alloc(32, 8).toString('base64'),
  OPS_LEGACY_MONITORING_HMAC_FILE:
    '/run/credentials/edutrack-ops-web.service/ops-legacy-monitoring-hmac'
};

const collectorBase = {
  ...base,
  OPS_APP_URL: 'http://127.0.0.1:3000',
  OPS_MONITOR_DATABASE_URL: 'postgres://monitor@localhost/db',
  OPS_PM2_PID_PATH: '/run/pm2.pid',
  OPS_PM2_ERROR_LOG_PATH: '/var/log/app-error.log',
  OPS_CRON_LOG_PATH: '/var/log/cron.log',
  OPS_BACKUP_DIR: '/var/backups',
  OPS_ALERT_ZALO_RECIPIENT_UIDS: 'ops-a',
  OPS_ALERT_ZALO_TIMEOUT_MS: '5000'
};

describe('ops configuration', () => {
  it('rejects a public web listener', () =>
    expect(() => loadWebConfig({ ...base, OPS_LISTEN_HOST: '0.0.0.0' })).toThrow('127.0.0.1'));

  it('accepts a valid web config with a 32-byte key', () => {
    expect(loadWebConfig(base)).toMatchObject({ dbPath: ':memory:', port: 3101 });
  });

  it('requires monitor URL, bot token and recipients for production collector', () =>
    expect(() => loadCollectorConfig({ ...base, NODE_ENV: 'production' })).toThrow());

  it('rejects a non-loopback app URL and an invalid timeout', () => {
    const env = {
      ...base,
      OPS_APP_URL: 'http://localhost:3000',
      OPS_MONITOR_DATABASE_URL: 'postgres://monitor@localhost/db',
      OPS_PM2_PID_PATH: '/run/pm2.pid',
      OPS_PM2_ERROR_LOG_PATH: '/var/log/app-error.log',
      OPS_CRON_LOG_PATH: '/var/log/cron.log',
      OPS_BACKUP_DIR: '/var/backups',
      OPS_ALERT_ZALO_BOT_TOKEN: 'secret',
      OPS_ALERT_ZALO_RECIPIENT_UIDS: 'ops-a',
  OPS_ZALO_RECIPIENT_KEY: Buffer.alloc(32, 8).toString('base64'),
  OPS_LEGACY_MONITORING_HMAC_FILE: '/run/credentials/edutrack-ops-web.service/ops-legacy-monitoring-hmac',
      OPS_ALERT_ZALO_TIMEOUT_MS: '1000'
    };
    expect(() => loadCollectorConfig(env)).toThrow('127.0.0.1');
    expect(() => loadCollectorConfig({ ...env, OPS_APP_URL: 'http://127.0.0.1:3000' })).toThrow(
      'between 5000'
    );
  });

  it('keeps Beszel disabled without reading any credential settings', () => {
    expect(loadCollectorConfig({ ...collectorBase, OPS_BESZEL_ENABLED: 'false' }).beszel).toEqual({
      enabled: false
    });
  });

  it('validates the enabled Beszel configuration fail-closed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-beszel-config-'));
    const passwordPath = join(directory, 'password');
    const emptyPath = join(directory, 'empty');
    const symlinkPath = join(directory, 'password-link');
    writeFileSync(passwordPath, 'fixture-password\n', { mode: 0o640 });
    writeFileSync(emptyPath, ' \n', { mode: 0o640 });
    symlinkSync(passwordPath, symlinkPath);
    const enabledEnv = {
      ...collectorBase,
      OPS_BESZEL_ENABLED: 'true',
      OPS_BESZEL_URL: 'http://127.0.0.1:8090',
      OPS_BESZEL_USER: 'ops-telemetry@thienuy.invalid',
      OPS_BESZEL_PASSWORD_FILE: passwordPath,
      OPS_BESZEL_SYSTEM_ID: 'abc123def456ghi',
      OPS_BESZEL_TIMEOUT_MS: '5000'
    };
    try {
      expect(loadCollectorConfig(enabledEnv).beszel).toMatchObject({
        enabled: true,
        timeoutMs: 5000,
        systemId: 'abc123def456ghi'
      });
      expect(() =>
        loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_URL: 'http://127.0.0.1:8080' })
      ).toThrow('OPS_BESZEL_URL');
      expect(() =>
        loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_URL: 'http://127.0.0.1:8090/path' })
      ).toThrow('OPS_BESZEL_URL');
      expect(() =>
        loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_PASSWORD_FILE: symlinkPath })
      ).toThrow('regular file');
      expect(() =>
        loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_PASSWORD_FILE: emptyPath })
      ).toThrow('must not be empty');
      expect(() => loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_TIMEOUT_MS: '999' })).toThrow(
        'between 1000 and 10000'
      );
      expect(() => loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_TIMEOUT_MS: '10001' })).toThrow(
        'between 1000 and 10000'
      );
      expect(() =>
        loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_USER: 'not-an-email' })
      ).toThrow();
      expect(() => loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_SYSTEM_ID: 'ABC' })).toThrow();
      expect(() => loadCollectorConfig({ ...enabledEnv, OPS_BESZEL_ENABLED: 'yes' })).toThrow(
        'true or false'
      );
      expect(lstatSync(passwordPath).isFile()).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
