import { describe, expect, it } from 'vitest';

import { AgentManifestSchema } from './manifest.js';

const validManifest = {
  manifestVersion: '2026-08-31',
  catalogVersion: '2026-08-31',
  catalogDigest: `sha256:${'a'.repeat(64)}`,
  readOnly: true,
  apps: [
    {
      id: 'edutrack',
      displayName: 'EduTrack Platform',
      sourceIds: ['edutrack.shared_env', 'edutrack.pm2_ecosystem']
    },
    {
      id: 'ops',
      displayName: 'Ops Console',
      sourceIds: ['ops.api_env']
    },
    {
      id: 'website',
      displayName: 'Thien Uy Website',
      sourceIds: []
    }
  ],
  sources: [
    {
      id: 'edutrack.shared_env',
      appId: 'edutrack',
      pathLabel: '/srv/edutrack/shared/.env',
      adapterId: 'node_env_file',
      mutability: 'catalog_controlled',
      locator: {
        kind: 'file',
        path: '/srv/edutrack/shared/.env'
      },
      owner: 'deploy',
      group: 'deploy',
      mode: '0640',
      maximumBytes: 131072,
      precedenceRank: 200
    },
    {
      id: 'edutrack.pm2_ecosystem',
      appId: 'edutrack',
      pathLabel: '/srv/edutrack/current/deploy/vps/ecosystem.config.cjs',
      adapterId: 'pm2_ecosystem_static',
      mutability: 'observed',
      locator: {
        kind: 'active_release_link',
        currentPath: '/srv/edutrack/current',
        approvedTargetRoot: '/srv/edutrack/releases',
        metadataFileName: '.release-source.json',
        fixedDescendant: 'deploy/vps/ecosystem.config.cjs'
      },
      owner: 'deploy',
      group: 'deploy',
      mode: '0644',
      maximumBytes: 65536,
      precedenceRank: 300
    },
    {
      id: 'ops.api_env',
      appId: 'ops',
      pathLabel: '/etc/edutrack-ops/api.env',
      adapterId: 'systemd_environment_file',
      mutability: 'catalog_controlled',
      locator: {
        kind: 'file',
        path: '/etc/edutrack-ops/api.env'
      },
      owner: 'root',
      group: 'root',
      mode: '0640',
      maximumBytes: 65536,
      precedenceRank: 200
    }
  ],
  actions: [{ id: 'systemd.restart_unit', description: 'Restart a declared unit' }],
  checks: [{ id: 'http.readiness_local', description: 'Local readiness check' }]
} as const;

describe('AgentManifestSchema', () => {
  it('accepts a read-only manifest with fixed ids and file expectations', () => {
    const parsed = AgentManifestSchema.parse(validManifest);
    expect(parsed.apps.find((app) => app.id === 'website')).toMatchObject({
      sourceIds: []
    });
    expect(parsed.sources[0]).toMatchObject({
      id: 'edutrack.shared_env',
      adapterId: 'node_env_file',
      mutability: 'catalog_controlled',
      owner: 'deploy',
      group: 'deploy',
      mode: '0640'
    });
    expect(parsed).toMatchObject({
      manifestVersion: '2026-08-31',
      readOnly: true
    });
  });

  it('rejects invalid source ids, names, negative limits, duplicates, and unknown fields', () => {
    const invalidManifests = [
      {
        ...validManifest,
        sources: [{ ...validManifest.sources[0], id: 'EduTrack.shared_env' }]
      },
      {
        ...validManifest,
        sources: [{ ...validManifest.sources[0], owner: 'root user' }]
      },
      {
        ...validManifest,
        sources: [{ ...validManifest.sources[0], maximumBytes: -1 }]
      },
      {
        ...validManifest,
        apps: [{ ...validManifest.apps[0], sourceIds: ['missing.source'] }]
      },
      {
        ...validManifest,
        sources: [validManifest.sources[0], validManifest.sources[0]]
      },
      {
        ...validManifest,
        checks: [{ ...validManifest.checks[0], unexpected: true }]
      }
    ];

    for (const invalidManifest of invalidManifests) {
      expect(() => AgentManifestSchema.parse(invalidManifest)).toThrow();
    }
  });

  it('rejects source action and check references that are not declared', () => {
    expect(() =>
      AgentManifestSchema.parse({
        ...validManifest,
        apps: validManifest.apps.map((app, index) => ({
          ...app,
          sourceIds: index === 0 ? ['edutrack.shared_env'] : []
        })),
        sources: [
          {
            ...validManifest.sources[0],
            actionIds: ['systemd.restart_unit'],
            checkIds: ['http.readiness_local']
          }
        ]
      })
    ).not.toThrow();

    expect(() =>
      AgentManifestSchema.parse({
        ...validManifest,
        sources: [
          {
            ...validManifest.sources[0],
            actionIds: ['systemd.reload_unit'],
            checkIds: ['agent.healthy']
          }
        ]
      })
    ).toThrow();
  });
});
