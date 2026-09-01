import { describe, expect, it } from 'vitest';

import type {
  AgentCapabilitiesResponse,
  InventoryReadResponse
} from '../../../../packages/config-contracts/src/agentProtocol.js';

import { smokeConfigAgent, type ConfigAgentSmokeDependencies } from './smoke-config-agent.js';

const expectations = {
  manifestVersion: '2026-09-01',
  catalogVersion: '2026-08-31',
  catalogDigest: `sha256:${'b'.repeat(64)}`
};

const capabilities: AgentCapabilitiesResponse = {
  protocolVersion: 1,
  readOnly: true,
  supportedOperations: ['inventory.read'],
  supportedStrategies: [],
  manifestVersion: '2026-09-01',
  catalogVersion: '2026-08-31',
  catalogDigest: `sha256:${'b'.repeat(64)}`,
  maximumFrameBytes: 1_048_576
};

const inventory: InventoryReadResponse = {
  catalogVersion: '2026-08-31',
  manifestVersion: '2026-09-01',
  generatedAt: '2026-09-01T06:30:00.000Z',
  items: [
    {
      catalogId: 'ops.database_url',
      name: 'OPS_DATABASE_URL_REFERENCE',
      value: 'must-never-appear-in-smoke-output',
      appId: 'ops',
      appName: 'Ops Console',
      functionIds: ['database'],
      sourceId: 'ops.api_env',
      sourcePathLabel: '/etc/edutrack-ops/api.env',
      sourceAdapter: 'systemd_environment_file',
      consumerIds: ['ops.api'],
      category: 'database',
      description: 'Credential reference for the Ops database.',
      sensitivity: 'secret',
      requirement: 'required',
      mutability: 'managed',
      applyStrategy: 'runtime_restart',
      relatedDefinitionIds: [],
      precedence: { precedenceId: 'ops.runtime_env', rank: 200, effective: true },
      sourceFingerprint: `hmac-sha256:v1:${'3'.repeat(64)}`,
      valueFingerprint: `hmac-sha256:v1:${'4'.repeat(64)}`
    },
    {
      name: 'OPS_SESSION_PEPPER',
      value: 'another-value-that-must-not-appear',
      appId: 'ops',
      appName: 'Ops Console',
      functionIds: [],
      sourceId: 'ops.credentials.ops_session_pepper',
      sourcePathLabel: '/etc/edutrack-ops/credentials/ops-session-pepper',
      sourceAdapter: 'systemd_credential_file',
      consumerIds: ['ops.api'],
      category: 'auth_security',
      description: 'Session pepper.',
      sensitivity: 'secret',
      requirement: 'unknown',
      mutability: 'observed',
      applyStrategy: 'credential_restart',
      relatedDefinitionIds: [],
      precedence: { precedenceId: 'ops.runtime_env', rank: 400, effective: true },
      sourceFingerprint: `hmac-sha256:v1:${'5'.repeat(64)}`,
      valueFingerprint: `hmac-sha256:v1:${'6'.repeat(64)}`
    }
  ]
};

function dependencies(calls: string[]): ConfigAgentSmokeDependencies {
  return {
    loadExpectations: async () => expectations,
    createClient: async (socketPath) => {
      calls.push(`create:${socketPath}`);
      return {
        negotiate: async (expected) => {
          calls.push(`negotiate:${expected.manifestVersion}`);
          return capabilities;
        },
        readInventory: async () => {
          calls.push('inventory.read');
          return inventory;
        }
      };
    }
  };
}

describe('smokeConfigAgent', () => {
  it('reports only negotiated read-only capability metadata', async () => {
    const calls: string[] = [];

    await expect(
      smokeConfigAgent(
        ['agent.capabilities', '--socket', '/run/edutrack-config-agent/agent.sock'],
        dependencies(calls)
      )
    ).resolves.toEqual({
      operation: 'agent.capabilities',
      protocolVersion: 1,
      readOnly: true,
      manifestVersion: '2026-09-01',
      catalogVersion: '2026-08-31',
      catalogDigest: `sha256:${'b'.repeat(64)}`,
      supportedOperations: ['inventory.read'],
      supportedStrategies: [],
      maximumFrameBytes: 1_048_576
    });
    expect(calls).toEqual(['create:/run/edutrack-config-agent/agent.sock', 'negotiate:2026-09-01']);
  });

  it('negotiates before reading inventory and emits only counts and sorted source IDs', async () => {
    const calls: string[] = [];
    const result = await smokeConfigAgent(
      ['inventory.read', '--socket', '/run/edutrack-config-agent/agent.sock', '--ids-only'],
      dependencies(calls)
    );

    expect(result).toEqual({
      operation: 'inventory.read',
      catalogVersion: '2026-08-31',
      manifestVersion: '2026-09-01',
      itemCount: 2,
      sourceIds: ['ops.api_env', 'ops.credentials.ops_session_pepper']
    });
    expect(JSON.stringify(result)).not.toContain('must-never-appear-in-smoke-output');
    expect(JSON.stringify(result)).not.toContain('another-value-that-must-not-appear');
    expect(calls).toEqual([
      'create:/run/edutrack-config-agent/agent.sock',
      'negotiate:2026-09-01',
      'inventory.read'
    ]);
  });

  it('rejects unbounded output modes and invalid socket arguments', async () => {
    const inputCases = [
      ['inventory.read', '--socket', '/run/agent.sock'],
      ['agent.capabilities', '--socket', 'relative.sock'],
      ['unknown', '--socket', '/run/agent.sock']
    ];

    for (const input of inputCases) {
      await expect(smokeConfigAgent(input, dependencies([]))).rejects.toThrow(
        'CONFIG_AGENT_SMOKE_USAGE'
      );
    }
  });
});
