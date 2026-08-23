import { describe, expect, it } from 'vitest';
import { loadCollectorConfig, loadWebConfig } from './config.js';

const base = {
  NODE_ENV: 'test',
  OPS_DB_PATH: ':memory:',
  OPS_LISTEN_HOST: '127.0.0.1',
  OPS_PORT: '3101',
  OPS_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
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
      OPS_ALERT_ZALO_TIMEOUT_MS: '1000',
    };
    expect(() => loadCollectorConfig(env)).toThrow('127.0.0.1');
    expect(() => loadCollectorConfig({ ...env, OPS_APP_URL: 'http://127.0.0.1:3000' })).toThrow('between 5000');
  });
});
