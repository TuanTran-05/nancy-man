import { describe, expect, it } from 'vitest';
import { probePostgres } from './postgresProbe.js';

const now = new Date('2026-08-23T00:00:00Z');
const validSnapshot = {
  probeAt: '2026-08-23T00:00:00Z',
  databaseSizeBytes: 81000000,
  connectionStates: { active: 2, idle: 3 },
  activeCount: 2,
  waitingLockCount: 0,
  deadlocks: 0,
  rollbacks: 1,
  tempFiles: 0,
  tempBytes: 0,
  userTables: [{ table: 'students', liveTuples: 10, deadTuples: 1, lastAutovacuum: null, lastAutoanalyze: null }],
  settings: { maxConnections: 100, trackIoTiming: false, extensions: [] },
};

describe('PostgreSQL probe', () => {
  it('turns a PostgreSQL connection error into a sanitized critical sample', async () => {
    await expect(probePostgres({ postgresUrl: 'postgres://invalid', clientFactory: async () => { throw new Error('password=secret'); } }, now)).resolves.toMatchObject({ monitor: 'postgres', level: 'critical', errorCode: 'database_unreachable' });
  });

  it('runs only the fixed aggregate query and validates its exact response', async () => {
    const queries: string[] = [];
    await expect(probePostgres({
      postgresUrl: 'postgres://unused',
      clientFactory: () => ({
        query: async (sql: string) => { queries.push(sql); return { rows: [{ snapshot: validSnapshot }] }; },
        end: async () => undefined,
      }),
    }, now)).resolves.toMatchObject({ monitor: 'postgres', level: 'healthy', details: validSnapshot });
    expect(queries).toEqual(['SELECT ops_metrics.snapshot() AS snapshot']);
  });

  it('maps malformed metric responses without exposing raw database data', async () => {
    await expect(probePostgres({ postgresUrl: 'postgres://unused', clientFactory: () => ({ query: async () => ({ rows: [{ snapshot: { query: 'secret' } }] }), end: async () => undefined }) }, now)).resolves.toMatchObject({ level: 'critical', errorCode: 'database_invalid_metric', details: {} });
  });
});
