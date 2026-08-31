import { describe, expect, it } from 'vitest';

import { AgentManifestSchema } from './manifest.js';

const validManifest = {
  manifestVersion: '2026-08-31',
  catalogVersion: '2026-08-31',
  catalogDigest: `sha256:${'a'.repeat(64)}`,
  readOnly: true,
  sources: [
    {
      id: 'edutrack.shared_env',
      appId: 'edutrack-platform',
      pathLabel: '/srv/edutrack/shared/.env',
      adapterId: 'node_env_file',
      locator: {
        kind: 'file',
        path: '/srv/edutrack/shared/.env'
      },
      owner: 'deploy',
      group: 'deploy',
      mode: '0640',
      maximumBytes: 131072,
      precedenceRank: 200
    }
  ],
  actions: [{ id: 'systemd.restart_unit', description: 'Restart a declared unit' }],
  checks: [{ id: 'http.readiness_local', description: 'Local readiness check' }]
} as const;

describe('AgentManifestSchema', () => {
  it('accepts a read-only manifest with fixed ids and file expectations', () => {
    expect(AgentManifestSchema.parse(validManifest)).toMatchObject({
      manifestVersion: '2026-08-31',
      readOnly: true,
      sources: [
        {
          id: 'edutrack.shared_env',
          adapterId: 'node_env_file',
          owner: 'deploy',
          group: 'deploy',
          mode: '0640'
        }
      ]
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
