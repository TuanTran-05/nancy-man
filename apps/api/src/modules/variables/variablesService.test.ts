import { describe, expect, it } from 'vitest';

import { VariablesService, redactVariablesMetadata } from './variablesService.js';

const catalog = {
  catalogVersion: '2026-08-31',
  entries: [],
  validators: [],
  consumers: [],
  precedences: []
} as const;

const actor = {
  userId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
  sessionId: 'db51f369-03f5-4db1-bfc7-b6fcb70d59f7',
  role: 'ops_owner' as const,
  ipHash: `sha256:${'1'.repeat(64)}`,
  userAgentHash: `sha256:${'2'.repeat(64)}`
};

describe('VariablesService', () => {
  it('returns value-free catalog metadata without calling the agent', async () => {
    const client = {
      readInventory: async () => {
        throw new Error('must not call');
      }
    };
    const service = new VariablesService({ client, catalog });

    await expect(service.getCatalog()).resolves.toEqual(catalog);
  });

  it('passes API-created actor context to the agent and audits counts and source IDs only', async () => {
    const audit: unknown[] = [];
    const client = {
      readInventory: async () => ({
        catalogVersion: '2026-08-31',
        manifestVersion: '2026-08-31',
        generatedAt: '2026-08-31T13:12:00.000Z',
        items: [
          {
            catalogId: 'edutrack.database_url',
            name: 'DATABASE_URL',
            value: 'secret-value',
            appId: 'edutrack-platform',
            appName: 'EduTrack',
            functionIds: ['database'],
            sourceId: 'edutrack.shared_env',
            sourcePathLabel: '/srv/edutrack/shared/.env',
            sourceAdapter: 'node_env_file' as const,
            consumerIds: ['edutrack-web'],
            category: 'database' as const,
            description: 'Database',
            sensitivity: 'secret' as const,
            requirement: 'required' as const,
            mutability: 'managed' as const,
            applyStrategy: 'runtime_restart' as const,
            relatedDefinitionIds: [],
            precedence: { precedenceId: 'node_env_file', rank: 200, effective: true },
            sourceFingerprint: `hmac-sha256:v1:${'3'.repeat(64)}`,
            valueFingerprint: `hmac-sha256:v1:${'4'.repeat(64)}`
          }
        ]
      })
    };
    const service = new VariablesService({
      client,
      catalog,
      audit: {
        append: async (value) => {
          audit.push(value);
        }
      }
    });

    const result = await service.read({ actor });
    expect(result.items[0]?.value).toBe('secret-value');
    expect(audit[0]).toMatchObject({
      actorUserId: actor.userId,
      action: 'variables.inventory_read',
      subjectType: 'variables_inventory',
      metadata: {
        sessionId: actor.sessionId,
        sourceIds: ['edutrack.shared_env'],
        itemCount: 1,
        catalogVersion: '2026-08-31',
        manifestVersion: '2026-08-31',
        code: 'SUCCESS'
      }
    });
    expect(JSON.stringify(audit)).not.toContain('secret-value');
  });

  it('redacts nested variable-bearing metadata recursively', () => {
    expect(
      redactVariablesMetadata({
        value: 'secret',
        nested: { currentValue: 'secret-2', credential: { token: 'secret-3' } },
        agentResponse: { items: [{ value: 'secret-4' }] },
        count: 2
      })
    ).toEqual({
      value: '[redacted]',
      nested: { currentValue: '[redacted]', credential: '[redacted]' },
      agentResponse: '[redacted]',
      count: 2
    });
  });
});
