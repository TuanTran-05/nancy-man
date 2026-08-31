import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  createEnvelopeKey,
  type EnvelopeKey
} from '../crypto/encryptedEnvelope.js';
import { DraftStore } from './draftStore.js';
import { createFingerprintKey, fingerprintSource } from '../inventory/fingerprint.js';
import {
  createValidationService,
  ValidationServiceError,
  type ValidationSourceRead
} from './validationService.js';
import type { Catalog, AgentManifest } from '../../../../packages/config-contracts/src/index.js';

const sourceBytes = Buffer.from('# keep\nPORT="3000"\nOPTIONAL=old\n');
const fingerprintKey = createFingerprintKey('validation-fingerprint-key', 'v1');
const stagingKey: EnvelopeKey = createEnvelopeKey({
  purpose: 'staging',
  keyId: 'staging-key',
  keyVersion: 'v1',
  bytes: Buffer.alloc(32, 7)
});

const catalog: Catalog = {
  catalogVersion: '2026-08-31',
  apps: [{ id: 'edutrack', displayName: 'EduTrack', runtimeVariableCount: 2 }],
  entries: [
    {
      id: 'edutrack.port',
      name: 'PORT',
      appId: 'edutrack',
      sourceId: 'edutrack.shared_env',
      consumerIds: ['edutrack.web'],
      category: 'runtime_networking',
      description: 'HTTP port',
      sensitivity: 'internal',
      requirement: 'required',
      mutability: 'managed',
      applyStrategy: 'runtime_restart',
      validatorId: 'port',
      precedenceId: 'edutrack.shared_env',
      buildAllowed: false
    },
    {
      id: 'edutrack.optional',
      name: 'OPTIONAL',
      appId: 'edutrack',
      sourceId: 'edutrack.shared_env',
      consumerIds: ['edutrack.web'],
      category: 'feature_flags',
      description: 'Optional feature',
      sensitivity: 'internal',
      requirement: 'optional',
      mutability: 'managed',
      applyStrategy: 'runtime_restart',
      precedenceId: 'edutrack.shared_env',
      buildAllowed: false
    }
  ],
  validators: [
    { id: 'port', type: 'integer', minimum: 1, maximum: 65535 }
  ],
  consumers: [{ id: 'edutrack.web', appId: 'edutrack', kind: 'service', displayName: 'Web' }],
  precedences: [
    {
      id: 'edutrack.shared_env',
      rank: 10,
      scope: 'runtime',
      description: 'Shared runtime environment'
    }
  ]
};

const manifest: AgentManifest = {
  manifestVersion: '2026-08-31',
  catalogVersion: '2026-08-31',
  catalogDigest: `sha256:${'a'.repeat(64)}`,
  readOnly: true,
  apps: [{ id: 'edutrack', displayName: 'EduTrack', sourceIds: ['edutrack.shared_env'] }],
  sources: [
    {
      id: 'edutrack.shared_env',
      appId: 'edutrack',
      pathLabel: 'EduTrack shared environment',
      adapterId: 'node_env_file',
      mutability: 'catalog_controlled',
      locator: { kind: 'file', path: '/srv/edutrack/shared/.env' },
      owner: 'deploy',
      group: 'deploy',
      mode: '0640',
      maximumBytes: 1_048_576,
      precedenceRank: 10,
      consumerIds: ['edutrack.web'],
      actionIds: ['pm2.reload_app'],
      checkIds: ['process.active']
    }
  ],
  actions: [{ id: 'pm2.reload_app', description: 'Reload the app' }],
  checks: [{ id: 'process.active', description: 'Process is stable' }]
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    changeId: 'CHG_VALIDATION_1',
    appId: 'edutrack',
    reason: 'rotate test setting',
    catalogVersion: '2026-08-31',
    manifestVersion: '2026-08-31',
    replaceDraft: true,
    items: [
      {
        appId: 'edutrack',
        sourceId: 'edutrack.shared_env',
        catalogId: 'edutrack.port',
        name: 'PORT',
        operation: 'set' as const,
        requirement: 'required' as const,
        mutability: 'managed' as const,
        strategy: 'runtime_restart' as const,
        sourceFingerprint: fingerprintSource(fingerprintKey, 'edutrack.shared_env', sourceBytes),
        value: '3001'
      }
    ],
    ...overrides
  };
}

function sourceRead(): ValidationSourceRead {
  return { bytes: Buffer.from(sourceBytes), metadata: { uid: 1, gid: 1, mode: 0o640, nlink: 1, dev: 1, ino: 1, size: sourceBytes.length, mtimeMs: 0 } };
}

function service(overrides: Partial<Parameters<typeof createValidationService>[0]> = {}) {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'edutrack-validation-'));
  const draftStore = new DraftStore({ stateDirectory, stagingKey });
  return createValidationService({
    catalog,
    manifest,
    fingerprintKey,
    draftStore,
    readSource: async () => sourceRead(),
    ...overrides
  });
}

describe('config-agent validation service', () => {
  test('validates from catalog and manifest and stores values only in encrypted draft storage', async () => {
    const result = await service().validate(request());

    expect(result.state).toBe('READY');
    expect(result.impactPlan).toMatchObject({
      applicationId: 'edutrack',
      strategies: ['runtime_restart'],
      sourceIds: ['edutrack.shared_env'],
      actionIds: ['pm2.reload_app'],
      checkIds: ['process.active']
    });
    expect(JSON.stringify(result)).not.toContain('3001');
  });

  test('rejects a changed source fingerprint without a force path', async () => {
    const changed = Buffer.from('# keep\nPORT="3002"\nOPTIONAL=old\n');
    const agent = service({ readSource: async () => ({ ...sourceRead(), bytes: changed }) });

    await expect(agent.validate(request())).rejects.toMatchObject({
      code: 'CONFIG_SOURCE_CHANGED'
    });
  });

  test('rejects forged catalog metadata, required deletes, and invalid catalog values', async () => {
    await expect(
      service().validate(request({ items: [{ ...request().items[0], requirement: 'optional' }] }))
    ).rejects.toMatchObject({ code: 'CATALOG_METADATA_MISMATCH' });

    await expect(
      service().validate(
        request({ items: [{ ...request().items[0], operation: 'delete', value: undefined }] })
      )
    ).rejects.toMatchObject({ code: 'REQUIRED_DELETE' });

    await expect(
      service().validate(request({ items: [{ ...request().items[0], value: '70000' }] }))
    ).rejects.toMatchObject({ code: 'VARIABLE_RULE_FAILED' });
  });

  test('rejects unknown/observed definitions and ambiguous duplicate occurrences', async () => {
    await expect(
      service().validate(
        request({
          items: [
            {
              ...request().items[0],
              catalogId: 'edutrack.missing',
              name: 'MISSING'
            }
          ]
        })
      )
    ).rejects.toBeInstanceOf(ValidationServiceError);

    const duplicate = Buffer.from('PORT=3000\nPORT=3001\n');
    await expect(
      service({ readSource: async () => ({ ...sourceRead(), bytes: duplicate }) }).validate(
        request({
          items: [{ ...request().items[0], value: '3002', sourceFingerprint: fingerprintSource(fingerprintKey, 'edutrack.shared_env', duplicate) }]
        })
      )
    ).rejects.toMatchObject({ code: 'DUPLICATE_DEFINITION' });
  });
});
