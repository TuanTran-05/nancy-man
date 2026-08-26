import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BeszelClientError, type BeszelRawSnapshot } from './client.js';
import { hubInfoSchema, systemRecordSchema, systemStatsListSchema, systemdServicesListSchema } from './contracts.js';
import { createBeszelProbe } from './probe.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const makeRaw = (now = '2026-08-24T02:41:00.000Z'): BeszelRawSnapshot => ({
  hub: hubInfoSchema.parse(fixture('info')),
  system: systemRecordSchema.parse(fixture('system')),
  stats: systemStatsListSchema.parse({
    ...(fixture('system-stats') as object),
    items: [{ ...(systemStatsListSchema.parse(fixture('system-stats')).items[0]), created: new Date(Date.parse(now) - 10_000).toISOString() }],
  }).items[0],
  services: systemdServicesListSchema.parse({
    ...(fixture('systemd-services') as object),
    items: systemdServicesListSchema.parse(fixture('systemd-services')).items.map((item) => ({ ...item, updated: Date.parse(now) - 10_000 })),
  }),
});

describe('Beszel probe', () => {
  it('returns the three normalized monitors with safe details on success', async () => {
    const now = new Date('2026-08-24T02:41:00.000Z');
    const samples = await createBeszelProbe({ readSnapshot: async () => makeRaw(now.toISOString()) })(now);
    expect(samples.map(({ monitor }) => monitor)).toEqual(['beszel', 'host_resources', 'host_services']);
    expect(samples[0]).toMatchObject({ level: 'healthy', errorCode: null, details: { probeOk: true, hubVersion: '0.18.8', systemStatus: 'up' } });
    expect(samples[1].details).not.toHaveProperty('host');
    expect(samples[2].details).toMatchObject({ matchedTotal: 2, failedServices: ['postgresql'] });
  });

  it('returns only a bounded failure sample for every adapter error', async () => {
    const codes = ['beszel_auth_failed', 'beszel_timeout', 'beszel_unreachable', 'beszel_http_error', 'beszel_invalid_json', 'beszel_contract_invalid', 'beszel_no_stats'] as const;
    for (const code of codes) {
      const samples = await createBeszelProbe({ readSnapshot: async () => { throw new BeszelClientError(code); } })(new Date('2026-08-24T02:41:00.000Z'));
      expect(samples).toEqual([expect.objectContaining({ monitor: 'beszel', level: 'critical', errorCode: code, details: { probeOk: false } })]);
    }
  });

  it('does not publish stale or down system metrics as current samples', async () => {
    const now = new Date('2026-08-24T02:41:00.000Z');
    const down = makeRaw(now.toISOString());
    down.system = { ...down.system, status: 'down' };
    expect(await createBeszelProbe({ readSnapshot: async () => down })(now)).toEqual([expect.objectContaining({ errorCode: 'beszel_agent_down' })]);
    const stale = makeRaw(new Date(now.getTime() - 181_000).toISOString());
    expect(await createBeszelProbe({ readSnapshot: async () => stale })(now)).toEqual([expect.objectContaining({ errorCode: 'beszel_metric_stale' })]);
  });
});
