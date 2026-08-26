import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CollectorConfig } from '../server/config.js';
import { hubInfoSchema, systemRecordSchema, systemStatsListSchema, systemdServicesListSchema } from '../server/beszel/contracts.js';
import type { BeszelRawSnapshot } from '../server/beszel/client.js';
import { smokeBeszelContract } from './smoke-beszel.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../server/beszel/fixtures/${name}.json`, import.meta.url), 'utf8'));
const raw = (): BeszelRawSnapshot => ({
  hub: hubInfoSchema.parse(fixture('info')),
  system: systemRecordSchema.parse(fixture('system')),
  stats: systemStatsListSchema.parse(fixture('system-stats')).items[0],
  services: systemdServicesListSchema.parse(fixture('systemd-services')),
});
const config: CollectorConfig = {
  nodeEnv: 'test', dbPath: '/tmp/ops.sqlite', appUrl: 'http://127.0.0.1:3000', postgresUrl: 'postgres://unused',
  pm2PidPath: '/tmp/pm2.pid', pm2ErrorLogPath: '/tmp/pm2.log', cronLogPath: '/tmp/cron.log', backupDir: '/tmp/backups',
  zaloBotToken: 'unused', recipientIds: [], zaloRecipientKey: Buffer.alloc(32), zaloTimeoutMs: 5000,
  beszel: { enabled: true, baseUrl: 'http://127.0.0.1:8090', username: 'ops-telemetry@thienuy.invalid', passwordFile: '/tmp/password', systemId: 'abc123def456ghi', timeoutMs: 5000 },
};

describe('Beszel contract smoke', () => {
  it('returns only safe aggregate fields', async () => {
    const snapshot = raw();
    snapshot.stats = { ...snapshot.stats, created: '2026-08-24 02:40:45.000Z' };
    const result = await smokeBeszelContract(config, { readSnapshot: async () => snapshot }, new Date('2026-08-24T02:41:00.000Z'));
    expect(result).toEqual({ hubVersion: '0.18.8', systemStatus: 'up', agentVersion: '0.18.8', metricAgeSeconds: 15, serviceCount: 2 });
    const output = JSON.stringify(result);
    expect(output).not.toMatch(/abc123def456ghi|ops-telemetry|fixture-token|fixture-public-key|private-sensor|host|name|key|token|password|services|stats/i);
    expect(Object.keys(result)).toEqual(['hubVersion', 'systemStatus', 'agentVersion', 'metricAgeSeconds', 'serviceCount']);
  });

  it('rejects disabled config without reading or printing credentials', async () => {
    await expect(smokeBeszelContract({ ...config, beszel: { enabled: false } })).rejects.toThrow('beszel_smoke_requires_enabled_config');
  });

  it('keeps adapter errors bounded for stale or invalid snapshots', async () => {
    const stale = raw();
    stale.stats = { ...stale.stats, created: '2026-08-24T02:35:00.000Z' };
    await expect(smokeBeszelContract(config, { readSnapshot: async () => stale }, new Date('2026-08-24T02:41:00.000Z'))).rejects.toThrow('beszel_metric_stale');
  });
});
