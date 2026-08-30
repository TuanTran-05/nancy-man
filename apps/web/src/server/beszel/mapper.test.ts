import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  systemRecordSchema,
  systemStatsListSchema,
  systemdServicesListSchema,
  hubInfoSchema
} from './contracts.js';
import { normalizeBeszelSnapshot } from './mapper.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const raw = () => ({
  hub: hubInfoSchema.parse(fixture('info')),
  system: systemRecordSchema.parse(fixture('system')),
  stats: systemStatsListSchema.parse(fixture('system-stats')).items[0],
  services: systemdServicesListSchema.parse(fixture('systemd-services'))
});

describe('Beszel telemetry normalization', () => {
  it('maps v0.18.8 units and retains only the approved service projection', () => {
    const result = normalizeBeszelSnapshot(raw(), new Date('2026-08-24T02:41:00.000Z'));
    expect(result.resources).toMatchObject({
      cpuPercent: 42.5,
      cpuUserPercent: 20,
      cpuSystemPercent: 10,
      cpuIoWaitPercent: 2,
      memoryTotalBytes: 8 * 1024 ** 3,
      memoryUsedBytes: 4 * 1024 ** 3,
      swapTotalBytes: 2 * 1024 ** 3,
      swapUsedBytes: 0.5 * 1024 ** 3,
      swapPercent: 25,
      diskReadBytesPerSecond: 1048576,
      diskWriteBytesPerSecond: 2097152,
      diskIoUtilizationPercent: 3,
      networkTransmitBytesPerSecond: 4096,
      networkReceiveBytesPerSecond: 8192,
      load1: 1.2,
      load5: 0.8,
      load15: 0.4,
      cpuThreads: 4
    });
    expect(result.services.map(({ name }) => name)).toEqual(['postgresql', 'nginx']);
    expect(result.services[0]).toMatchObject({ state: 'failed', subState: 'failed' });
    expect(JSON.stringify(result)).not.toMatch(/private-sensor|must-be-stripped|restart/i);
  });

  it('uses null for missing optional arrays and rejects invalid/future metric timestamps', () => {
    const value = raw();
    value.stats = systemStatsListSchema.parse({
      page: 1,
      perPage: 1,
      totalPages: 1,
      totalItems: 1,
      items: [
        {
          created: '2026-08-24T02:40:45.000Z',
          stats: { cpu: 1, m: 1, mu: 1, mp: 1, mb: 0, s: 0, su: 0, d: 1, du: 1, dp: 1 }
        }
      ]
    }).items[0];
    const normalized = normalizeBeszelSnapshot(value, new Date('2026-08-24T02:41:00.000Z'));
    expect(normalized.resources).toMatchObject({
      cpuUserPercent: null,
      load1: null,
      networkReceiveBytesPerSecond: null,
      diskReadBytesPerSecond: null,
      swapPercent: null
    });

    const future = raw();
    future.stats = { ...future.stats, created: '2026-08-24T02:42:00.000Z' };
    expect(() => normalizeBeszelSnapshot(future, new Date('2026-08-24T02:41:00.000Z'))).toThrow(
      'beszel_contract_invalid'
    );
  });

  it('keeps service records within Beszel’s ten-minute refresh interval', () => {
    const value = raw();
    value.services = {
      ...value.services,
      items: value.services.items.map((item) => ({ ...item, updated: 1787538900000 }))
    };
    const normalized = normalizeBeszelSnapshot(value, new Date('2026-08-24T02:41:00.000Z'));
    expect(normalized.services.map(({ name }) => name)).toEqual(['postgresql', 'nginx']);
  });

  it('drops stale services, sorts failed first and caps the display list', () => {
    const value = raw();
    value.services = {
      ...value.services,
      totalItems: 3,
      items: value.services.items.map((item, index) => ({
        ...item,
        name: index === 0 ? 'nginx' : index === 1 ? 'postgresql' : 'unapproved-unit',
        updated: index === 2 ? 1787530000000 : 1787539245000
      }))
    };
    const normalized = normalizeBeszelSnapshot(value, new Date('2026-08-24T02:41:00.000Z'));
    expect(normalized.services.map(({ name }) => name)).toEqual(['postgresql', 'nginx']);

    const tooShort = {
      ...raw(),
      services: { ...raw().services, items: raw().services.items.slice(0, 2) }
    };
    expect(() => normalizeBeszelSnapshot(tooShort, new Date('2026-08-24T02:41:00.000Z'))).toThrow(
      'beszel_contract_invalid'
    );
  });
});
