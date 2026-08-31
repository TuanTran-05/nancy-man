import { expect, test } from 'vitest';

import type { Catalog, AgentManifest } from '../../../../packages/config-contracts/src/index.js';
import { createFingerprintKey } from './fingerprint.js';
import { createInventoryService } from './inventoryService.js';

const catalog: Catalog = {
  catalogVersion: '2026-08-31',
  apps: [{ id: 'edutrack', displayName: 'EduTrack Platform', runtimeVariableCount: 3 }],
  entries: [
    {
      id: 'edutrack.database_url',
      name: 'DATABASE_URL',
      appId: 'edutrack',
      sourceId: 'edutrack.shared_env',
      consumerIds: ['edutrack.web'],
      category: 'database',
      description: 'Primary PostgreSQL connection.',
      sensitivity: 'secret',
      requirement: 'required',
      mutability: 'managed',
      applyStrategy: 'runtime_restart',
      validatorId: 'non_empty',
      precedenceId: 'edutrack.shared_env_runtime',
      buildAllowed: false
    },
    {
      id: 'edutrack.pm2_port',
      name: 'PORT',
      appId: 'edutrack',
      sourceId: 'edutrack.pm2_ecosystem',
      consumerIds: ['edutrack.web'],
      category: 'runtime_networking',
      description: 'PM2 runtime port override.',
      sensitivity: 'internal',
      requirement: 'required',
      mutability: 'observed',
      applyStrategy: 'build_redeploy',
      validatorId: 'positive_integer',
      precedenceId: 'edutrack.pm2_runtime',
      buildAllowed: false
    }
  ],
  validators: [
    { id: 'non_empty', type: 'non_empty' },
    { id: 'positive_integer', type: 'integer', minimum: 1 }
  ],
  consumers: [
    {
      id: 'edutrack.web',
      appId: 'edutrack',
      kind: 'service',
      displayName: 'EduTrack web runtime'
    }
  ],
  precedences: [
    {
      id: 'edutrack.shared_env_runtime',
      rank: 200,
      scope: 'runtime',
      description: 'Shared env'
    },
    {
      id: 'edutrack.pm2_runtime',
      rank: 300,
      scope: 'runtime',
      description: 'PM2 override'
    }
  ]
};

const manifest: AgentManifest = {
  manifestVersion: '2026-08-31',
  catalogVersion: '2026-08-31',
  catalogDigest: `sha256:${'a'.repeat(64)}`,
  readOnly: true,
  apps: [
    {
      id: 'edutrack',
      displayName: 'EduTrack Platform',
      sourceIds: ['edutrack.shared_env', 'edutrack.pm2_ecosystem']
    }
  ],
  sources: [
    {
      id: 'edutrack.shared_env',
      appId: 'edutrack',
      pathLabel: '/tmp/shared.env',
      adapterId: 'node_env_file',
      mutability: 'catalog_controlled',
      locator: { kind: 'file', path: '/tmp/shared.env' },
      owner: 'deploy',
      group: 'deploy',
      mode: '0644',
      maximumBytes: 1024,
      precedenceRank: 200,
      consumerIds: ['edutrack.web']
    },
    {
      id: 'edutrack.pm2_ecosystem',
      appId: 'edutrack',
      pathLabel: '/tmp/ecosystem.config.cjs',
      adapterId: 'pm2_ecosystem_static',
      mutability: 'observed',
      locator: {
        kind: 'file',
        path: '/tmp/ecosystem.config.cjs'
      },
      owner: 'deploy',
      group: 'deploy',
      mode: '0644',
      maximumBytes: 2048,
      precedenceRank: 300,
      consumerIds: ['edutrack.web']
    }
  ],
  actions: [],
  checks: []
};

test('inventory preserves duplicates, marks PM2 precedence, and emits explicit unknown records', async () => {
  const sources = new Map([
    [
      'edutrack.shared_env',
      Buffer.from('DATABASE_URL=postgres://shared\nPORT=3000\nNEW_VENDOR_FLAG=sentinel\n', 'utf8')
    ],
    [
      'edutrack.pm2_ecosystem',
      Buffer.from("module.exports = { apps: [{ name: 'web', env: { PORT: 3100 } }] };\n", 'utf8')
    ]
  ]);
  const service = createInventoryService({
    catalog,
    manifest,
    fingerprintKey: createFingerprintKey('fingerprint-key', 'v1'),
    readSource: (source) => ({
      bytes: sources.get(source.id) ?? Buffer.alloc(0),
      metadata: {
        dev: 1,
        ino: source.id === 'edutrack.shared_env' ? 1 : 2,
        uid: 1000,
        gid: 1000,
        mode: 0o644,
        nlink: 1,
        size: sources.get(source.id)?.byteLength ?? 0,
        mtimeMs: Date.parse('2026-08-31T13:00:00.000Z')
      }
    })
  });

  const response = await service.read({ includeValues: true });
  const database = response.items.find((item) => item.name === 'DATABASE_URL');
  const ports = response.items.filter((item) => item.name === 'PORT');
  const unknown = response.items.find((item) => item.name === 'NEW_VENDOR_FLAG');

  expect(database).toMatchObject({
    catalogId: 'edutrack.database_url',
    requirement: 'required',
    mutability: 'managed'
  });
  expect(unknown).toMatchObject({ requirement: 'unknown', mutability: 'observed' });
  expect(ports).toHaveLength(2);
  expect(ports.find((item) => item.sourceId === 'edutrack.pm2_ecosystem')).toMatchObject({
    catalogId: 'edutrack.pm2_port',
    value: '3100',
    precedence: { effective: true }
  });
  expect(ports.find((item) => item.sourceId === 'edutrack.shared_env')).toMatchObject({
    value: '3000',
    precedence: { effective: false }
  });
  const sharedPort = ports.find((item) => item.sourceId === 'edutrack.shared_env');
  const pm2Port = ports.find((item) => item.sourceId === 'edutrack.pm2_ecosystem');
  expect(sharedPort?.relatedDefinitionIds).toEqual(['edutrack.pm2_port']);
  expect(pm2Port?.relatedDefinitionIds).toEqual(['edutrack.edutrack.shared_env.port']);
  expect(sharedPort?.relatedDefinitionIds).not.toContain('edutrack.edutrack.shared_env.port');
  expect(pm2Port?.relatedDefinitionIds).not.toContain('edutrack.pm2_port');
  expect(ports[0]?.sourceFingerprint).toMatch(/^hmac-sha256:v1:/u);
  expect(ports[0]?.valueFingerprint).toMatch(/^hmac-sha256:v1:/u);
});
