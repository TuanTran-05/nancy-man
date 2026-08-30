import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BESZEL_CONTRACT_VERSION,
  authResponseSchema,
  hubInfoSchema,
  systemRecordSchema,
  systemStatsListSchema,
  systemdServicesListSchema
} from './contracts.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('Beszel v0.18.8 contract', () => {
  it('pins the runtime and strips fields outside the public contract', () => {
    expect(BESZEL_CONTRACT_VERSION).toBe('0.18.8');
    expect(hubInfoSchema.parse(fixture('info'))).toEqual({ v: '0.18.8', cu: false });
    expect(authResponseSchema.parse(fixture('auth')).record).toEqual({
      id: 'telemetryuser01',
      email: 'ops-telemetry@thienuy.invalid',
      role: 'readonly'
    });
    expect(systemRecordSchema.parse(fixture('system'))).not.toHaveProperty('host');
    expect(systemStatsListSchema.parse(fixture('system-stats')).items[0]).not.toHaveProperty(
      'unknownField'
    );
    expect(
      systemdServicesListSchema.parse(fixture('systemd-services')).items[0]
    ).not.toHaveProperty('cpuPeak');
  });

  it('rejects a different Hub version and out-of-range service enums', () => {
    expect(() => hubInfoSchema.parse({ v: '0.19.0', cu: false })).toThrow();
    expect(() =>
      systemdServicesListSchema.parse({
        ...(fixture('systemd-services') as object),
        items: [{ name: 'nginx', state: 7, sub: 1, cpu: 0, memory: 1, updated: 1 }]
      })
    ).toThrow();
  });

  it('keeps optional metric arrays nullable rather than inventing values', () => {
    const parsed = systemStatsListSchema.parse({
      ...(fixture('system-stats') as object),
      items: [
        {
          created: '2026-08-24 00:00:45.000Z',
          stats: { cpu: 1, m: 1, mu: 1, mp: 1, mb: 0, s: 0, su: 0, d: 1, du: 1, dp: 1 }
        }
      ]
    });
    expect(parsed.items[0].stats.b).toBeUndefined();
    expect(parsed.items[0].stats.cpub).toBeUndefined();
  });
});
