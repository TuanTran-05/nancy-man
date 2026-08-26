import { describe, expect, it } from 'vitest';

import {
  PostgresReleasePublisherStore,
  PostgresReleaseRepository,
  SourceMapRegistrationConflictError
} from './postgresReleaseStore.js';

describe('Postgres release publisher stores', () => {
  it('loads only a publisher key’s service binding and external secret reference', async () => {
    const queries: Array<{ sql: string; parameters?: readonly unknown[] | undefined }> = [];
    const store = new PostgresReleasePublisherStore({
      query: async <T>(sql: string, parameters?: readonly unknown[]) => {
        queries.push({ sql, parameters });
        return {
          rows: [
            {
              serviceName: 'edutrack-web',
              secretReference: 'ops/release/edutrack-web',
              status: 'active'
            }
          ] as T[]
        };
      }
    });

    await expect(store.findPublisher('edutrack-web-release-publisher')).resolves.toEqual({
      serviceName: 'edutrack-web',
      secretReference: 'ops/release/edutrack-web',
      status: 'active'
    });
    expect(queries[0]).toMatchObject({
      sql: expect.stringContaining('FROM release_publishers'),
      parameters: ['edutrack-web-release-publisher']
    });
  });

  it('upserts a release and records a map by release plus generated file name', async () => {
    const queries: Array<{ sql: string; parameters?: readonly unknown[] | undefined }> = [];
    const repository = new PostgresReleaseRepository({
      query: async <T>(sql: string, parameters?: readonly unknown[]) => {
        queries.push({ sql, parameters });
        if (sql.includes('INSERT INTO releases')) return { rows: [{ id: 'rel-1' }] as T[] };
        return { rows: [{ sha256: 'a'.repeat(64) }] as T[] };
      }
    });

    await expect(
      repository.upsertRelease({
        serviceName: 'edutrack-web',
        releaseSha: '0123456789abcdef0123456789abcdef01234567',
        buildId: 'build-20260822',
        deployedAt: new Date('2026-08-22T08:00:00.000Z')
      })
    ).resolves.toEqual({ id: 'rel-1' });
    await expect(
      repository.recordSourceMap({
        releaseId: 'rel-1',
        objectKey: 'source-maps/edutrack-web/0123/example.map',
        sha256: 'a'.repeat(64),
        generatedFile: 'app-abc123.js'
      })
    ).resolves.toBeUndefined();
    expect(queries[0]?.sql).toContain('ON CONFLICT (service_name, release_sha)');
    expect(queries[1]).toMatchObject({
      sql: expect.stringContaining('ON CONFLICT (release_id, generated_file)'),
      parameters: expect.arrayContaining(['app-abc123.js'])
    });
  });

  it('refuses to overwrite a source map for the same released generated asset', async () => {
    const repository = new PostgresReleaseRepository({
      query: async <T>() => ({ rows: [] as T[] })
    });

    await expect(
      repository.recordSourceMap({
        releaseId: 'rel-1',
        objectKey: 'source-maps/edutrack-web/0123/example.map',
        sha256: 'a'.repeat(64),
        generatedFile: 'app-abc123.js'
      })
    ).rejects.toBeInstanceOf(SourceMapRegistrationConflictError);
  });
});
