import { describe, expect, it } from 'vitest';

import { PostgresIncidentStore } from './postgresIncidentStore.js';

describe('PostgresIncidentStore', () => {
  it('creates an incident and links only validated issue records in one statement', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const store = new PostgresIncidentStore({
      query: async <T>(sql, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        return {
          rows: [
            {
              id: 'incident-id',
              incidentKey: 'INC_AB12CD34',
              linkedIssueCount: '2'
            }
          ] as T[]
        };
      }
    });

    await expect(
      store.create({
        actorUserId: 'actor-id',
        title: 'Payments unavailable',
        severity: 'critical',
        summary: 'Investigating provider timeouts.',
        issueIds: ['issue-a', 'issue-b']
      })
    ).resolves.toEqual({ id: 'incident-id', incidentKey: 'INC_AB12CD34', linkedIssueCount: 2 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('INSERT INTO incidents');
    expect(calls[0]?.sql).toContain('INSERT INTO incident_issues');
    expect(calls[0]?.sql).toContain('JOIN error_issues');
    expect(calls[0]?.parameters).toContain('actor-id');
    expect(calls[0]?.parameters).toContainEqual(['issue-a', 'issue-b']);
  });

  it('updates only valid incident status transitions and records their timestamps', async () => {
    const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const store = new PostgresIncidentStore({
      query: async <T>(sql, parameters: readonly unknown[] = []) => {
        calls.push({ sql, parameters });
        return { rows: [{ id: 'incident-id' }] as T[] };
      }
    });

    await expect(
      store.updateStatus({ incidentId: 'incident-id', status: 'resolved' })
    ).resolves.toBe(true);

    expect(calls[0]?.sql).toContain("WHEN $2 = 'mitigated'");
    expect(calls[0]?.sql).toContain("WHEN $2 = 'resolved'");
  });
});
