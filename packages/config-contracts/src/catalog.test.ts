import { describe, expect, it } from 'vitest';

import { CatalogSchema } from './catalog.js';

const validCatalog = {
  catalogVersion: '2026-08-31',
  apps: [
    {
      id: 'edutrack',
      displayName: 'EduTrack Platform',
      runtimeVariableCount: 3
    },
    {
      id: 'ops',
      displayName: 'Ops Console',
      runtimeVariableCount: 2
    },
    {
      id: 'website',
      displayName: 'Thien Uy Website',
      runtimeVariableCount: 0
    }
  ],
  entries: [
    {
      id: 'edutrack.database_url',
      name: 'DATABASE_URL',
      appId: 'edutrack',
      sourceId: 'edutrack.shared_env',
      consumerIds: ['edutrack.web', 'edutrack.scheduled_jobs'],
      category: 'database',
      description: 'Primary application PostgreSQL connection',
      sensitivity: 'secret',
      requirement: 'required',
      mutability: 'managed',
      applyStrategy: 'runtime_restart',
      validatorId: 'postgres_url',
      precedenceId: 'node_env_file'
    }
  ],
  validators: [{ id: 'postgres_url', type: 'url', allowedSchemes: ['postgres', 'postgresql'] }],
  consumers: [
    {
      id: 'edutrack.web',
      appId: 'edutrack',
      kind: 'service',
      displayName: 'EduTrack Web'
    },
    {
      id: 'edutrack.scheduled_jobs',
      appId: 'edutrack',
      kind: 'job',
      displayName: 'Scheduled jobs'
    }
  ],
  precedences: [
    {
      id: 'node_env_file',
      rank: 200,
      scope: 'runtime',
      description: 'Node env file precedence'
    }
  ]
} as const;

describe('CatalogSchema', () => {
  it('accepts a strict value-free catalog entry', () => {
    const parsed = CatalogSchema.parse(validCatalog);
    expect(parsed.apps.find((app) => app.id === 'website')).toMatchObject({
      runtimeVariableCount: 0
    });
    expect(parsed.entries[0]).toMatchObject({
      id: 'edutrack.database_url',
      requirement: 'required',
      mutability: 'managed',
      applyStrategy: 'runtime_restart'
    });
  });

  it('rejects value-bearing and unknown entry fields', () => {
    const invalidCatalogs = [
      {
        ...validCatalog,
        entries: [{ ...validCatalog.entries[0], value: 'postgres://do-not-leak' }]
      },
      {
        ...validCatalog,
        entries: [{ ...validCatalog.entries[0], defaultValue: 'postgres://do-not-leak' }]
      },
      {
        ...validCatalog,
        entries: [{ ...validCatalog.entries[0], exampleValue: 'postgres://do-not-leak' }]
      },
      {
        ...validCatalog,
        entries: [{ ...validCatalog.entries[0], secret: { current: 'do-not-leak' } }]
      }
    ];

    for (const invalidCatalog of invalidCatalogs) {
      expect(() => CatalogSchema.parse(invalidCatalog)).toThrow();
    }
  });

  it('rejects invalid ids, names, duplicates, and unknown top-level fields', () => {
    const invalidCatalogs = [
      {
        ...validCatalog,
        apps: [{ ...validCatalog.apps[0], runtimeVariableCount: -1 }]
      },
      {
        ...validCatalog,
        entries: [{ ...validCatalog.entries[0], id: 'EduTrack.database_url' }]
      },
      {
        ...validCatalog,
        entries: [{ ...validCatalog.entries[0], name: 'DATABASE URL' }]
      },
      {
        ...validCatalog,
        entries: [validCatalog.entries[0], validCatalog.entries[0]]
      },
      {
        ...validCatalog,
        entries: [{ ...validCatalog.entries[0], appId: 'missing-app' }]
      },
      {
        ...validCatalog,
        unexpected: true
      }
    ];

    for (const invalidCatalog of invalidCatalogs) {
      expect(() => CatalogSchema.parse(invalidCatalog)).toThrow();
    }
  });
});
