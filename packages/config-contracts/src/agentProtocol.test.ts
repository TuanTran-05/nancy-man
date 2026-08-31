import { describe, expect, it } from 'vitest';

import {
  AgentCapabilitiesResponseSchema,
  AgentRequestSchema,
  AgentResponseSchema,
  InventoryReadRequestSchema,
  InventoryReadResponseSchema
} from './agentProtocol.js';

const actor = {
  userId: '8e57ab35-bf02-4f83-b29c-864fb6044b7d',
  sessionId: 'db51f369-03f5-4db1-bfc7-b6fcb70d59f7',
  role: 'ops_owner',
  ipHash: `sha256:${'1'.repeat(64)}`,
  userAgentHash: `sha256:${'2'.repeat(64)}`
} as const;

const inventoryItem = {
  catalogId: 'edutrack.database_url',
  name: 'DATABASE_URL',
  value: 'postgres://primary.internal/edutrack',
  appId: 'edutrack-platform',
  appName: 'EduTrack Platform',
  functionIds: ['database'],
  sourceId: 'edutrack.shared_env',
  sourcePathLabel: '/srv/edutrack/shared/.env',
  sourceAdapter: 'node_env_file',
  consumerIds: ['edutrack-web', 'scheduled-jobs'],
  category: 'database',
  description: 'Primary application PostgreSQL connection',
  sensitivity: 'secret',
  requirement: 'required',
  mutability: 'managed',
  applyStrategy: 'runtime_restart',
  relatedDefinitionIds: ['ops.api_database_url'],
  precedence: {
    precedenceId: 'node_env_file',
    rank: 200,
    effective: true
  },
  sourceFingerprint: `hmac-sha256:v1:${'3'.repeat(64)}`,
  valueFingerprint: `hmac-sha256:v1:${'4'.repeat(64)}`,
  sourceMtime: '2026-08-31T13:00:00.000Z',
  lastOpsChange: {
    actorUserId: '6b6013d7-220d-458f-ac33-08b8d8c6fd7f',
    changeId: 'CHG_20260831_001',
    changedAt: '2026-08-31T13:05:00.000Z'
  }
} as const;

describe('agent protocol schemas', () => {
  it('rejects unsupported operations and versions', () => {
    expect(() => AgentRequestSchema.parse({ version: 1, operation: 'shell.exec' })).toThrow();

    expect(() =>
      AgentRequestSchema.parse({
        version: 2,
        requestId: 'REQ_20260831_001',
        issuedAt: '2026-08-31T13:10:00.000Z',
        expiresAt: '2026-08-31T13:10:30.000Z',
        actor,
        operation: 'inventory.read',
        body: {},
        hmacKeyId: 'config-agent-2026-08-31',
        signature: `sha256:${'a'.repeat(64)}`
      })
    ).toThrow();
  });

  it('validates inventory.read request limits and rejects unknown fields', () => {
    expect(() => InventoryReadRequestSchema.parse({ includeValues: true, limit: -1 })).toThrow();
    expect(() =>
      InventoryReadRequestSchema.parse({ includeValues: true, limit: 1, unknown: true })
    ).toThrow();

    expect(
      InventoryReadRequestSchema.parse({
        includeValues: true,
        appIds: ['edutrack-platform'],
        sourceIds: ['edutrack.shared_env'],
        categoryIds: ['database'],
        variableNames: ['DATABASE_URL'],
        limit: 25
      })
    ).toMatchObject({
      includeValues: true,
      limit: 25
    });
  });

  it('accepts read-only inventory and capabilities responses', () => {
    expect(
      InventoryReadResponseSchema.parse({
        catalogVersion: '2026-08-31',
        manifestVersion: '2026-08-31',
        generatedAt: '2026-08-31T13:12:00.000Z',
        items: [inventoryItem]
      }).items[0]
    ).toMatchObject({
      catalogId: 'edutrack.database_url',
      sourceAdapter: 'node_env_file'
    });

    expect(
      AgentCapabilitiesResponseSchema.parse({
        readOnly: true,
        supportedOperations: ['inventory.read'],
        protocolVersion: 1,
        manifestVersion: '2026-08-31',
        catalogVersion: '2026-08-31',
        catalogDigest: `sha256:${'b'.repeat(64)}`,
        maximumFrameBytes: 1_048_576
      })
    ).toMatchObject({
      readOnly: true,
      supportedOperations: ['inventory.read']
    });
  });

  it('accepts strict request and response envelopes', () => {
    expect(
      AgentRequestSchema.parse({
        version: 1,
        requestId: 'REQ_20260831_001',
        issuedAt: '2026-08-31T13:10:00.000Z',
        expiresAt: '2026-08-31T13:10:30.000Z',
        actor,
        operation: 'inventory.read',
        body: {
          includeValues: true,
          limit: 25
        },
        hmacKeyId: 'config-agent-2026-08-31',
        signature: `hmac-sha256:v1:${'c'.repeat(64)}`
      })
    ).toMatchObject({
      version: 1,
      operation: 'inventory.read'
    });

    expect(
      AgentResponseSchema.parse({
        version: 1,
        requestId: 'REQ_20260831_001',
        issuedAt: '2026-08-31T13:10:01.000Z',
        expiresAt: '2026-08-31T13:10:31.000Z',
        operation: 'inventory.read',
        ok: true,
        body: {
          catalogVersion: '2026-08-31',
          manifestVersion: '2026-08-31',
          generatedAt: '2026-08-31T13:12:00.000Z',
          items: [inventoryItem]
        },
        hmacKeyId: 'config-agent-2026-08-31',
        signature: `hmac-sha256:v1:${'d'.repeat(64)}`
      })
    ).toMatchObject({
      ok: true,
      operation: 'inventory.read'
    });

    expect(() =>
      AgentResponseSchema.parse({
        version: 1,
        requestId: 'REQ_20260831_001',
        issuedAt: '2026-08-31T13:10:01.000Z',
        expiresAt: '2026-08-31T13:10:31.000Z',
        operation: 'inventory.read',
        ok: false,
        error: {
          code: 'INVENTORY_READ_FAILED',
          safeMessage: 'Inventory read failed'
        },
        body: {
          catalogVersion: '2026-08-31',
          manifestVersion: '2026-08-31',
          generatedAt: '2026-08-31T13:12:00.000Z',
          items: [inventoryItem]
        },
        hmacKeyId: 'config-agent-2026-08-31',
        signature: `hmac-sha256:v1:${'d'.repeat(64)}`
      })
    ).toThrow();
  });
});
