import { describe, expect, test } from 'vitest';

import {
  MAXIMUM_FRAME_BYTES,
  readConfigAgentRuntimeConfig,
  RuntimeConfigError
} from './runtimeConfig.js';

const environment = {
  OPS_CONFIG_AGENT_SOCKET_PATH: '/run/edutrack-config-agent/agent.sock',
  OPS_CONFIG_AGENT_CATALOG_PATH: '/etc/edutrack-config-agent/catalog.yaml',
  OPS_CONFIG_AGENT_MANIFEST_PATH: '/etc/edutrack-config-agent/manifest.yaml',
  OPS_CONFIG_AGENT_PROTOCOL_KEY_PATH: '/etc/edutrack-config-agent/credentials/protocol-hmac',
  OPS_CONFIG_AGENT_PROTOCOL_KEY_ID: 'config-agent-protocol-v1',
  OPS_CONFIG_AGENT_FINGERPRINT_KEY_PATH: '/etc/edutrack-config-agent/credentials/fingerprint-v1',
  OPS_CONFIG_AGENT_FINGERPRINT_KEY_VERSION: 'v1',
  OPS_CONFIG_AGENT_STAGING_KEY_PATH: '/etc/edutrack-config-agent/credentials/staging-v1',
  OPS_CONFIG_AGENT_STAGING_KEY_ID: 'config-agent-staging-2026-08-31',
  OPS_CONFIG_AGENT_STAGING_KEY_VERSION: 'v1',
  OPS_CONFIG_AGENT_STAGING_OLD_KEY_IDS:
    'config-agent-staging-2026-08-30,config-agent-staging-2026-08-29',
  OPS_CONFIG_AGENT_SNAPSHOT_KEY_PATH: '/etc/edutrack-config-agent/credentials/snapshot-v1',
  OPS_CONFIG_AGENT_SNAPSHOT_KEY_ID: 'config-agent-snapshot-2026-08-31',
  OPS_CONFIG_AGENT_SNAPSHOT_KEY_VERSION: 'v1',
  OPS_CONFIG_AGENT_SNAPSHOT_OLD_KEY_IDS: 'config-agent-snapshot-2026-08-30',
  OPS_CONFIG_AGENT_STATE_DIRECTORY: '/var/lib/edutrack-config-agent',
  OPS_CONFIG_AGENT_DRAFTS_DIRECTORY: '/var/lib/edutrack-config-agent/drafts',
  OPS_CONFIG_AGENT_STAGED_DIRECTORY: '/var/lib/edutrack-config-agent/staged',
  OPS_CONFIG_AGENT_SNAPSHOTS_DIRECTORY: '/var/lib/edutrack-config-agent/snapshots',
  OPS_CONFIG_AGENT_LOCKS_DIRECTORY: '/var/lib/edutrack-config-agent/locks',
  OPS_CONFIG_AGENT_DRAFT_TTL_MS: '86400000',
  OPS_CONFIG_AGENT_STAGED_TTL_MS: '86400000',
  OPS_CONFIG_AGENT_SNAPSHOT_RETENTION_MS: '2592000000',
  OPS_CONFIG_AGENT_SOCKET_GROUP: 'edutrack-config-api',
  OPS_CONFIG_AGENT_ALLOWED_PEER_UID: '1001',
  OPS_CONFIG_AGENT_ALLOWED_PEER_GID: '1002',
  OPS_CONFIG_AGENT_CLOCK_SKEW_MS: '60000',
  OPS_CONFIG_AGENT_REQUEST_TTL_MS: '30000'
} as const;

describe('readConfigAgentRuntimeConfig', () => {
  test('loads bounded paths, separate keys, peer identity, and fixed frame limit', () => {
    expect(readConfigAgentRuntimeConfig(environment)).toEqual({
      socketPath: '/run/edutrack-config-agent/agent.sock',
      catalogPath: '/etc/edutrack-config-agent/catalog.yaml',
      manifestPath: '/etc/edutrack-config-agent/manifest.yaml',
      protocolKeyPath: '/etc/edutrack-config-agent/credentials/protocol-hmac',
      protocolKeyId: 'config-agent-protocol-v1',
      fingerprintKeyPath: '/etc/edutrack-config-agent/credentials/fingerprint-v1',
      fingerprintKeyVersion: 'v1',
      stagingKeyPath: '/etc/edutrack-config-agent/credentials/staging-v1',
      stagingKeyId: 'config-agent-staging-2026-08-31',
      stagingKeyVersion: 'v1',
      stagingAcceptedOldKeyIds: [
        'config-agent-staging-2026-08-30',
        'config-agent-staging-2026-08-29'
      ],
      snapshotKeyPath: '/etc/edutrack-config-agent/credentials/snapshot-v1',
      snapshotKeyId: 'config-agent-snapshot-2026-08-31',
      snapshotKeyVersion: 'v1',
      snapshotAcceptedOldKeyIds: ['config-agent-snapshot-2026-08-30'],
      stateDirectory: '/var/lib/edutrack-config-agent',
      draftsDirectory: '/var/lib/edutrack-config-agent/drafts',
      stagedDirectory: '/var/lib/edutrack-config-agent/staged',
      snapshotsDirectory: '/var/lib/edutrack-config-agent/snapshots',
      locksDirectory: '/var/lib/edutrack-config-agent/locks',
      draftTtlMs: 86_400_000,
      stagedTtlMs: 86_400_000,
      snapshotRetentionMs: 2_592_000_000,
      socketGroup: 'edutrack-config-api',
      allowedPeerUid: 1001,
      allowedPeerGid: 1002,
      clockSkewMs: 60_000,
      requestTtlMs: 30_000,
      maximumFrameBytes: MAXIMUM_FRAME_BYTES
    });
  });

  test.each([
    [
      'socket traversal',
      { ...environment, OPS_CONFIG_AGENT_SOCKET_PATH: '/run/../tmp/agent.sock' }
    ],
    ['non-socket path', { ...environment, OPS_CONFIG_AGENT_SOCKET_PATH: '/run/agent' }],
    [
      'same key path',
      {
        ...environment,
        OPS_CONFIG_AGENT_FINGERPRINT_KEY_PATH: environment.OPS_CONFIG_AGENT_PROTOCOL_KEY_PATH
      }
    ],
    [
      'invalid fingerprint version',
      { ...environment, OPS_CONFIG_AGENT_FINGERPRINT_KEY_VERSION: '1' }
    ],
    [
      'same staging and snapshot key path',
      {
        ...environment,
        OPS_CONFIG_AGENT_SNAPSHOT_KEY_PATH: environment.OPS_CONFIG_AGENT_STAGING_KEY_PATH
      }
    ],
    [
      'same staging and snapshot key id',
      {
        ...environment,
        OPS_CONFIG_AGENT_SNAPSHOT_KEY_ID: environment.OPS_CONFIG_AGENT_STAGING_KEY_ID
      }
    ],
    [
      'draft retention beyond policy',
      { ...environment, OPS_CONFIG_AGENT_DRAFT_TTL_MS: '86400001' }
    ],
    [
      'invalid old key id list',
      { ...environment, OPS_CONFIG_AGENT_STAGING_OLD_KEY_IDS: 'old key' }
    ],
    ['invalid peer uid', { ...environment, OPS_CONFIG_AGENT_ALLOWED_PEER_UID: '-1' }],
    ['invalid ttl', { ...environment, OPS_CONFIG_AGENT_REQUEST_TTL_MS: '0' }]
  ])('rejects %s with a stable, value-free code', (_label, invalidEnvironment) => {
    expect(() => readConfigAgentRuntimeConfig(invalidEnvironment)).toThrowError(
      expect.objectContaining({ code: expect.any(String) })
    );
    try {
      readConfigAgentRuntimeConfig(invalidEnvironment);
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeConfigError);
      expect((error as RuntimeConfigError).message).not.toContain('protocol-hmac');
    }
  });
});
